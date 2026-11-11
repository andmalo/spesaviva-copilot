// Errori del back end: classi, traduzione degli errori di OpenAI e gestore centralizzato di Express.
// Al front end vanno solo messaggi fissi in italiano, mai il testo originale di un errore.
const OpenAI = require("openai");
const { logger, contesto } = require("./log");

// Errore lanciato quando il front end chiude la richiesta prima della risposta
class RichiestaAnnullata extends Error {}

// Errore con un messaggio fisso in italiano, che si può mostrare al front end.
// Il codice (facoltativo) permette al front end di mostrare il messaggio nella lingua scelta.
class ErroreUtente extends Error {
  constructor(stato, messaggio, codice = null) {
    super(messaggio);
    this.stato = stato;
    this.codice = codice;
  }
}

// Traduce gli errori di OpenAI in messaggi fissi: il testo originale non va mai al front end
// perché potrebbe contenere parti della chiave API
function erroreOpenAI(errore) {
  if (errore instanceof OpenAI.AuthenticationError) {
    return new ErroreUtente(500, "Il servizio di intelligenza artificiale non è configurato correttamente.");
  }
  if (errore instanceof OpenAI.RateLimitError) {
    return new ErroreUtente(503, "Il servizio di intelligenza artificiale è momentaneamente sovraccarico. Riprova tra qualche minuto.");
  }
  if (errore instanceof OpenAI.APIConnectionTimeoutError) {
    return new ErroreUtente(504, "Il servizio di intelligenza artificiale non ha risposto in tempo. Riprova.");
  }
  if (errore instanceof OpenAI.APIConnectionError) {
    return new ErroreUtente(503, "Impossibile collegarsi al servizio di intelligenza artificiale. Riprova più tardi.");
  }
  if (errore instanceof OpenAI.BadRequestError) {
    return new ErroreUtente(500, "Il servizio di intelligenza artificiale ha rifiutato la richiesta.");
  }
  return new ErroreUtente(500, "Si è verificato un errore interno. Riprova più tardi.");
}

// Gestione centralizzata degli errori: solo messaggi fissi in italiano
// Express riconosce il gestore degli errori dai 4 parametri: _next serve anche se non si usa
function gestoreErrori(errore, req, res, _next) {
  if (errore instanceof ErroreUtente) {
    // Il codice va nella riga di log di fine richiesta
    if (contesto() && errore.codice) contesto().codice = errore.codice;
    return res.status(errore.stato).json({ errore: errore.message, codice: errore.codice });
  }
  // JSON malformato o corpo troppo grande (errori generati da express.json)
  if (errore.type === "entity.parse.failed") {
    return res.status(400).json({ errore: "La richiesta non è in un formato valido." });
  }
  if (errore.type === "entity.too.large") {
    return res.status(413).json({ errore: "La richiesta è troppo grande." });
  }
  logger.error({ errore: errore.name }, "errore imprevisto");
  res.status(500).json({ errore: "Si è verificato un errore interno. Riprova più tardi." });
}

module.exports = { RichiestaAnnullata, ErroreUtente, erroreOpenAI, gestoreErrori };
