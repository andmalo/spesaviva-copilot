// Test della valutazione delle risposte, SENZA chiamate a OpenAI.
// Avvia un finto OpenAI locale (risponde sempre con lo stesso testo, senza strumenti) e il server
// vero puntato su di esso con una chiave finta; i voti vanno in un file temporaneo.
// Controlla: id delle risposte, voti validi e non validi, doppio voto, limite di frequenza,
// righe del file e riepilogo per strumento. Alla fine ferma il server.
//
// Uso (dalla cartella backend):  node test_feedback.js
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, execSync, execFileSync } = require("node:child_process");

const PORTA_BACKEND = 3101;   // porte diverse da quelle normali: il test non tocca il progetto avviato
const PORTA_OPENAI = 3102;
const URL = `http://127.0.0.1:${PORTA_BACKEND}`;
const LIMITE = 12;            // richieste al minuto per questo test (bastano per tutte le verifiche prima del 429)
const FILE = path.join(os.tmpdir(), `feedback_test_${process.pid}.jsonl`);
// Risposta lunga (oltre 500 caratteri) e senza cifre, così la guardia sui numeri non interviene
const RISPOSTA_FINTA = "Ecco la procedura da seguire in negozio. " + "Controlla la merce e avvisa il responsabile. ".repeat(15);

let falliti = 0;
function verifica(descrizione, ok) {
  console.log(`  ${ok ? "OK  " : "NO  "} ${descrizione}`);
  if (!ok) falliti++;
}

