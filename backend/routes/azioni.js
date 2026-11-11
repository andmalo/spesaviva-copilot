// POST /api/azioni/:azione – azioni dirette dei pulsanti: {"sessionId": "...", "lingua": "it" | "en", "scenario"?}.
// Gli strumenti li chiama il codice (../azioni.js); stessi limiti di frequenza e di token della chat.
const express = require("express");

const { ErroreUtente } = require("../errori");
const { limiteFrequenza } = require("../limiti");
const { controllaSessione } = require("../sessioni");
const { AZIONI, creaAzioni } = require("../azioni");
const { chiamaModello, componiMessaggi, dateDelloScenario } = require("../orchestratore");
const { leggiLingua, leggiScenario, gestisciRichiesta } = require("./comune");

function leggiRichiestaAzione(req) {
  if (!AZIONI.includes(req.params.azione)) {
    throw new ErroreUtente(404, "Azione non disponibile.", "azione_sconosciuta");
  }
  const { sessionId } = req.body ?? {};
  const lingua = leggiLingua(req.body?.lingua);
  const scenario = leggiScenario(req.body?.scenario);
  controllaSessione(sessionId);
  return { sessionId, lingua, scenario, azione: req.params.azione };
}

function creaRottaAzioni({ feedback }) {
  // Azioni dirette (briefing, soglie, report), con gli stessi servizi della chat
  const azioni = creaAzioni({ chiamaModello, componiMessaggi, dateScenario: dateDelloScenario });

  const router = express.Router();
  router.post("/api/azioni/:azione", limiteFrequenza, gestisciRichiesta(feedback, {
    etichetta: (req) => `azione ${req.params.azione}`,
    valida: leggiRichiestaAzione,
    esegui: async ({ azione, lingua, scenario }, storico, segnale) => {
      const { esito, richiesta, rispostaPerMemoria } = await azioni.eseguiAzione(azione, { lingua, storico, segnale, scenario });
      return {
        esito,
        // In memoria vanno la richiesta (con il periodo esplicito) e la risposta, come per la chat
        domanda: richiesta,
        rispostaPerMemoria,
        // Per il report si salva anche la bozza della mail, non solo la frase che la presenta
        rispostaPerFeedback: esito.report ? `${esito.risposta}\n\n${esito.report.oggetto}\n${esito.report.corpo}` : esito.risposta,
        extra: { azione, richiesta },
      };
    },
  }));
  return router;
}

module.exports = { creaRottaAzioni };
