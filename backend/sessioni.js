// Memoria delle conversazioni: sessionId -> { messaggi, ultimoUso, scenario }.
// Si conservano solo le domande dell'utente e le risposte finali, non i passaggi intermedi.
// L'ordine della Map è quello dell'ultimo uso: la prima sessione è la meno recente.
const { MAX_SESSIONI, SCADENZA_SESSIONE_MS } = require("./config");
const { ErroreUtente } = require("./errori");

const sessioni = new Map();

// Elimina le sessioni inattive da più di un'ora
function pulisciSessioni() {
  const limite = Date.now() - SCADENZA_SESSIONE_MS;
  for (const [id, sessione] of sessioni) {
    if (sessione.ultimoUso < limite) sessioni.delete(id);
  }
}

// Storico di una sessione (vuoto se non esiste o è scaduta)
function leggiSessione(sessionId, scenario) {
  pulisciSessioni();
  const sessione = sessioni.get(sessionId);
  // La memoria vale solo per lo stesso scenario (data e negozio diversi = conversazione diversa)
  if (!sessione || sessione.scenario !== scenario.id) return [];
  return sessione.messaggi;
}

// Salva lo storico e sposta la sessione in fondo (la più recente); oltre 100 si toglie la più vecchia
function salvaSessione(sessionId, messaggi, scenario) {
  sessioni.delete(sessionId);
  sessioni.set(sessionId, { messaggi, ultimoUso: Date.now(), scenario: scenario.id });
  while (sessioni.size > MAX_SESSIONI) {
    sessioni.delete(sessioni.keys().next().value);
  }
}

// Controlla il sessionId inviato dal front end
function controllaSessione(sessionId) {
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 100) {
    throw new ErroreUtente(400, "Sessione non valida.", "sessione_non_valida");
  }
}

module.exports = { pulisciSessioni, leggiSessione, salvaSessione, controllaSessione };
