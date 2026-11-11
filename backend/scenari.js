// Scenari della demo ammessi: data di "oggi" e negozio, definiti solo in scenari.json
// (lo stesso file lo legge anche il data agent). Il front end invia sempre e solo l'id.
// Le date derivate (ieri, inizio settimana, mese corrente...) le calcola il data agent: vedi date_scenario.js.
const fs = require("node:fs");
const path = require("node:path");

const SCENARI = JSON.parse(fs.readFileSync(path.join(__dirname, "scenari.json"), "utf-8"));
const SCENARIO_PREDEFINITO = SCENARI[0].id;

/**
 * Restituisce lo scenario con questo id. Se l'id manca si usa lo scenario predefinito;
 * se c'è ma non è nella lista restituisce null (il chiamante lo rifiuta).
 */
function trovaScenario(id) {
  if (id === undefined || id === null || id === "") return SCENARI.find((s) => s.id === SCENARIO_PREDEFINITO);
  if (typeof id !== "string") return null;
  return SCENARI.find((s) => s.id === id) ?? null;
}

module.exports = { SCENARI, trovaScenario };
