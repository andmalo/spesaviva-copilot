// Test end-to-end dell'orchestratore.
// Avvia ChromaDB, il data agent e il server, invia 5 domande nella stessa sessione,
// stampa per ognuna strumenti, risposta, sezioni consultate, grafici e token, verifica i casi
// attesi e alla fine ferma tutti i servizi.
//
// Uso (dalla cartella backend):
//   node test_orchestratore.js            tutte le domande
//   node test_orchestratore.js 4          solo alcune domande (es. "4" oppure "2,3")
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const CARTELLA_PROGETTO = path.resolve(__dirname, "..");
const CARTELLA_VENV = path.join(CARTELLA_PROGETTO, ".venv", "Scripts");

// Tetto alle chiamate OpenAI per tutto il test, applicato dal server
// (orchestratore + embedding + 5 chiamate per ogni analisi del data agent, caso peggiore)
const MAX_CHIAMATE_OPENAI = 30;
const ATTESA_AVVIO_MS = 120_000;

const PORTA_BACKEND = process.env.BACKEND_PORT || 3001;
const URL_BACKEND = `http://localhost:${PORTA_BACKEND}`;

const DOMANDE = [
  "Cosa faccio se una consegna di freschi arriva fuori temperatura?",
  "Di quanto siamo sopra o sotto il budget di vendita di questo mese?",
  "E il mese prima?",
  "Gli scarti di ortofrutta sono aumentati questa settimana: di quanto, e cosa prevede la procedura?",
  "Che tempo farà domani a Lugo?",
];

// Processi avviati, da fermare alla fine
const processi = [];

// Avvia un servizio e ne mostra l'output con un prefisso
function avvia(nome, comando, argomenti, opzioni = {}) {
  const processo = spawn(comando, argomenti, { cwd: CARTELLA_PROGETTO, ...opzioni });
  const stampa = (dati) => {
    for (const riga of dati.toString().split(/\r?\n/)) {
      if (riga.trim()) console.log(`    [${nome}] ${riga}`);
    }
  };
  processo.stdout.on("data", stampa);
  processo.stderr.on("data", stampa);
  processi.push({ nome, processo });
  return processo;
}

// Ferma tutti i servizi (su Windows serve taskkill per chiudere anche i processi figli)
function fermaTutto() {
  for (const { nome, processo } of processi) {
    if (processo.exitCode !== null) continue;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${processo.pid} /T /F`, { stdio: "ignore" });
      } else {
        processo.kill();
      }
      console.log(`Servizio fermato: ${nome}`);
    } catch {
      console.log(`Impossibile fermare ${nome} (pid ${processo.pid})`);
    }
  }
}

// Attende che /api/health risponda con tutti i servizi attivi
async function attendiServizi() {
  const scadenza = Date.now() + ATTESA_AVVIO_MS;
  while (Date.now() < scadenza) {
    try {
      const risposta = await fetch(`${URL_BACKEND}/api/health`);
      const stato = await risposta.json();
      if (risposta.ok) return stato;
    } catch {
      // server non ancora in ascolto
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("I servizi non si sono avviati in tempo");
}

async function inviaDomanda(sessionId, messaggio) {
  const risposta = await fetch(`${URL_BACKEND}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messaggio }),
  });
  return { stato: risposta.status, corpo: await risposta.json() };
}

function mostra(numero, domanda, { stato, corpo }) {
  console.log(`\n${"=".repeat(80)}\n${numero}. ${domanda}\n${"=".repeat(80)}`);
  if (stato !== 200) {
    console.log(`ERRORE ${stato}: ${corpo.errore}`);
    return;
  }
  console.log("Strumenti:");
  if (corpo.strumenti.length === 0) console.log("  (nessuno)");
  corpo.strumenti.forEach((s, i) => console.log(`  ${i + 1}) ${s.nome}: "${s.domanda}"`));
  console.log(`Risposta:\n  ${corpo.risposta.replace(/\n/g, "\n  ")}`);
  console.log("Sezioni consultate:");
  if (corpo.sezioni_consultate.length === 0) console.log("  (nessuna)");
  corpo.sezioni_consultate.forEach((f) => console.log(`  - ${f.sezione} (${f.file})`));
  console.log(`Grafici: ${corpo.grafici.length ? corpo.grafici.join(", ") : "(nessuno)"}`);
  console.log(`Pulizia: ${corpo.pulizia ? "presente" : "null"}`);
  console.log(`Token: ${corpo.token}`);
}

