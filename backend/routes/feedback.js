// POST /api/feedback – valutazione di una risposta: {"sessionId", "idMessaggio", "voto": "su" | "giu", "commento"?}.
// Stesso limite di frequenza della chat; nessuna chiamata a OpenAI.
const express = require("express");

const { limiteFrequenza } = require("../limiti");
const { controllaSessione } = require("../sessioni");
const { logger } = require("../log");

function creaRottaFeedback({ feedback }) {
  const router = express.Router();
  router.post("/api/feedback", limiteFrequenza, (req, res, next) => {
    try {
      const { sessionId, idMessaggio, voto, commento } = req.body ?? {};
      controllaSessione(sessionId);
      const riga = feedback.registraVoto({ sessionId, idMessaggio, voto, commento });
      logger.info({ voto: riga.voto, strumenti: riga.strumenti, con_commento: Boolean(riga.commento) }, "valutazione registrata");
      res.json({ ok: true });
    } catch (errore) {
      next(errore);
    }
  });
  return router;
}

module.exports = { creaRottaFeedback };
