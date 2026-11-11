// Test della cache delle risposte della chat, SENZA chiamate a OpenAI.
// - cache.js da solo: normalizzazione, scadenza, espulsione della voce meno recente oltre la dimensione massima;
// - server vero con un finto OpenAI (conta le chiamate) e un finto data agent (date, versione dei dati, /analizza):
//   domanda identica servita dalla cache senza chiamare OpenAI; scenario diverso, dati diversi o conversazione
//   già iniziata: non servita; risposte con numeri senza strumenti, con errori o bloccate dal filtro: non salvate;
//   dalla cache anche a tetto raggiunto, senza token, ma contando nel limite di frequenza; cache: true nel log.
//
// Uso (dalla cartella backend):  node test_cache.js
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

const { creaCache, chiaveCache, normalizzaDomanda } = require("./cache");

const PORTA_BACKEND = 3121, PORTA_OPENAI = 3122, PORTA_DATA_AGENT = 3123;
const URL = `http://127.0.0.1:${PORTA_BACKEND}`;
const FILE_CONTATORE = path.join(os.tmpdir(), `contatore_cache_test_${process.pid}.json`);
const FILE_FEEDBACK = path.join(os.tmpdir(), `feedback_cache_test_${process.pid}.jsonl`);
const TETTO = 210; // token al giorno: raggiunto esattamente alla fine della sequenza qui sotto (15 per chiamata)

let falliti = 0;
function verifica(descrizione, ok) {
  console.log(`  ${ok ? "OK  " : "NO  "} ${descrizione}`);
  if (!ok) falliti++;
}

// --- cache.js da solo -----------------------------------------------------------------

function testUnitari() {
  console.log("\nNormalizzazione della domanda");
  verifica("minuscole, spazi ridotti, punteggiatura finale tolta",
    normalizzaDomanda("  Quanti   SCARTI ieri?? ") === "quanti scarti ieri");
  verifica("la punteggiatura interna resta", normalizzaDomanda("Scarti, vendite: confronto!") === "scarti, vendite: confronto");
  const base = { domanda: "Quanti scarti ieri?", scenario: "caldo", lingua: "it", versioneDati: "v1",
    modelloOrchestratore: "m", modelloDataAgent: "d", versionePrompt: "p" };
  verifica("stessa chiave per domande uguali dopo la normalizzazione",
    chiaveCache(base) === chiaveCache({ ...base, domanda: "quanti  scarti ieri" }));
  verifica("domande simili ma diverse: chiavi diverse (nessuna somiglianza di significato)",
    chiaveCache({ ...base, domanda: "Scarti di ortofrutta" }) !== chiaveCache({ ...base, domanda: "Scarti di panetteria" }));
  for (const campo of ["scenario", "lingua", "versioneDati", "modelloOrchestratore", "modelloDataAgent", "versionePrompt"]) {
    verifica(`chiave diversa se cambia ${campo}`, chiaveCache(base) !== chiaveCache({ ...base, [campo]: "altro" }));
  }

  console.log("\nScadenza");
  let ora = 0;
  const cache = creaCache({ maxVoci: 3, ttlMs: 60_000, adesso: () => ora });
  cache.salva("a", { risposta: "A" });
  ora = 59_999;
  verifica("prima della scadenza c'è", cache.leggi("a")?.risposta === "A");
  ora = 60_000;
  verifica("alla scadenza non c'è più", cache.leggi("a") === undefined && cache.dimensione() === 0);

  console.log("\nEspulsione oltre la dimensione massima (3 voci)");
  ora = 0;
  cache.salva("1", { n: 1 });
  cache.salva("2", { n: 2 });
  cache.salva("3", { n: 3 });
  cache.leggi("1"); // la 1 è usata ora: la meno recente diventa la 2
  cache.salva("4", { n: 4 });
  verifica("tolta la voce usata meno di recente (2), restano 1, 3 e 4",
    cache.leggi("2") === undefined && cache.leggi("1")?.n === 1 && cache.leggi("3")?.n === 3 && cache.leggi("4")?.n === 4
      && cache.dimensione() === 3);
  const copia = cache.leggi("4");
  copia.n = 99;
  verifica("chi riceve una voce può modificarla senza toccare la cache", cache.leggi("4").n === 4);
}

// --- server con finti OpenAI e data agent ------------------------------------------------

