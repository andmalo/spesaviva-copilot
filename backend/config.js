// Configurazione del back end: variabili d'ambiente (.env) e costanti.
const path = require("node:path");

// Carico le variabili dal file .env della cartella principale del progetto
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { logger } = require("./log");

// In produzione (contenitore Docker su Render) il server è l'unico servizio esposto:
// ascolta sulla porta assegnata dalla piattaforma e serve anche il front end compilato.
// Data agent e ChromaDB restano su 127.0.0.1 dentro il contenitore.
const PRODUZIONE = process.env.MODALITA === "produzione";
const PORTA = Number((PRODUZIONE && process.env.PORT) || process.env.BACKEND_PORT || 3001);
// In locale solo localhost: il back end non deve essere raggiungibile dagli altri dispositivi della rete
const INDIRIZZO_ASCOLTO = PRODUZIONE ? "0.0.0.0" : "127.0.0.1";
const ORIGINE_FRONT_END = "http://localhost:5173";
const CARTELLA_FRONT_END = path.resolve(__dirname, "..", "frontend", "dist");

const LUNGHEZZA_MASSIMA_MESSAGGIO = 1000; // caratteri
const MESSAGGI_IN_MEMORIA = 10;           // ultimi messaggi della sessione mandati all'LLM
const MAX_ITERAZIONI = 6;                 // chiamate al modello per ogni richiesta
const MAX_TOKEN_RISPOSTA = 1000;          // token massimi generati in una singola chiamata
const TIMEOUT_OPENAI_MS = 60_000;         // tempo massimo per una singola chiamata a OpenAI

// Sessioni in memoria: numero massimo e scadenza dopo un periodo di inattività
const MAX_SESSIONI = 100;
const SCADENZA_SESSIONE_MS = 60 * 60 * 1000; // 1 ora

// Lingue supportate: italiano (predefinita) e inglese
const LINGUE = { it: "italiano", en: "inglese" };

// Legge un numero intero positivo dal .env, con un valore di default se manca o non è valido
function numeroDaEnv(nome, predefinito) {
  const valore = Number(process.env[nome]);
  return Number.isInteger(valore) && valore > 0 ? valore : predefinito;
}

// Limite di frequenza su /api/chat e tetto di token giornaliero (configurabili nel .env)
const LIMITE_RICHIESTE_MINUTO = numeroDaEnv("LIMITE_RICHIESTE_MINUTO", 10);
const TETTO_TOKEN_GIORNALIERO = numeroDaEnv("TETTO_TOKEN_GIORNALIERO", 300_000);

// Tetto facoltativo alle chiamate OpenAI per tutta la vita del server (usato dal test).
// Conta le chiamate dell'orchestratore, gli embedding della ricerca e, per il data agent,
// sempre il caso peggiore di 5 chiamate. Se la variabile manca non c'è limite.
const MAX_CHIAMATE_OPENAI = process.env.MAX_CHIAMATE_OPENAI ? Number(process.env.MAX_CHIAMATE_OPENAI) : Infinity;

const MODELLO = process.env.ORCHESTRATOR_MODEL;

// File delle valutazioni con i pollici (FILE_FEEDBACK solo per i test)
const FILE_FEEDBACK = process.env.FILE_FEEDBACK || path.join(__dirname, "feedback.jsonl");

// Controllo all'avvio che la configurazione necessaria sia presente
// (data e negozio non servono più: vengono dallo scenario della demo, in scenari.json).
// Va chiamato prima di caricare gli altri moduli: il client OpenAI richiede la chiave.
function controllaConfigurazione() {
  for (const variabile of ["OPENAI_API_KEY", "ORCHESTRATOR_MODEL"]) {
    if (!process.env[variabile]) {
      logger.error({ variabile }, "variabile mancante nel file .env");
      process.exit(1);
    }
  }
  if (process.env.ORCHESTRATOR_MODEL === "nome-del-modello") {
    logger.error({ variabile: "ORCHESTRATOR_MODEL" }, "il file .env contiene ancora il valore di esempio");
    process.exit(1);
  }
}

module.exports = {
  PRODUZIONE, PORTA, INDIRIZZO_ASCOLTO, ORIGINE_FRONT_END, CARTELLA_FRONT_END,
  LUNGHEZZA_MASSIMA_MESSAGGIO, MESSAGGI_IN_MEMORIA, MAX_ITERAZIONI, MAX_TOKEN_RISPOSTA, TIMEOUT_OPENAI_MS,
  MAX_SESSIONI, SCADENZA_SESSIONE_MS, LINGUE,
  LIMITE_RICHIESTE_MINUTO, TETTO_TOKEN_GIORNALIERO, MAX_CHIAMATE_OPENAI, MODELLO, FILE_FEEDBACK,
  controllaConfigurazione,
};
