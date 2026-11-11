// Limiti di sicurezza e di spesa: limite di frequenza, tetto di token giornaliero, tetto di chiamate OpenAI.
const { rateLimit } = require("express-rate-limit");

const { LIMITE_RICHIESTE_MINUTO, TETTO_TOKEN_GIORNALIERO, MAX_CHIAMATE_OPENAI } = require("./config");
const { ErroreUtente } = require("./errori");
const { contesto } = require("./log");

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

// Data di oggi (ora locale) nel formato AAAA-MM-GG, per azzerare il tetto giornaliero
function oggiLocale() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Token usati oggi (orchestratore + data agent), azzerati al cambio di data
const consumoGiornaliero = { giorno: oggiLocale(), token: 0 };

// Token usati oggi; al cambio di data il contatore riparte da zero
function tokenUsatiOggi() {
  const oggi = oggiLocale();
  if (consumoGiornaliero.giorno !== oggi) {
    consumoGiornaliero.giorno = oggi;
    consumoGiornaliero.token = 0;
  }
  return consumoGiornaliero.token;
}

function aggiungiTokenOggi(token) {
  tokenUsatiOggi(); // eventuale azzeramento al cambio di data
  consumoGiornaliero.token += token;
}

// Blocca la richiesta se il tetto di token di oggi è già stato raggiunto
function controllaTettoGiornaliero() {
  if (tokenUsatiOggi() >= TETTO_TOKEN_GIORNALIERO) {
    throw new ErroreUtente(429, "È stato raggiunto il limite di utilizzo giornaliero dell'assistente. Riprova domani.", "tetto_giornaliero");
  }
}

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
  limiteFrequenza, tokenUsatiOggi, aggiungiTokenOggi, controllaTettoGiornaliero, prenotaChiamate, chiamateOpenAITotali,
};
