// POST /api/chat – domanda dell'utente: {"sessionId": "...", "messaggio": "...", "lingua"?, "scenario"?}
// Con la cache delle risposte (cache.js): solo domande identiche, solo all'inizio di una conversazione.
const express = require("express");

const {
  LUNGHEZZA_MASSIMA_MESSAGGIO, MODELLO, MODELLO_DATA_AGENT, CACHE_MAX_VOCI, CACHE_TTL_MINUTI,
} = require("../config");
const { ErroreUtente } = require("../errori");
const { limiteFrequenza } = require("../limiti");
const { controllaSessione } = require("../sessioni");
const { rispondi, motivoNonInCache, MODELLO_PROMPT, DEFINIZIONI_STRUMENTI } = require("../orchestratore");
const { indirizzoDataAgent } = require("../strumenti");
const { creaCache, chiaveCache, sha256 } = require("../cache");
const { logger, intestazioniRichiesta } = require("../log");
const { leggiLingua, leggiScenario, gestisciRichiesta } = require("./comune");

const TIMEOUT_VERSIONE_MS = 3000;

function leggiRichiestaChat(req) {
  const { sessionId, messaggio } = req.body ?? {};
  const lingua = leggiLingua(req.body?.lingua);
  const scenario = leggiScenario(req.body?.scenario);

  controllaSessione(sessionId);
  if (typeof messaggio !== "string") {
    throw new ErroreUtente(400, "Il messaggio deve essere un testo.", "messaggio_non_valido");
  }
  if (!messaggio.trim()) {
    throw new ErroreUtente(400, "Il messaggio è vuoto: scrivi una domanda.", "messaggio_vuoto");
  }
  const testo = messaggio.trim();
  if (testo.length > LUNGHEZZA_MASSIMA_MESSAGGIO) {
    throw new ErroreUtente(400, `Il messaggio è troppo lungo: al massimo ${LUNGHEZZA_MASSIMA_MESSAGGIO} caratteri.`, "messaggio_lungo");
  }
  return { sessionId, lingua, scenario, testo };
}

/**
 * Versione dei dati e del data agent (GET /versione): impronta sha256 dei dati, modello e hash del prompt.
 * Si chiede a ogni domanda che può usare la cache (chiamata locale, senza OpenAI): se il data agent
 * riparte con un CSV diverso, l'impronta cambia e le risposte vecchie non si usano più.
 * Se non risponde: null, e la domanda va al modello senza cache.
 */
async function versioneDataAgent() {
  try {
    const risposta = await fetch(`${indirizzoDataAgent()}/versione`, {
      headers: intestazioniRichiesta(), signal: AbortSignal.timeout(TIMEOUT_VERSIONE_MS),
    });
    if (!risposta.ok) throw new Error(`stato ${risposta.status}`);
    const versione = await risposta.json();
    if (typeof versione.impronta_dati !== "string" || !versione.impronta_dati) throw new Error("impronta mancante");
    return versione;
  } catch (errore) {
    logger.warn({ errore: errore.message }, "versione dei dati non disponibile: domanda senza cache");
    return null;
  }
}

function creaRottaChat({ feedback }) {
  const cache = creaCache({ maxVoci: CACHE_MAX_VOCI, ttlMs: CACHE_TTL_MINUTI * 60 * 1000 });
  // Prompt e strumenti dell'orchestratore non cambiano mentre il server è acceso
  const versionePromptOrchestratore = sha256(MODELLO_PROMPT + JSON.stringify(DEFINIZIONI_STRUMENTI));

  // Chiave della domanda, oppure null se la cache non vale per questa richiesta
  async function chiaveDellaDomanda({ testo, lingua, scenario }, storico) {
    // Con la memoria conversazionale la stessa domanda può avere un significato diverso
    if (storico.length > 0) return null;
    const versione = await versioneDataAgent();
    if (!versione) return null;
    return chiaveCache({
      domanda: testo, scenario: scenario.id, lingua, versioneDati: versione.impronta_dati,
      modelloOrchestratore: MODELLO, modelloDataAgent: versione.modello || MODELLO_DATA_AGENT,
      versionePrompt: sha256(versionePromptOrchestratore + (versione.prompt ?? "")),
    });
  }

  const router = express.Router();
  router.post("/api/chat", limiteFrequenza, gestisciRichiesta(feedback, {
    etichetta: () => "chat",
    valida: leggiRichiestaChat,
    dallaCache: async (dati, storico) => {
      dati.chiaveCache = await chiaveDellaDomanda(dati, storico);
      const salvato = dati.chiaveCache ? cache.leggi(dati.chiaveCache) : undefined;
      if (!salvato) return null;
      // Dalla cache: nessun token consumato
      const esito = { ...salvato, token: 0 };
      return { esito, domanda: dati.testo, rispostaPerMemoria: esito.risposta, rispostaPerFeedback: esito.risposta };
    },
    esegui: async ({ testo, lingua, scenario, chiaveCache: chiave }, storico, segnale) => {
      const esito = await rispondi(storico, testo, segnale, lingua, scenario);
      if (chiave) {
        const motivo = motivoNonInCache(esito);
        if (motivo) logger.debug({ motivo }, "risposta non salvata in cache");
        else cache.salva(chiave, esito);
      }
      return { esito, domanda: testo, rispostaPerMemoria: esito.risposta, rispostaPerFeedback: esito.risposta };
    },
  }));
  return router;
}

module.exports = { creaRottaChat };