let chiamateOpenAI = 0;
const openaiFinto = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (d) => { corpo += d; });
  req.on("end", () => {
    chiamateOpenAI++;
    const { messages } = JSON.parse(corpo);
    const domanda = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const giaUsatoStrumento = messages.some((m) => m.role === "tool");
    let messaggio;
    if (/analisi|bloccata/.test(domanda) && !giaUsatoStrumento) {
      // Chiede al back end di usare analizza_dati (il finto data agent risponde con un errore o "bloccata")
      messaggio = { role: "assistant", content: null, tool_calls: [{ id: `c${chiamateOpenAI}`, type: "function",
        function: { name: "analizza_dati", arguments: JSON.stringify({ domanda }) } }] };
    } else if (/pezzi/.test(domanda)) {
      messaggio = { role: "assistant", content: "Ne restano 42 pezzi." }; // numeri senza strumenti
    } else {
      messaggio = { role: "assistant", content: "Controlla la merce e avvisa il responsabile." };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", created: 0, model: "finto",
      choices: [{ index: 0, message: messaggio, finish_reason: messaggio.tool_calls ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
});

let impronta = "a".repeat(64);
const DATE = {
  oggi: "2025-07-17", ieri: "2025-07-16", inizio_settimana: "2025-07-10",
  mese_corrente: "luglio 2025, il mese in corso (dati dal 1 al 16 luglio 2025)",
  ultima_settimana_completa: { inizio: "2025-07-07", fine: "2025-07-13" },
  oggi_esteso: "giovedì 17 luglio 2025", ieri_esteso: "mercoledì 16 luglio 2025", inizio_settimana_esteso: "giovedì 10 luglio 2025",
};
const dataAgentFinto = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (d) => { corpo += d; });
  req.on("end", () => {
    const json = (stato, dati) => { res.writeHead(stato, { "Content-Type": "application/json" }); res.end(JSON.stringify(dati)); };
    if (/^\/scenari\/[^/]+\/date$/.test(req.url)) return json(200, DATE);
    if (req.url === "/versione") return json(200, { impronta_dati: impronta, modello: "finto-data-agent", prompt: "p1" });
    if (req.url === "/analizza") {
      const { domanda } = JSON.parse(corpo);
      if (/bloccata/.test(domanda)) {
        return json(200, { risposta: "La risposta è stata bloccata perché conteneva informazioni riservate.",
          grafico: null, pulizia: null, token: 0, codice: null, bloccata_dal_filtro: true });
      }
      return json(500, { detail: "errore finto dell'analisi" });
    }
    json(404, { detail: "non trovato" });
  });
});

