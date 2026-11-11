// Limiti di sicurezza e di spesa: limite di frequenza, tetto di token giornaliero, tetto di chiamate OpenAI.
//
// Il contatore dei token del giorno deve sopravvivere ai riavvii (su Render gratuito il servizio si spegne
// dopo 15 minuti senza visite, e il suo disco si azzera): sta in un ARCHIVIO esterno al processo.
// Due implementazioni con la stessa interfaccia { nome, leggi(chiave), aggiungi(chiave, token) }:
// - Redis, se è impostata REDIS_URL (in produzione: il Key Value di Render);
// - un file JSON, se REDIS_URL manca (uso in locale).
// Il resto del codice usa solo controllaTettoGiornaliero(), aggiungiTokenOggi() e tokenUsatiOggi().
//
// Il giorno si calcola sempre con il fuso Europe/Rome, non con quello del server (Render usa UTC).
// Se l'archivio non risponde, per sicurezza le nuove richieste si rifiutano (mai accettate senza limite).
const fs = require("node:fs");
const path = require("node:path");
const { rateLimit } = require("express-rate-limit");

const { LIMITE_RICHIESTE_MINUTO, TETTO_TOKEN_GIORNALIERO, MAX_CHIAMATE_OPENAI } = require("./config");
const { ErroreUtente } = require("./errori");
const { logger, contesto } = require("./log");

// Limite di frequenza su /api/chat (e azioni e valutazioni, con lo stesso contatore):
// oltre la soglia risponde 429 con un messaggio in italiano
const limiteFrequenza = rateLimit({
  windowMs: 60 * 1000,
  limit: LIMITE_RICHIESTE_MINUTO,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { errore: "Troppe richieste in poco tempo: aspetta un minuto e riprova.", codice: "troppe_richieste" },
  // Come il gestore predefinito, più il codice per la riga di log di fine richiesta
  handler: (req, res, next, opzioni) => {
    if (contesto()) contesto().codice = opzioni.message.codice;
    res.status(opzioni.statusCode).send(opzioni.message);
  },
});

// ---------------------------------------------------------------------------
// Giorno e chiavi
// ---------------------------------------------------------------------------

const FUSO_ORARIO = "Europe/Rome";
const SCADENZA_CHIAVE_S = 48 * 60 * 60; // le chiavi di un giorno restano 48 ore, poi si cancellano da sole
const formatoGiorno = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_ORARIO, year: "numeric", month: "2-digit", day: "2-digit" });

/** Giorno AAAA-MM-GG a Roma per l'istante dato (es. 31/10 alle 23:30 UTC -> "2026-11-01"). */
const giornoRoma = (data) => formatoGiorno.format(data);
const chiaveToken = (giorno) => `token:${giorno}`;

// ---------------------------------------------------------------------------
// Archivi
// ---------------------------------------------------------------------------

/**
 * Archivio su file JSON ({"token:2026-11-11": 1234, ...}), per l'uso in locale.
 * Scrittura atomica (file temporaneo + rinomina); le chiavi più vecchie di 2 giorni si tolgono.
 */
function creaArchivioFile(percorso) {
  function leggiTutto() {
    try {
      return JSON.parse(fs.readFileSync(percorso, "utf-8"));
    } catch (errore) {
      if (errore.code === "ENOENT") return {};
      throw errore; // file illeggibile o rovinato: meglio rifiutare le richieste che ripartire da zero
    }
  }
  return {
    nome: "file",
    async leggi(chiave) {
      return Number(leggiTutto()[chiave]) || 0;
    },
    async aggiungi(chiave, token) {
      const dati = leggiTutto();
      dati[chiave] = (Number(dati[chiave]) || 0) + token;
      // Come la scadenza di Redis: i giorni finiti da più di 48 ore non servono più
      for (const altra of Object.keys(dati)) {
        const fineGiorno = Date.parse(altra.replace(/^token:/, "")) + 24 * 60 * 60 * 1000;
        if (fineGiorno + SCADENZA_CHIAVE_S * 1000 < Date.now()) delete dati[altra];
      }
      const temporaneo = `${percorso}.${process.pid}.tmp`;
      fs.writeFileSync(temporaneo, JSON.stringify(dati, null, 2));
      fs.renameSync(temporaneo, percorso);
      return dati[chiave];
    },
  };
}

/** Rifiuta se la promessa non si risolve entro ms (un Redis che non risponde non deve bloccare le richieste). */
function conTimeout(promessa, ms) {
  let timer;
  const scadenza = new Promise((_, rifiuta) => {
    timer = setTimeout(() => rifiuta(new Error("archivio: nessuna risposta in tempo")), ms);
  });
  return Promise.race([promessa, scadenza]).finally(() => clearTimeout(timer));
}

/**
 * Archivio su Redis: INCRBY (atomico anche con più istanze del server) e scadenza di 48 ore.
 * @param {object} client - client Redis con get(chiave), incrBy(chiave, n), expire(chiave, secondi)
 */
function creaArchivioRedis(client, { timeoutMs = 2000 } = {}) {
  return {
    nome: "redis",
    async leggi(chiave) {
      return Number(await conTimeout(client.get(chiave), timeoutMs)) || 0;
    },
    async aggiungi(chiave, token) {
      const totale = await conTimeout(client.incrBy(chiave, token), timeoutMs);
      await conTimeout(client.expire(chiave, SCADENZA_CHIAVE_S), timeoutMs);
      return Number(totale);
    },
  };
}

