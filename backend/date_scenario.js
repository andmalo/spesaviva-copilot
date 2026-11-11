// Date di riferimento degli scenari (ieri, inizio settimana, mese corrente, ultima settimana completa).
// Le calcola SOLO il data agent (GET /scenari/{id}/date, vedi data_agent/date_scenario.py):
// così orchestratore e data agent usano sempre le stesse date.
// Per ogni scenario sono fisse: si chiedono una volta e restano in memoria. Se il data agent
// non risponde, la richiesta non riesce e alla successiva si riprova.
const { indirizzoDataAgent } = require("./strumenti");

const TIMEOUT_DATE_MS = 5000;

// id dello scenario -> Promise delle date (condivisa dalle richieste che arrivano insieme)
const datePerScenario = new Map();

// Il data agent non ha restituito le date (spento, non ancora pronto o in errore)
class DateNonDisponibili extends Error {}

async function chiediDate(idScenario) {
  let risposta;
  try {
    risposta = await fetch(`${indirizzoDataAgent()}/scenari/${encodeURIComponent(idScenario)}/date`, {
      signal: AbortSignal.timeout(TIMEOUT_DATE_MS),
    });
  } catch (errore) {
    console.error(`[date_scenario] data agent non raggiungibile (${errore.name})`);
    throw new DateNonDisponibili();
  }
  if (!risposta.ok) {
    console.error(`[date_scenario] il data agent ha risposto con stato ${risposta.status}`);
    throw new DateNonDisponibili();
  }
  return risposta.json();
}

/**
 * Date dello scenario, come le restituisce il data agent:
 * { oggi, ieri, inizio_settimana, mese_corrente, ultima_settimana_completa: {inizio, fine},
 *   oggi_esteso, ieri_esteso, inizio_settimana_esteso }.
 * @throws {DateNonDisponibili} se il data agent non risponde
 */
function dateScenario(scenario) {
  if (!datePerScenario.has(scenario.id)) {
    const promessa = chiediDate(scenario.id);
    datePerScenario.set(scenario.id, promessa);
    promessa.catch(() => datePerScenario.delete(scenario.id)); // niente in memoria: si riprova dopo
  }
  return datePerScenario.get(scenario.id);
}

module.exports = { dateScenario, DateNonDisponibili };