async function chat(sessionId, messaggio, scenario = "caldo") {
  const r = await fetch(`${URL}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, messaggio, scenario }),
  });
  // Richieste rimaste nel minuto, dall'intestazione RateLimit (draft-8): "...; r=9; t=60"
  const rimaste = Number((r.headers.get("ratelimit") ?? "").match(/r=(\d+)/)?.[1]);
  return { stato: r.status, corpo: await r.json().catch(() => null), rimaste };
}

async function testServer() {
  await new Promise((r) => openaiFinto.listen(PORTA_OPENAI, "127.0.0.1", r));
  await new Promise((r) => dataAgentFinto.listen(PORTA_DATA_AGENT, "127.0.0.1", r));
  const server = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env, OPENAI_API_KEY: "chiave-finta-per-il-test", OPENAI_BASE_URL: `http://127.0.0.1:${PORTA_OPENAI}/v1`,
      ORCHESTRATOR_MODEL: "finto", BACKEND_PORT: String(PORTA_BACKEND), DATA_AGENT_PORT: String(PORTA_DATA_AGENT),
      LIMITE_RICHIESTE_MINUTO: "50", TETTO_TOKEN_GIORNALIERO: String(TETTO), FILE_CONTATORE_TOKEN: FILE_CONTATORE, REDIS_URL: "",
      FILE_FEEDBACK, CACHE_MAX_VOCI: "200", CACHE_TTL_MINUTI: "60", LOG_FORMAT: "json", LOG_LEVEL: "info",
    },
  });
  let uscita = "";
  server.stdout.on("data", (d) => { uscita += d; });
  server.stderr.on("data", (d) => { uscita += d; });
  const nuova = () => crypto.randomUUID();
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`${URL}/api/scenari`)).ok) break; } catch { /* non ancora pronto */ }
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log("\nDomanda identica dalla cache");
    const prima = await chat(nuova(), "Cosa faccio con la merce?");
    const dopoPrima = chiamateOpenAI;
    const seconda = await chat(nuova(), "  cosa FACCIO con la merce  ??");
    verifica(`prima risposta dal modello (stato ${prima.stato}, ${dopoPrima} chiamata)`, prima.stato === 200 && dopoPrima === 1);
    verifica(`seconda servita dalla cache: nessuna chiamata in più al finto OpenAI (${chiamateOpenAI})`, chiamateOpenAI === dopoPrima);
    verifica("stessa risposta, strumenti e fonti", seconda.corpo?.risposta === prima.corpo.risposta
      && JSON.stringify(seconda.corpo.strumenti) === JSON.stringify(prima.corpo.strumenti));
    verifica(`dalla cache nessun token consumato (${seconda.corpo?.token})`, seconda.corpo?.token === 0 && prima.corpo.token === 15);
    verifica("id per i pollici diverso (risposta nuova per le valutazioni)", seconda.corpo?.id_messaggio !== prima.corpo.id_messaggio);
    verifica(`conta nel limite di frequenza (rimaste ${prima.rimaste} -> ${seconda.rimaste})`, seconda.rimaste === prima.rimaste - 1);

    console.log("\nCasi in cui la cache non vale");
    let c = chiamateOpenAI;
    await chat(nuova(), "Cosa faccio con la merce?", "tranquilla");
    verifica("stessa domanda, scenario diverso: non servita", chiamateOpenAI === c + 1);
    c = chiamateOpenAI;
    impronta = "b".repeat(64); // dati diversi (per esempio il data agent ripartito con un altro CSV)
    const sessione = nuova();
    await chat(sessione, "Cosa faccio con la merce?");
    verifica("stessa domanda, dati diversi (impronta): non servita", chiamateOpenAI === c + 1);
    c = chiamateOpenAI;
    await chat(sessione, "Cosa faccio con la merce?");
    verifica("conversazione già iniziata (memoria): non servita", chiamateOpenAI === c + 1);

    console.log("\nRisposte che non si salvano");
    c = chiamateOpenAI;
    await chat(nuova(), "Quanti pezzi restano?");
    await chat(nuova(), "Quanti pezzi restano?");
    verifica("con numeri e senza strumenti: ogni volta al modello", chiamateOpenAI === c + 2);
    c = chiamateOpenAI;
    const conErrore = await chat(nuova(), "Fai un'analisi degli scarti");
    await chat(nuova(), "Fai un'analisi degli scarti");
    verifica(`con un errore di uno strumento: ogni volta al modello (${conErrore.corpo?.strumenti?.[0]?.nome})`,
      chiamateOpenAI === c + 4 && conErrore.corpo?.strumenti?.[0]?.nome === "analizza_dati");
    c = chiamateOpenAI;
    await chat(nuova(), "Analisi bloccata dal filtro");
    await chat(nuova(), "Analisi bloccata dal filtro");
    verifica("bloccata dal filtro: ogni volta al modello", chiamateOpenAI === c + 4);

    console.log(`\nTetto giornaliero raggiunto (${TETTO} token)`);
    const nuovaDomanda = await chat(nuova(), "Una domanda mai fatta");
    verifica(`domanda nuova rifiutata (${nuovaDomanda.stato} ${nuovaDomanda.corpo?.codice})`,
      nuovaDomanda.stato === 429 && nuovaDomanda.corpo?.codice === "tetto_giornaliero");
    c = chiamateOpenAI;
    const giaInCache = await chat(nuova(), "Cosa faccio con la merce?");
    verifica(`domanda in cache servita lo stesso, senza chiamate (${giaInCache.stato})`, giaInCache.stato === 200 && chiamateOpenAI === c);
    const contatore = JSON.parse(fs.readFileSync(FILE_CONTATORE, "utf-8"));
    verifica(`le risposte dalla cache non contano nel tetto (${Object.values(contatore)[0]} token = ${TETTO})`,
      Object.values(contatore)[0] === TETTO);

    console.log("\nLog");
    await new Promise((r) => setTimeout(r, 200));
    const righe = uscita.split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return {}; } })
      .filter((x) => x.msg === "richiesta completata" && x.rotta === "/api/chat");
    const conCache = righe.filter((x) => x.cache === true);
    verifica(`cache: true nelle righe servite dalla cache (${conCache.length}), con 0 token`,
      conCache.length === 2 && conCache.every((x) => x.token_ingresso === 0 && x.token_uscita === 0 && x.esito === "ok"));
    verifica("cache: false nelle altre", righe.filter((x) => x.cache === false).length === righe.length - 2);
  } finally {
    if (process.platform === "win32") execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill();
    openaiFinto.close();
    dataAgentFinto.close();
  }
}

(async () => {
  testUnitari();
  await testServer();
})()
  .catch((e) => { console.error(`Test interrotto: ${e.message}`); falliti++; })
  .finally(() => {
    fs.rmSync(FILE_CONTATORE, { force: true });
    fs.rmSync(FILE_FEEDBACK, { force: true });
    console.log(falliti ? `\n${falliti} verifiche NON superate` : "\nTutte le verifiche superate");
    process.exitCode = falliti ? 1 : 0;
  });
