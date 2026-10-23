// Valutazione delle risposte (pollice su / pollice giù, con commento facoltativo).
// Il server ricorda ogni risposta inviata con un id; il front end manda solo sessionId, id, voto
// e commento: domanda, strumenti e risposta salvati nel file vengono dal server, non dal browser.
// Ogni voto è una riga JSON in feedback.jsonl (escluso da git).
const fs = require("node:fs");
const crypto = require("node:crypto");

const MAX_COMMENTO = 300;              // caratteri del commento
const MAX_RISPOSTA_SALVATA = 500;      // caratteri della risposta salvati nel file
const MAX_RISPOSTE_RICORDATE = 500;    // risposte votabili tenute in memoria (le più vecchie si dimenticano)
const SCADENZA_MS = 60 * 60 * 1000;    // come le sessioni: dopo un'ora non si può più votare
const VOTI = ["su", "giu"];

/**
 * @param {object} opzioni
 * @param {string} opzioni.percorsoFile - file JSONL dei voti
 * @param {typeof Error} opzioni.ErroreUtente - errore con messaggio mostrabile (stato, messaggio, codice)
 */
function creaFeedback({ percorsoFile, ErroreUtente }) {
  // idMessaggio -> { sessionId, scenario, domanda, strumenti, risposta, creata, votata }
  const risposte = new Map();

  function pulisci() {
    const limite = Date.now() - SCADENZA_MS;
    for (const [id, r] of risposte) if (r.creata < limite) risposte.delete(id);
    while (risposte.size > MAX_RISPOSTE_RICORDATE) risposte.delete(risposte.keys().next().value);
  }

  /** Ricorda una risposta appena inviata e restituisce il suo id. */
  function ricordaRisposta({ sessionId, scenario, domanda, strumenti, risposta }) {
    const id = crypto.randomUUID();
    risposte.set(id, {
      sessionId, scenario, domanda,
      strumenti: [...new Set((strumenti ?? []).map((s) => s.nome))],
      risposta: String(risposta ?? ""),
      creata: Date.now(),
      votata: false,
    });
    pulisci();
    return id;
  }

  /** Controlla il voto e lo aggiunge al file. Lancia ErroreUtente se i dati non vanno bene. */
  function registraVoto({ sessionId, idMessaggio, voto, commento }) {
    if (typeof idMessaggio !== "string" || idMessaggio.length > 100) {
      throw new ErroreUtente(400, "Valutazione non valida.", "feedback_non_valido");
    }
    if (!VOTI.includes(voto)) throw new ErroreUtente(400, "Valutazione non valida.", "feedback_non_valido");
    if (commento !== undefined && commento !== null && typeof commento !== "string") {
      throw new ErroreUtente(400, "Valutazione non valida.", "feedback_non_valido");
    }
    const testoCommento = (commento ?? "").trim();
    if (testoCommento.length > MAX_COMMENTO) {
      throw new ErroreUtente(400, `Il commento è troppo lungo: al massimo ${MAX_COMMENTO} caratteri.`, "commento_lungo");
    }

    pulisci();
    const r = risposte.get(idMessaggio);
    // Si può votare solo una risposta della propria sessione, ancora in memoria
    if (!r || r.sessionId !== sessionId) {
      throw new ErroreUtente(404, "Questa risposta non si può più valutare.", "feedback_scaduto");
    }
    if (r.votata) throw new ErroreUtente(409, "Questa risposta è già stata valutata.", "feedback_doppio");

    const riga = {
      data: new Date().toISOString(),
      scenario: r.scenario,
      domanda: r.domanda,
      strumenti: r.strumenti,
      voto,
      // Il commento si chiede solo dopo il pollice giù
      commento: voto === "giu" && testoCommento ? testoCommento : null,
      risposta: r.risposta.length > MAX_RISPOSTA_SALVATA ? `${r.risposta.slice(0, MAX_RISPOSTA_SALVATA)}…` : r.risposta,
    };
    fs.appendFileSync(percorsoFile, JSON.stringify(riga) + "\n", "utf-8");
    r.votata = true;
    return riga;
  }

  return { ricordaRisposta, registraVoto };
}

module.exports = { creaFeedback, MAX_COMMENTO, MAX_RISPOSTA_SALVATA };
