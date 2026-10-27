// Test degli scenari della demo, SENZA chiamate a OpenAI.
// Avvia il data agent e il server (con MAX_CHIAMATE_OPENAI=0), poi per ogni scenario
// chiama gli strumenti deterministici prepara_briefing e controlla_soglie e mostra
// le anomalie trovate; infine verifica che uno scenario non valido venga rifiutato.
// Alla fine ferma tutti i servizi.
//
// Uso (dalla cartella backend):  node test_scenari.js
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const { SCENARI, dateScenario } = require("./scenari");
const { ultimaSettimanaCompleta } = require("./azioni");
const { STRUMENTI, indirizzoDataAgent } = require("./strumenti");

const CARTELLA_PROGETTO = path.resolve(__dirname, "..");
const PYTHON = process.platform === "win32"
  ? path.join(CARTELLA_PROGETTO, ".venv", "Scripts", "python.exe")
  : path.join(CARTELLA_PROGETTO, ".venv", "bin", "python");
const URL_BACKEND = `http://127.0.0.1:${process.env.BACKEND_PORT || 3001}`;
const ATTESA_AVVIO_MS = 60_000;

// Processi avviati, da fermare alla fine
const processi = [];
function avvia(nome, comando, argomenti, opzioni = {}) {
  const processo = spawn(comando, argomenti, { cwd: CARTELLA_PROGETTO, ...opzioni });
  const stampa = (dati) => {
    for (const riga of dati.toString().split(/\r?\n/)) {
      // Si mostrano solo errori e avvisi, per non coprire i risultati del test
      if (/error|errore|warning|traceback/i.test(riga)) console.log(`    [${nome}] ${riga}`);
    }
  };
  processo.stdout.on("data", stampa);
  processo.stderr.on("data", stampa);
  processi.push({ nome, processo });
}

function fermaTutto() {
  for (const { nome, processo } of processi) {
    if (processo.exitCode !== null) continue;
    try {
      if (process.platform === "win32") execSync(`taskkill /PID ${processo.pid} /T /F`, { stdio: "ignore" });
      else processo.kill();
      console.log(`Servizio fermato: ${nome}`);
    } catch {
      console.log(`Impossibile fermare ${nome} (pid ${processo.pid})`);
    }
  }
}

