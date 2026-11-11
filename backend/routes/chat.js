// POST /api/chat – domanda dell'utente: {"sessionId": "...", "messaggio": "...", "lingua"?, "scenario"?}
const express = require("express");

const { LUNGHEZZA_MASSIMA_MESSAGGIO } = require("../config");
const { ErroreUtente } = require("../errori");
const { limiteFrequenza } = require("../limiti");
const { controllaSessione } = require("../sessioni");
const { rispondi } = require("../orchestratore");
const { leggiLingua, leggiScenario, gestisciRichiesta } = require("./comune");

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

function creaRottaChat({ feedback }) {
  const router = express.Router();
  router.post("/api/chat", limiteFrequenza, gestisciRichiesta(feedback, {
    etichetta: () => "chat",
    valida: leggiRichiestaChat,
    esegui: async ({ testo, lingua, scenario }, storico, segnale) => {
      const esito = await rispondi(storico, testo, segnale, lingua, scenario);
      return { esito, domanda: testo, rispostaPerMemoria: esito.risposta, rispostaPerFeedback: esito.risposta };
    },
  }));
  return router;
}

module.exports = { creaRottaChat };
