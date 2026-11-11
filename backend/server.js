// Avvio dell'orchestratore: controlla la configurazione, crea l'app (app.js) e la mette in ascolto.
// I moduli: config.js (variabili e costanti), errori.js, sessioni.js, limiti.js, orchestratore.js
// (ciclo di function calling), routes/ (rotte HTTP), app.js (Express).
//
// Avvio (dalla cartella backend, con ChromaDB e data agent avviati): node server.js
const config = require("./config");

// Prima di caricare gli altri moduli: il client OpenAI richiede la chiave
config.controllaConfigurazione();

const { creaApp } = require("./app");
const { pulisciSessioni } = require("./sessioni");

const app = creaApp();

// Pulizia periodica delle sessioni scadute (unref: non impedisce al processo di chiudersi)
setInterval(pulisciSessioni, 10 * 60 * 1000).unref();

app.listen(config.PORTA, config.INDIRIZZO_ASCOLTO, () => {
  console.log(
    `Orchestratore in ascolto su http://${config.INDIRIZZO_ASCOLTO}:${config.PORTA} (modello: ${config.MODELLO}, ` +
      `max ${config.LIMITE_RICHIESTE_MINUTO} richieste/minuto, tetto ${config.TETTO_TOKEN_GIORNALIERO} token/giorno)`
  );
});