// Attende che un indirizzo risponda 200
async function attendi(url) {
  const scadenza = Date.now() + ATTESA_AVVIO_MS;
  while (Date.now() < scadenza) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // non ancora in ascolto
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Nessuna risposta da ${url}`);
}

let falliti = 0;
function verifica(descrizione, condizione) {
  console.log(`  ${condizione ? "OK  " : "NO  "} ${descrizione}`);
  if (!condizione) falliti++;
}

async function post(url, corpo) {
  const risposta = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  return { stato: risposta.status, corpo: await risposta.json().catch(() => null) };
}

// Cosa ci si aspetta di vedere in ciascuno scenario
const ATTESE = {
  tranquilla: (b) => verifica("riconoscimento per la panetteria",
    b.riconoscimenti.some((r) => r.reparto === "panetteria")),
  caldo: (b) => verifica("ortofrutta sopra soglia da più giorni consecutivi",
    b.anomalie.some((a) => a.tipo === "scarti_sopra_soglia" && a.reparto === "ortofrutta")),
  fornitore: (b, s) => verifica("consegne in ritardo sopra soglia",
    b.anomalie.some((a) => a.tipo === "consegne_in_ritardo")
      || (s.dati?.controlli?.settimane ?? []).some((w) => w.consegne_in_ritardo >= 3)),
};

async function main() {
  console.log("Avvio dei servizi (nessuna chiamata a OpenAI)...");
  avvia("data agent", PYTHON, ["data_agent/app.py"], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  avvia("server", "node", ["server.js"], { cwd: __dirname, env: { ...process.env, MAX_CHIAMATE_OPENAI: "0" } });
  await attendi(`${indirizzoDataAgent()}/health`);
  await attendi(`${URL_BACKEND}/api/scenari`);

  for (const scenario of SCENARI) {
    const d = dateScenario(scenario);
    console.log(`\n${"=".repeat(80)}\nScenario "${scenario.id}": oggi ${d.oggiEsteso}, negozio ${scenario.negozio}\n${"=".repeat(80)}`);

    const b = await STRUMENTI.prepara_briefing(undefined, scenario.id);
    if (!b.anomalie) {
      console.log(`  Briefing non riuscito: ${b.testoPerLLM}`);
      falliti++;
      continue;
    }
    console.log("Briefing - anomalie:");
    if (!b.anomalie.length) console.log("  (nessuna)");
    for (const a of b.anomalie) console.log(`  - ${a.testo}`);
    console.log("Briefing - riconoscimenti:");
    if (!b.riconoscimenti.length) console.log("  (nessuno)");
    for (const r of b.riconoscimenti) console.log(`  - ${r.reparto}: ${JSON.stringify(r)}`);

    const periodo = ultimaSettimanaCompleta(scenario.oggi);
    const s = await STRUMENTI.controlla_soglie(periodo, undefined, scenario.id);
    console.log(`Soglie (${periodo.inizio} - ${periodo.fine}):`);
    console.log(s.testoPerLLM.split("\n").map((r) => `  ${r}`).join("\n"));

    console.log("Verifiche:");
    verifica(`dati del briefing di ieri (${d.ieriIso})`, b.testoPerLLM.includes(d.ieriIso) || b.testoPerLLM.includes(String(d.ieri.getDate())));
    ATTESE[scenario.id](b, s);
    // Eccedenze donate: kg calcolati a mano dal CSV (ultima settimana completa)
    const kgAttesi = { tranquilla: [31, 160.9], caldo: [20.6, 134.4], fornitore: [24, 147.1] }[scenario.id];
    console.log(`Eccedenze donate: ${JSON.stringify(b.eccedenze)}`);
    verifica(`eccedenze nel briefing: ieri ${kgAttesi[0]} kg, settimana ${kgAttesi[1]} kg`,
      b.eccedenze?.ieri === kgAttesi[0] && b.eccedenze?.settimana === kgAttesi[1]);
    verifica("riga delle eccedenze nel testo per l'LLM", b.testoPerLLM.includes("eccedenze donate (in kg)"));
    verifica("regole fisse del calcolo in briefing e soglie (Come l'ho calcolato)",
      b.calcolo?.tipo === "regole" && b.calcolo.testo.includes("senza modello linguistico")
        && s.calcolo?.tipo === "regole" && s.calcolo.testo.includes("Consegne in ritardo"));
    const kgReport = String(kgAttesi[1]).replace(".", ",");
    verifica(`riga delle eccedenze nei KPI del report (${kgReport} kg)`, s.dati.testoKpi.includes(`eccedenze donate: ${kgReport} kg`));
  }

  console.log(`\n${"=".repeat(80)}\nConfronto tra negozi (agosto 2026, scenario "tranquilla")\n${"=".repeat(80)}`);
  const c = await STRUMENTI.confronta_negozi({ inizio: "2026-08-01", fine: "2026-08-31" }, undefined, "tranquilla");
  console.log(c.testoPerLLM.split("\n").map((r) => `  ${r}`).join("\n"));
  verifica("NEG01 3,55% contro 3,71% degli altri negozi",
    c.testoPerLLM.includes("NEG01: complessivo 3,55%") && c.testoPerLLM.includes("complessivo 3,71%"));
  verifica("NEG05 panetteria 12,14% segnalata", c.testoPerLLM.includes("NEG05 panetteria 12,14%"));
  verifica("regole fisse per Come l'ho calcolato", c.calcolo?.tipo === "regole");
  // Scenario "fornitore" (NEG03, oggi 10 marzo 2026): la fine del periodo si ferma a ieri
  const cf = await STRUMENTI.confronta_negozi({ inizio: "2026-03-01", fine: "2026-03-31" }, undefined, "fornitore");
  verifica("scenario fornitore: confronto per NEG03 limitato al 9 marzo",
    cf.testoPerLLM.includes("NEG03: complessivo") && cf.testoPerLLM.includes("limitato al 2026-03-09"));

  console.log(`\n${"=".repeat(80)}\nScenari non validi\n${"=".repeat(80)}`);
  const sessionId = crypto.randomUUID();
  for (const valore of ["inventato", "2026-01-01", { oggi: "2020-01-01", negozio: "NEG02" }, 3]) {
    const chat = await post(`${URL_BACKEND}/api/chat`, { sessionId, messaggio: "Ciao", scenario: valore });
    verifica(`/api/chat rifiuta scenario ${JSON.stringify(valore)} (stato ${chat.stato}, codice ${chat.corpo?.codice})`,
      chat.stato === 400 && chat.corpo?.codice === "scenario_non_valido");
  }
  const azione = await post(`${URL_BACKEND}/api/azioni/briefing`, { sessionId, scenario: "NEG03" });
  verifica(`/api/azioni/briefing rifiuta scenario "NEG03" (stato ${azione.stato})`, azione.stato === 400);
  const agente = await post(`${indirizzoDataAgent()}/briefing`, { scenario: "inventato" });
  verifica(`il data agent rifiuta scenario "inventato" (stato ${agente.stato})`, agente.stato === 400);
  const soglie = await post(`${indirizzoDataAgent()}/soglie`, { inizio: "2026-08-24", fine: "2026-08-30", scenario: "x" });
  verifica(`/soglie del data agent rifiuta scenario "x" (stato ${soglie.stato})`, soglie.stato === 400);
}

main()
  .catch((errore) => {
    console.error(`Test interrotto: ${errore.message}`);
    falliti++;
  })
  .finally(() => {
    fermaTutto();
    console.log(falliti ? `\n${falliti} verifiche NON superate` : "\nTutte le verifiche superate");
    process.exitCode = falliti ? 1 : 0;
  });
