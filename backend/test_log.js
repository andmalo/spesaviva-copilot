// Test del log strutturato del back end (log.js), SENZA servizi e senza chiamate a OpenAI:
// formato JSON e leggibile, requestId dal contesto, livello, filtro dei segreti, troncamento della domanda.
//
// Uso (dalla cartella backend):  node test_log.js
process.env.CHIAVE_DI_PROVA_KEY = "valore-riservato-di-prova";
const { creaLogger, oscura, taglia, archivioContesto, intestazioniRichiesta, aggiungiTokenRichiesta } = require("./log");

let falliti = 0;
function verifica(descrizione, ok) {
  console.log(`  ${ok ? "OK  " : "NO  "} ${descrizione}`);
  if (!ok) falliti++;
}

function scriviIn(righe) {
  return (testo) => righe.push(testo);
}

console.log("\nFormato JSON e requestId");
const righeJson = [];
const logJson = creaLogger({ livello: "info", formato: "json", scrivi: scriviIn(righeJson) });
const contesto = { requestId: "11111111-2222-3333-4444-555555555555", tokenIngresso: 0, tokenUscita: 0 };
archivioContesto.run(contesto, () => {
  logJson.info({ rotta: "/api/chat", durata_ms: 12 }, "richiesta completata");
  verifica("intestazione X-Request-Id per il data agent", intestazioniRichiesta()["X-Request-Id"] === contesto.requestId);
  aggiungiTokenRichiesta(10, 5);
  aggiungiTokenRichiesta(3, undefined);
});
const dati = JSON.parse(righeJson[0]);
verifica("una riga JSON con level, servizio, msg", dati.level === "info" && dati.servizio === "backend" && dati.msg === "richiesta completata");
verifica("requestId preso dal contesto della richiesta", dati.requestId === contesto.requestId);
verifica("campi della riga", dati.rotta === "/api/chat" && dati.durata_ms === 12);
verifica(`token della richiesta sommati (${contesto.tokenIngresso}/${contesto.tokenUscita})`, contesto.tokenIngresso === 13 && contesto.tokenUscita === 5);
verifica("fuori da una richiesta: nessuna intestazione", Object.keys(intestazioniRichiesta()).length === 0);

console.log("\nLivello");
logJson.debug("non deve comparire");
verifica("al livello info le righe debug non si scrivono", righeJson.length === 1);
const righeDebug = [];
creaLogger({ livello: "debug", formato: "json", scrivi: scriviIn(righeDebug) }).debug("compare");
verifica("al livello debug sì", righeDebug.length === 1);

console.log("\nFormato leggibile");
const righeLeggibili = [];
creaLogger({ livello: "info", formato: "leggibile", scrivi: scriviIn(righeLeggibili) })
  .warn({ esito: "ok", strumenti: ["cerca_procedure", "analizza_dati"] }, "richiesta completata");
const r = righeLeggibili[0];
console.log(`    ${r.trim()}`);
verifica("livello, messaggio e campi chiave=valore", r.includes("WARN  richiesta completata") && r.includes("esito=ok")
  && r.includes("strumenti=cerca_procedure,analizza_dati"));

console.log("\nFiltro dei segreti");
const righeSegrete = [];
creaLogger({ livello: "info", formato: "json", scrivi: scriviIn(righeSegrete) })
  .error({ dettaglio: "chiave sk-proj-abc123", altro: "valore-riservato-di-prova" }, "errore con sk-xyz");
const s = righeSegrete[0];
verifica("niente chiavi sk-... né valori riservati nella riga", !s.includes("sk-proj") && !s.includes("sk-xyz")
  && !s.includes("valore-riservato-di-prova") && (s.match(/\[riservato\]/g) ?? []).length === 3);
verifica("parole come task-list restano intatte", oscura("task-list") === "task-list");

console.log("\nDomanda al livello debug");
verifica("al massimo 200 battute", taglia("a".repeat(500)) === `${"a".repeat(200)}…` && taglia("breve") === "breve");

console.log(falliti ? `\n${falliti} verifiche NON superate` : "\nTutte le verifiche superate");
process.exitCode = falliti ? 1 : 0;