/** Client Redis reale: nessuna coda di comandi quando la connessione manca (falliscono subito). */
function creaClientRedis(url) {
  const { createClient } = require("redis");
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 5000, reconnectStrategy: (tentativi) => Math.min(tentativi * 500, 5000) },
  });
  // Un solo avviso quando la connessione cade e una riga quando torna (non uno a ogni tentativo)
  let connesso = false;
  let avvisato = false;
  client.on("ready", () => {
    connesso = true;
    logger.info({ archivio: "redis" }, "archivio del contatore dei token collegato");
  });
  client.on("error", (errore) => {
    if (connesso || !avvisato) logger.error({ archivio: "redis", errore: errore.name }, "archivio del contatore dei token non raggiungibile");
    connesso = false;
    avvisato = true;
  });
  client.connect().catch(() => { /* gestito dall'evento "error"; si riprova da soli */ });
  return client;
}

// ---------------------------------------------------------------------------
// Contatore dei token del giorno
// ---------------------------------------------------------------------------

const MESSAGGIO_NON_VERIFICABILE =
  "Al momento non è possibile verificare il limite di spesa giornaliero dell'assistente: riprova tra qualche minuto.";

/**
 * Contatore dei token del giorno su un archivio.
 * @param {object} opzioni
 * @param {object} opzioni.archivio - creaArchivioFile() o creaArchivioRedis()
 * @param {number} opzioni.tetto - token massimi al giorno
 * @param {() => Date} [opzioni.adesso] - orologio (i test lo spostano a mezzanotte)
 */
function creaContatoreToken({ archivio, tetto, adesso = () => new Date() }) {
  // Token che non si sono potuti salvare (archivio non raggiungibile): si aggiungono al primo salvataggio riuscito
  const inSospeso = new Map(); // giorno -> token

  async function tokenUsatiOggi() {
    const giorno = giornoRoma(adesso());
    return (await archivio.leggi(chiaveToken(giorno))) + (inSospeso.get(giorno) ?? 0);
  }

  // Blocca la richiesta se il tetto di oggi è raggiunto, o se non si può verificare
  async function controllaTettoGiornaliero() {
    let usati;
    try {
      usati = await tokenUsatiOggi();
    } catch (errore) {
      logger.error({ archivio: archivio.nome, errore: errore.message }, "limite di spesa non verificabile: richiesta rifiutata");
      throw new ErroreUtente(503, MESSAGGIO_NON_VERIFICABILE, "limite_spesa_non_verificabile");
    }
    if (usati >= tetto) {
      throw new ErroreUtente(429, "È stato raggiunto il limite di utilizzo giornaliero dell'assistente. Riprova domani.", "tetto_giornaliero");
    }
  }

  // Somma i token di una chiamata già fatta (la risposta non si blocca se il salvataggio non riesce)
  async function aggiungiTokenOggi(token) {
    if (!Number.isFinite(token) || token <= 0) return;
    const giorno = giornoRoma(adesso());
    inSospeso.set(giorno, (inSospeso.get(giorno) ?? 0) + token);
    // Si prelevano prima di salvarli: due chiamate contemporanee non salvano due volte gli stessi token
    const daSalvare = [...inSospeso];
    inSospeso.clear();
    for (const [indice, [g, n]] of daSalvare.entries()) {
      try {
        await archivio.aggiungi(chiaveToken(g), n);
      } catch (errore) {
        // Quelli non salvati tornano in sospeso, per il prossimo tentativo
        for (const [gg, nn] of daSalvare.slice(indice)) inSospeso.set(gg, (inSospeso.get(gg) ?? 0) + nn);
        logger.error({ archivio: archivio.nome, errore: errore.message, token_in_sospeso: n },
          "token non salvati nel contatore: riprovo alla prossima chiamata");
        return;
      }
    }
  }

  return { tokenUsatiOggi, controllaTettoGiornaliero, aggiungiTokenOggi, archivio: archivio.nome };
}

// Archivio di questo processo: Redis se c'è REDIS_URL, altrimenti un file accanto al server
// (FILE_CONTATORE_TOKEN solo per i test)
function archivioDaEnv() {
  if (process.env.REDIS_URL) return creaArchivioRedis(creaClientRedis(process.env.REDIS_URL));
  return creaArchivioFile(process.env.FILE_CONTATORE_TOKEN || path.join(__dirname, "contatore_token.json"));
}

const contatore = creaContatoreToken({ archivio: archivioDaEnv(), tetto: TETTO_TOKEN_GIORNALIERO });

// ---------------------------------------------------------------------------
// Tetto di chiamate OpenAI (facoltativo, per i test: resta in memoria)
// ---------------------------------------------------------------------------

// Chiamate OpenAI prenotate finora, per tutta la vita del server
let chiamateOpenAIUsate = 0;

// Prenota n chiamate OpenAI nel tetto massimo; restituisce false se si sforerebbe
function prenotaChiamate(n) {
  if (chiamateOpenAIUsate + n > MAX_CHIAMATE_OPENAI) return false;
  chiamateOpenAIUsate += n;
  return true;
}

const chiamateOpenAITotali = () => chiamateOpenAIUsate;

module.exports = {
  limiteFrequenza,
  tokenUsatiOggi: contatore.tokenUsatiOggi,
  aggiungiTokenOggi: contatore.aggiungiTokenOggi,
  controllaTettoGiornaliero: contatore.controllaTettoGiornaliero,
  archivioContatore: contatore.archivio,
  prenotaChiamate, chiamateOpenAITotali,
  // per i test
  creaContatoreToken, creaArchivioFile, creaArchivioRedis, giornoRoma, SCADENZA_CHIAVE_S,
};
