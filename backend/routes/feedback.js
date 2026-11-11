// POST /api/feedback – valutazione di una risposta: {"sessionId", "idMessaggio", "voto": "su" | "giu", "commento"?}.
// Stesso limite di frequenza della chat; nessuna chiamata a OpenAI.
const express = require("express");

const { limiteFrequenza } = require("../limiti");
const { controllaSessione } = require("../sessioni");

function creaRottaFeedback({ feedback }) {
  const router = express.Router();
  router.post("/api/feedback", limiteFrequenza, (req, res, next) => {
    try {
      const { sessionId, idMessaggio, voto, commento } = req.body ?? {};
      controllaSessione(sessionId);
      const riga = feedback.registraVoto({ sessionId, idMessaggio, voto, commento });
      console.log(`[feedback] voto: ${riga.voto} | strumenti: ${riga.strumenti.join(", ") || "nessuno"}${riga.commento ? " | con commento" : ""}`);
      res.json({ ok: true });
    } catch (errore) {
      next(errore);
    }
  });
  return router;
}

module.exports = { creaRottaFeedback };
