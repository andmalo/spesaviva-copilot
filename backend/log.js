// Log strutturato del back end (pino), con l'identificativo della richiesta in ogni riga.
//
// LOG_LEVEL: debug, info, warn, error (predefinito info).
// LOG_FORMAT: json oppure leggibile (predefinito: json in produzione, leggibile in locale).
//
// Regole: mai la chiave API, mai il testo completo delle risposte o il codice generato;
// al livello debug al massimo le prime 200 battute della domanda (vedi taglia()).
// Ogni riga passa dal filtro dei segreti (oscura()) prima di essere scritta.
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const pino = require("pino");

// Il .env può non essere ancora stato letto (per esempio dai test che caricano solo strumenti.js)
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const LIVELLI = ["debug", "info", "warn", "error"];
const MAX_CARATTERI_DOMANDA = 200;

function livelloDaEnv() {
  const valore = (process.env.LOG_LEVEL || "").trim().toLowerCase();
  return LIVELLI.includes(valore) ? valore : "info";
}

function formatoDaEnv() {
  const valore = (process.env.LOG_FORMAT || "").trim().toLowerCase();
  if (valore === "json" || valore === "leggibile") return valore;
  return process.env.MODALITA === "produzione" ? "json" : "leggibile";
}

// --- Filtro dei segreti ---------------------------------------------------------
// Stessa regola del data agent (contiene_dati_riservati): "sk-" (inizio delle chiavi OpenAI)
// e i valori delle variabili riservate. Qui le variabili riservate sono quelle con nomi da segreto.
const NOMI_RISERVATI = /KEY|TOKEN|SECRET|PASSWORD|REDIS_URL/i;
const SEGNAPOSTO = "[riservato]";

function valoriRiservati() {
  return Object.entries(process.env)
    .filter(([nome, valore]) => NOMI_RISERVATI.test(nome) && valore && valore.length >= 6)
    .map(([, valore]) => valore)
    .sort((a, b) => b.length - a.length);
}

/** Toglie dal testo le chiavi "sk-..." e i valori delle variabili riservate. */
function oscura(testo) {
  // \b: "sk-" a inizio parola, così parole come "task-..." restano intatte
  let pulito = testo.replace(/\bsk-[^\s"'\\,;]*/g, SEGNAPOSTO);
  for (const valore of valoriRiservati()) pulito = pulito.split(valore).join(SEGNAPOSTO);
  return pulito;
}

/** Le prime 200 battute di un testo (solo per il livello debug). */
function taglia(testo) {
  if (typeof testo !== "string") return testo;
  return testo.length > MAX_CARATTERI_DOMANDA ? `${testo.slice(0, MAX_CARATTERI_DOMANDA)}…` : testo;
}

// --- Contesto della richiesta ------------------------------------------------------
// Ogni richiesta HTTP ha il suo contesto (requestId, rotta, scenario, strumenti, token, cache):
// i moduli lo aggiornano e a fine richiesta diventa una riga di log (vedi app.js).
const archivioContesto = new AsyncLocalStorage();

const contesto = () => archivioContesto.getStore();

/** Intestazioni per le chiamate al data agent: lo stesso requestId, per seguire la richiesta nei due servizi. */
function intestazioniRichiesta() {
  const c = contesto();
  return c ? { "X-Request-Id": c.requestId } : {};
}

/** Somma i token di una chiamata al modello (orchestratore o data agent) nel contesto della richiesta. */
function aggiungiTokenRichiesta(ingresso, uscita) {
  const c = contesto();
  if (!c) return;
  c.tokenIngresso += Number.isFinite(ingresso) ? ingresso : 0;
  c.tokenUscita += Number.isFinite(uscita) ? uscita : 0;
}

// --- Formato leggibile ---------------------------------------------------------------
// "10:15:02 INFO  richiesta completata requestId=... rotta=/api/chat durata_ms=812 esito=ok"
const CAMPI_FISSI = new Set(["time", "level", "msg", "servizio"]);

function valoreLeggibile(valore) {
  if (Array.isArray(valore)) return valore.join(",") || "-";
  if (valore !== null && typeof valore === "object") return JSON.stringify(valore);
  const testo = String(valore);
  return /\s/.test(testo) ? JSON.stringify(testo) : testo;
}

function rigaLeggibile(riga) {
  const dati = JSON.parse(riga);
  const ora = typeof dati.time === "string" ? dati.time.slice(11, 19) : "";
  const campi = Object.entries(dati)
    .filter(([chiave]) => !CAMPI_FISSI.has(chiave))
    .map(([chiave, valore]) => `${chiave}=${valoreLeggibile(valore)}`);
  return `${ora} ${String(dati.level).toUpperCase().padEnd(5)} ${dati.msg ?? ""}${campi.length ? ` ${campi.join(" ")}` : ""}\n`;
}

/** Destinazione delle righe: filtro dei segreti, poi JSON o formato leggibile. */
function creaDestinazione(formato, scrivi = (testo) => process.stdout.write(testo)) {
  return {
    write(riga) {
      const pulita = oscura(riga);
      scrivi(formato === "json" ? pulita : rigaLeggibile(pulita));
    },
  };
}

/** Crea un logger (esportata per i test, che passano una destinazione propria). */
function creaLogger({ livello = livelloDaEnv(), formato = formatoDaEnv(), scrivi } = {}) {
  return pino({
    level: livello,
    base: { servizio: "backend" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (etichetta) => ({ level: etichetta }) },
    // Ogni riga scritta durante una richiesta porta il suo requestId
    mixin: () => (contesto() ? { requestId: contesto().requestId } : {}),
  }, creaDestinazione(formato, scrivi));
}

const logger = creaLogger();

module.exports = {
  logger, creaLogger, oscura, taglia, archivioContesto, contesto, intestazioniRichiesta, aggiungiTokenRichiesta,
};
