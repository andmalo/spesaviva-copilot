// Parti comuni delle rotte /api/chat e /api/azioni/:azione: validazioni e gestore della richiesta
// (annullamento, tetto giornaliero, memoria della sessione, id per le valutazioni, log).
const { MESSAGGI_IN_MEMORIA, TETTO_TOKEN_GIORNALIERO, LINGUE } = require("../config");
const { RichiestaAnnullata, ErroreUtente } = require("../errori");
const { leggiSessione, salvaSessione } = require("../sessioni");
const { controllaTettoGiornaliero, tokenUsatiOggi, chiamateOpenAITotali } = require("../limiti");
const { trovaScenario } = require("../scenari");

// Lingua della risposta: italiano (predefinita) o inglese
function leggiLingua(valore) {
  return Object.hasOwn(LINGUE, valore) ? valore : "it";
}

// Scenario della richiesta: si accetta SOLO l'id di uno scenario della lista (mai date o negozi liberi).
// Se manca si usa lo scenario predefinito.
function leggiScenario(id) {
  const scenario = trovaScenario(id);
  if (!scenario) throw new ErroreUtente(400, "Scenario della demo non valido.", "scenario_non_valido");
  return scenario;
}

/**
 * Crea il gestore Express di una richiesta all'assistente (chat o azione diretta).
 * Struttura comune: annullamento se il front end chiude la connessione, validazione, tetto giornaliero,
 * memoria della sessione, id della risposta per i pollici, riga di log.
 * @param {object} feedback - valutazioni (feedback.js), per l'id della risposta
 * @param {object} opzioni
 * @param {(req) => string} opzioni.etichetta - prefisso del log, es. "chat" oppure "azione briefing"
 * @param {(req) => {sessionId: string, lingua: string, scenario: object}} opzioni.valida
 *   legge e controlla il corpo della richiesta (lancia ErroreUtente)
 * @param {(dati: object, storico: Array, segnale: AbortSignal) => Promise<{esito: object, domanda: string,
 *   rispostaPerMemoria: string, rispostaPerFeedback: string, extra?: object}>} opzioni.esegui
 *   esegue la richiesta; extra si aggiunge al JSON della risposta
 */
function gestisciRichiesta(feedback, { etichetta, valida, esegui }) {
  return async (req, res, next) => {
    const inizio = Date.now();
    const nome = etichetta(req);

    // Se il front end chiude la connessione prima della risposta, si interrompono ciclo e chiamate.
    // Si ascolta "close" sulla risposta: sulla richiesta scatta già quando il corpo è stato letto.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const dati = valida(req);
      controllaTettoGiornaliero();
      const storico = leggiSessione(dati.sessionId, dati.scenario);
      const { esito, domanda, rispostaPerMemoria, rispostaPerFeedback, extra } = await esegui(dati, storico, controller.signal);

      // In memoria salvo solo domanda e risposta finale, e solo se la richiesta è riuscita:
      // così dopo si può chiedere in chat, per esempio, "e la settimana prima?"
      const aggiornato = [...storico, { role: "user", content: domanda }, { role: "assistant", content: rispostaPerMemoria }];
      salvaSessione(dati.sessionId, aggiornato.slice(-MESSAGGI_IN_MEMORIA), dati.scenario);
      // Id della risposta, per la valutazione con i pollici
      esito.id_messaggio = feedback.ricordaRisposta({
        sessionId: dati.sessionId, scenario: dati.scenario.id, domanda, strumenti: esito.strumenti, risposta: rispostaPerFeedback,
      });

      // Log della richiesta: strumenti, token e tempo
      const elencoStrumenti = esito.strumenti.map((s) => s.nome).join(" -> ") || "nessuno";
      const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
      console.log(
        `[${nome}] strumenti: ${elencoStrumenti} | token: ${esito.token} | tempo: ${secondi}s | ` +
          `token oggi: ${tokenUsatiOggi()}/${TETTO_TOKEN_GIORNALIERO} | chiamate OpenAI totali: ${chiamateOpenAITotali()}`
      );
      res.json(extra ? { ...esito, ...extra } : esito);
    } catch (errore) {
      const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
      if (errore instanceof RichiestaAnnullata) {
        // Il front end non aspetta più: nessuna risposta da inviare e niente salvato in memoria
        console.log(`[${nome}] richiesta annullata dal client | tempo: ${secondi}s | chiamate OpenAI totali: ${chiamateOpenAITotali()}`);
        return;
      }
      console.log(`[${nome}] richiesta non riuscita (${errore.name}) | tempo: ${secondi}s | chiamate OpenAI totali: ${chiamateOpenAITotali()}`);
      next(errore);
    }
  };
}

module.exports = { leggiLingua, leggiScenario, gestisciRichiesta };