// Finto OpenAI: solo /v1/chat/completions
let chiamateFinte = 0;
const openaiFinto = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (d) => { corpo += d; });
  req.on("end", () => {
    chiamateFinte++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: `finto-${chiamateFinte}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "finto",
      choices: [{ index: 0, message: { role: "assistant", content: RISPOSTA_FINTA }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
});

async function post(percorso, corpo) {
  const r = await fetch(`${URL}${percorso}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  return { stato: r.status, corpo: await r.json().catch(() => null) };
}

async function main() {
  await new Promise((r) => openaiFinto.listen(PORTA_OPENAI, "127.0.0.1", r));
  const server = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      OPENAI_API_KEY: "chiave-finta-per-il-test",
      OPENAI_BASE_URL: `http://127.0.0.1:${PORTA_OPENAI}/v1`,
      BACKEND_PORT: String(PORTA_BACKEND),
      LIMITE_RICHIESTE_MINUTO: String(LIMITE),
      FILE_FEEDBACK: FILE,
    },
  });
  server.stdout.on("data", (d) => process.stdout.write(`    [server] ${d}`));
  server.stderr.on("data", (d) => process.stdout.write(`    [server] ${d}`));
  try {
    for (let i = 0; i < 30; i++) {
      try { if ((await fetch(`${URL}/api/scenari`)).ok) break; } catch { /* non ancora pronto */ }
      await new Promise((r) => setTimeout(r, 500));
    }

    const sessione = crypto.randomUUID();
    let richieste = 0; // richieste che passano dal limite di frequenza

    console.log("\nRisposte con id");
    const r1 = await post("/api/chat", { sessionId: sessione, messaggio: "Cosa faccio con la merce?", scenario: "caldo" }); richieste++;
    const r2 = await post("/api/chat", { sessionId: sessione, messaggio: "E dopo?", scenario: "caldo" }); richieste++;
    verifica(`la chat restituisce id_messaggio (stato ${r1.stato})`, r1.stato === 200 && typeof r1.corpo.id_messaggio === "string");
    verifica("id diversi per risposte diverse", r1.corpo.id_messaggio !== r2.corpo.id_messaggio);

    console.log("\nVoti non validi");
    const casi = [
      ["voto sconosciuto", { voto: "forse" }, 400],
      ["commento non testuale", { voto: "giu", commento: 42 }, 400],
      ["commento di 301 caratteri", { voto: "giu", commento: "x".repeat(301) }, 400],
      ["id inesistente", { voto: "su", idMessaggio: crypto.randomUUID() }, 404],
      ["sessione di un altro", { voto: "su", sessionId: crypto.randomUUID() }, 404],
      ["sessione mancante", { voto: "su", sessionId: undefined }, 400],
    ];
    for (const [nome, dati, atteso] of casi) {
      const r = await post("/api/feedback", { sessionId: sessione, idMessaggio: r1.corpo.id_messaggio, ...dati }); richieste++;
      verifica(`${nome}: stato ${r.stato} (atteso ${atteso}), codice ${r.corpo?.codice}`, r.stato === atteso);
    }

    console.log("\nVoti validi");
    const su = await post("/api/feedback", { sessionId: sessione, idMessaggio: r1.corpo.id_messaggio, voto: "su" }); richieste++;
    verifica(`pollice su: stato ${su.stato}`, su.stato === 200);
    const doppio = await post("/api/feedback", { sessionId: sessione, idMessaggio: r1.corpo.id_messaggio, voto: "giu" }); richieste++;
    verifica(`secondo voto sulla stessa risposta rifiutato: stato ${doppio.stato}`, doppio.stato === 409);
    const giu = await post("/api/feedback", {
      sessionId: sessione, idMessaggio: r2.corpo.id_messaggio, voto: "giu", commento: "  Mancava la soglia del reparto.  ",
    }); richieste++;
    verifica(`pollice giù con commento: stato ${giu.stato}`, giu.stato === 200);

    console.log("\nFile dei voti");
    const righe = fs.readFileSync(FILE, "utf-8").trim().split("\n").map((r) => JSON.parse(r));
    verifica(`2 righe (una per voto valido): ${righe.length}`, righe.length === 2);
    const [a, b] = righe;
    console.log(`    riga 2: ${JSON.stringify({ ...b, risposta: `${b.risposta.slice(0, 40)}… (${b.risposta.length} caratteri)` })}`);
    verifica("campi: data, scenario, domanda, strumenti, voto, commento, risposta",
      ["data", "scenario", "domanda", "strumenti", "voto", "commento", "risposta"].every((k) => k in a));
    verifica("scenario e domanda presi dal server", a.scenario === "caldo" && a.domanda === "Cosa faccio con la merce?");
    verifica("risposta troncata a 500 caratteri", RISPOSTA_FINTA.length > 500 && a.risposta.length === 501 && a.risposta.endsWith("…"));
    verifica("commento solo con il pollice giù, senza spazi ai lati",
      a.commento === null && b.commento === "Mancava la soglia del reparto.");

    console.log("\nLimite di frequenza (lo stesso della chat)");
    let stato429 = null;
    for (let i = richieste; i <= LIMITE + 1 && stato429 === null; i++) {
      const r = await post("/api/feedback", { sessionId: sessione, idMessaggio: "x", voto: "su" });
      if (r.stato === 429) stato429 = r.corpo?.codice;
    }
    verifica(`dopo ${LIMITE} richieste al minuto (chat + valutazioni): 429 ${stato429}`, stato429 === "troppe_richieste");
    verifica(`chiamate al finto OpenAI: ${chiamateFinte} (2 domande)`, chiamateFinte === 2);

    console.log("\nRiepilogo per strumento");
    console.log(execFileSync(process.execPath, ["riepilogo_feedback.js", FILE], { cwd: __dirname, encoding: "utf-8" }));
  } finally {
    if (process.platform === "win32") execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill();
    openaiFinto.close();
    fs.rmSync(FILE, { force: true });
  }
}

main()
  .catch((errore) => { console.error(`Test interrotto: ${errore.message}`); falliti++; })
  .finally(() => {
    console.log(falliti ? `${falliti} verifiche NON superate` : "Tutte le verifiche superate");
    process.exitCode = falliti ? 1 : 0;
  });
