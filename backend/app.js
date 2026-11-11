// Applicazione Express: middleware, rotte, front end compilato (in produzione) e gestione degli errori.
const path = require("node:path");
const express = require("express");
const cors = require("cors");

const { PRODUZIONE, ORIGINE_FRONT_END, CARTELLA_FRONT_END, FILE_FEEDBACK } = require("./config");
const { ErroreUtente, gestoreErrori } = require("./errori");
const { creaFeedback } = require("./feedback");
const { creaRottaChat } = require("./routes/chat");
const { creaRottaAzioni } = require("./routes/azioni");
const { creaRottaFeedback } = require("./routes/feedback");
const { rotteServizi } = require("./routes/servizi");

function creaApp() {
  // Valutazioni delle risposte: una riga per voto in feedback.jsonl (FILE_FEEDBACK solo per i test)
  const feedback = creaFeedback({ percorsoFile: FILE_FEEDBACK, ErroreUtente });

  const app = express();

  // Dietro il proxy della piattaforma: l'IP del visitatore arriva in X-Forwarded-For,
  // così il limite di frequenza vale per ogni visitatore e non per tutti insieme
  if (PRODUZIONE) app.set("trust proxy", 1);

  // CORS abilitato solo per il front end React in sviluppo (in produzione è sullo stesso indirizzo)
  app.use(cors({ origin: ORIGINE_FRONT_END }));
  app.use(express.json({ limit: "20kb" }));

  app.use(creaRottaChat({ feedback }));
  app.use(creaRottaAzioni({ feedback }));
  app.use(creaRottaFeedback({ feedback }));
  app.use(rotteServizi);

  // In produzione: pagine del front end compilato (npm run build); ogni altro indirizzo non /api
  // riceve index.html, che poi gestisce React
  if (PRODUZIONE) {
    app.use(express.static(CARTELLA_FRONT_END));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(CARTELLA_FRONT_END, "index.html"));
    });
  }

  app.use(gestoreErrori);
  return app;
}

module.exports = { creaApp };
