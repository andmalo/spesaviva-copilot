// Scenari della demo: data di "oggi" e negozio, definiti solo in scenari.json
// (lo stesso file lo legge anche il data agent). Il front end invia sempre e solo l'id.
const fs = require("node:fs");
const path = require("node:path");

const SCENARI = JSON.parse(fs.readFileSync(path.join(__dirname, "scenari.json"), "utf-8"));
const SCENARIO_PREDEFINITO = SCENARI[0].id;

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

// Date in ora locale a mezzogiorno, per non avere problemi con l'ora legale
const daIso = (iso) => new Date(`${iso}T12:00:00`);
const piuGiorni = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const aIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// "martedì 1 settembre 2026"
const dataEstesa = (d) => d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * Restituisce lo scenario con questo id. Se l'id manca si usa lo scenario predefinito;
 * se c'è ma non è nella lista restituisce null (il chiamante lo rifiuta).
 */
function trovaScenario(id) {
  if (id === undefined || id === null || id === "") return SCENARI.find((s) => s.id === SCENARIO_PREDEFINITO);
  if (typeof id !== "string") return null;
  return SCENARI.find((s) => s.id === id) ?? null;
}

/** Date derivate dello scenario, con la stessa logica del data agent. */
function dateScenario(scenario) {
  const oggi = daIso(scenario.oggi);
  const ieri = piuGiorni(oggi, -1);
  const inizioSettimana = piuGiorni(ieri, -6);
  const ultimoDelMese = new Date(ieri.getFullYear(), ieri.getMonth() + 1, 0, 12);
  const mese = `${MESI[ieri.getMonth()]} ${ieri.getFullYear()}`;
  // Se ieri è l'ultimo giorno del mese, il mese è completo; altrimenti è ancora in corso
  const meseCorrente = ieri.getDate() === ultimoDelMese.getDate()
    ? `${mese}, l'ultimo mese completo nei dati`
    : `${mese}, il mese in corso (dati dal 1 al ${ieri.getDate()} ${MESI[ieri.getMonth()]} ${ieri.getFullYear()})`;
  return {
    oggi, ieri, inizioSettimana, meseCorrente,
    oggiIso: aIso(oggi), ieriIso: aIso(ieri),
    oggiEsteso: dataEstesa(oggi), ieriEsteso: dataEstesa(ieri), inizioSettimanaEsteso: dataEstesa(inizioSettimana),
  };
}

module.exports = { SCENARI, SCENARIO_PREDEFINITO, trovaScenario, dateScenario };
