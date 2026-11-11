// Applicazione Express: middleware, rotte, front end compilato (in produzione) e gestione degli errori.
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");

const { PRODUZIONE, ORIGINE_FRONT_END, CARTELLA_FRONT_END, FILE_FEEDBACK } = require("./config");
const { ErroreUtente, gestoreErrori } = require("./errori");
const { logger, archivioContesto } = require("./log");
const { creaFeedback } = require("./feedback");
const { creaRottaChat } = require("./routes/chat");
const { creaRottaAzioni } = require("./routes/azioni");
const { creaRottaFeedback } = require("./routes/feedback");
const { rotteServizi } = require("./routes/servizi");

// Rotte di servizio, chiamate spesso (controllo di Render, grafici): la loro riga di log è a livello debug
const ROTTE_DI_SERVIZIO = /^\/api\/(health|scenari|grafici\/)/;

/**
 * Crea il contesto della richiesta (requestId, rotta, scenario, strumenti, token, cache) e,
 * quando la risposta si chiude, scrive una sola riga di log con l'esito.
 * Mai testi delle domande o delle risposte: solo nomi, numeri e codici.
 */
function registraRichiesta(req, res, next) {
  const inizio = performance.now();
  const contesto = {
    requestId: crypto.randomUUID(),
    rotta: req.originalUrl.split("?")[0],
    scenario: null,
    strumenti: [],
    tokenIngresso: 0,
    tokenUscita: 0,
    cache: false, // true se la risposta viene dalla cache (routes/chat.js)
    codice: null,
  };
  res.locals.contesto = contesto;

  res.on("close", () => {
    const completata = res.writableFinished;
    const errore = res.statusCode >= 400;
    const riga = {
      requestId: contesto.requestId,
      metodo: req.method,
      rotta: contesto.rotta,
      scenario: contesto.scenario,
      strumenti: contesto.strumenti,
      durata_ms: Math.round(performance.now() - inizio),
      esito: !completata ? "annullata" : errore ? "errore" : "ok",
      stato: completata ? res.statusCode : null,
      ...(errore && completata && { codice: contesto.codice ?? `http_${res.statusCode}` }),
      token_ingresso: contesto.tokenIngresso,
      token_uscita: contesto.tokenUscita,
      cache: contesto.cache,
      ...contesto.extra,
    };
    if (completata && res.statusCode >= 500) logger.error(riga, "richiesta completata");
    else if (!errore && ROTTE_DI_SERVIZIO.test(contesto.rotta)) logger.debug(riga, "richiesta completata");
    else logger.info(riga, "richiesta completata");
  });

  archivioContesto.run(contesto, next);
}

function creaApp() {
  // Valutazioni delle risposte: una riga per voto in feedback.jsonl (FILE_FEEDBACK solo per i test)
  const feedback = creaFeedback({ percorsoFile: FILE_FEEDBACK, ErroreUtente });

  const app = express();

  // Dietro il proxy della piattaforma: l'IP del visitatore arriva in X-Forwarded-For,
  // così il limite di frequenza vale per ogni visitatore e non per tutti insieme
  if (PRODUZIONE) app.set("trust proxy", 1);

  // Ogni richiesta /api ha un requestId e una riga di log quando finisce
  app.use("/api", registraRichiesta);

  // CORS abilitato solo per il front end React in sviluppo (in produzione è sullo stesso indirizzo)
  app.use(cors({ origin: ORIGINE_FRONT_END }));
  app.use(express.json({ limit: "20kb" }));
  // La lettura del corpo può perdere il contesto asincrono: lo si rientra qui
  app.use("/api", (req, res, next) => archivioContesto.run(res.locals.contesto, next));

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