// Verifiche richieste sulle domande 3, 4 e 5 (solo su quelle effettivamente lanciate)
function verifica(risultati) {
  const controlli = [];
  const riuscita = (n) => risultati.has(n) && risultati.get(n).stato === 200;
  const strumenti = (n) => risultati.get(n).corpo.strumenti;

  if (risultati.has(3)) {
    const analisi = riuscita(3) ? strumenti(3).find((s) => s.nome === "analizza_dati") : null;
    controlli.push({
      descrizione: "3: analizza_dati riceve una domanda completa su luglio 2026",
      ok: Boolean(analisi && /luglio/i.test(analisi.domanda) && /2026/.test(analisi.domanda)),
    });
  }

  if (risultati.has(4)) {
    const nomi = riuscita(4) ? strumenti(4).map((s) => s.nome) : [];
    controlli.push({
      descrizione: "4: prima analizza_dati, poi cerca_procedure",
      ok: nomi.includes("analizza_dati") && nomi.indexOf("analizza_dati") < nomi.lastIndexOf("cerca_procedure"),
    });
    // Il periodo deve essere 25-31 agosto 2026 confrontato con 18-24 agosto
    const analisi = riuscita(4) ? strumenti(4).find((s) => s.nome === "analizza_dati") : null;
    const numeri = analisi ? analisi.domanda.match(/\d+/g) ?? [] : [];
    controlli.push({
      descrizione: "4: periodo 25-31 agosto 2026 confrontato con 18-24 agosto",
      ok: Boolean(analisi && /agosto/i.test(analisi.domanda) && ["25", "31", "18", "24"].every((n) => numeri.includes(n))),
    });
  }

  if (risultati.has(5)) {
    // Nessuno strumento e nessuna previsione nella risposta: non deve comparire
    // né una temperatura né una condizione del tempo (il rifiuto può citare la parola "meteo")
    const risposta = riuscita(5) ? risultati.get(5).corpo.risposta : "";
    const contienePrevisione =
      /-?\d+\s*(°|gradi)/i.test(risposta) ||
      /\b(soleggiat\w*|sereno|nuvolos\w*|coperto|pioggi\w*|piovos\w*|temporal\w*|neve|nevicat\w*|nebbi\w*|vento|ventos\w*|precipitazion\w*)\b/i.test(risposta);
    controlli.push({
      descrizione: "5: nessuno strumento e nessuna previsione meteo nella risposta",
      ok: riuscita(5) && strumenti(5).length === 0 && !contienePrevisione,
    });
  }

  console.log(`
${"=".repeat(80)}
VERIFICHE`);
  if (controlli.length === 0) console.log("  (nessuna verifica prevista per queste domande)");
  for (const c of controlli) console.log(`  [${c.ok ? "OK" : "NO"}] ${c.descrizione}`);
  const tokenTotali = [...risultati.values()].reduce((s, r) => s + (r.stato === 200 ? r.corpo.token : 0), 0);
  console.log(`Token totali dell'orchestratore: ${tokenTotali}`);
}

async function main() {
  console.log("Avvio dei servizi...");
  avvia("chroma", path.join(CARTELLA_VENV, "chroma.exe"), [
    "run", "--path", path.join(CARTELLA_PROGETTO, "chroma_data"), "--port", String(process.env.CHROMA_PORT || 8000),
  ]);
  avvia("data agent", path.join(CARTELLA_VENV, "python.exe"), [path.join("data_agent", "app.py")], {
    cwd: CARTELLA_PROGETTO,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  avvia("server", process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, MAX_CHIAMATE_OPENAI: String(MAX_CHIAMATE_OPENAI) },
  });

  const stato = await attendiServizi();
  console.log(`Servizi pronti: ${JSON.stringify(stato)}`);
  console.log(`Limite di chiamate OpenAI per il test: ${MAX_CHIAMATE_OPENAI}`);

  // Domande da lanciare: tutte, oppure quelle indicate sulla riga di comando (es. "4" o "2,3")
  const numeri = process.argv[2]
    ? process.argv[2].split(",").map(Number).filter((n) => n >= 1 && n <= DOMANDE.length)
    : DOMANDE.map((_, i) => i + 1);

  const sessionId = `test-${Date.now()}`;
  const risultati = new Map(); // numero della domanda -> risultato
  for (const numero of numeri) {
    const domanda = DOMANDE[numero - 1];
    const risultato = await inviaDomanda(sessionId, domanda);
    risultati.set(numero, risultato);
    mostra(numero, domanda, risultato);
  }

  verifica(risultati);
}

main()
  .catch((errore) => {
    console.error("Test non riuscito:", errore.message);
    process.exitCode = 1;
  })
  .finally(fermaTutto);
