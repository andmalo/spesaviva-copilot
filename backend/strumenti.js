// Strumenti che l'orchestratore mette a disposizione dell'LLM.
// Ogni strumento restituisce un oggetto con:
//   - testoPerLLM: l'unico contenuto che viene rimandato al modello
//   - gli altri campi (fonti, grafico, pulizia) restano al server e finiscono
//     solo nella risposta al front end
//   - chiamateOpenAI: quante chiamate a OpenAI può aver fatto lo strumento,
//     usato per il tetto massimo di chiamate
const path = require("node:path");

// Carico le variabili dal file .env della cartella principale del progetto
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const { cercaProcedure } = require("./rag/cerca");

// Parametri della ricerca nel manuale
const NUMERO_RISULTATI = 3;  // sezioni chieste a ChromaDB
const DISTANZA_MASSIMA = 0.4; // oltre questa distanza del coseno la sezione è considerata non pertinente

// Parametri della chiamata al data agent
const TIMEOUT_DATA_AGENT_MS = 120_000;
// Il data agent fa al massimo 5 passi per domanda (MAX_PASSI_PER_DOMANDA in data_agent/app.py):
// nel conteggio delle chiamate a OpenAI si considera sempre il caso peggiore
const CHIAMATE_MASSIME_DATA_AGENT = 5;

// Indirizzo base del data agent, sulla porta DATA_AGENT_PORT del .env
function indirizzoDataAgent() {
  return `http://127.0.0.1:${process.env.DATA_AGENT_PORT || 8001}`;
}

/**
 * Cerca nel manuale le sezioni pertinenti alla domanda.
 * All'LLM passa il testo di ogni sezione con file e titolo.
 */
async function cerca_procedure(domanda) {
  let risultati;
  try {
    risultati = await cercaProcedure(domanda, NUMERO_RISULTATI);
  } catch (errore) {
    // Nel log solo il tipo di errore: il messaggio originale potrebbe contenere dati sensibili
    console.error(`[cerca_procedure] ricerca non riuscita (${errore.name})`);
    return {
      testoPerLLM: "Errore: la ricerca nel manuale non è al momento disponibile. Avvisa lo Store Manager che non è possibile consultare le procedure e di riprovare più tardi.",
      fonti: [],
      // la domanda viene comunque trasformata in embedding prima dell'eventuale errore
      chiamateOpenAI: 1,
    };
  }

  // Tengo solo le sezioni abbastanza vicine alla domanda
  const pertinenti = risultati.filter((r) => r.distanza <= DISTANZA_MASSIMA);
  if (pertinenti.length === 0) {
    return { testoPerLLM: "Nessuna sezione pertinente trovata nel manuale", fonti: [], chiamateOpenAI: 1 };
  }

  const fonti = pertinenti.map((r) => ({ file: r.metadati.file, sezione: r.metadati.sezione }));
  const testoPerLLM = pertinenti
    .map((r) => `[File: ${r.metadati.file} | Sezione: ${r.metadati.sezione}]\n${r.testo}`)
    .join("\n\n---\n\n");

  return { testoPerLLM, fonti, chiamateOpenAI: 1 };
}

/**
 * Fa analizzare la domanda al data agent (POST /analizza).
 * All'LLM passa solo il testo della risposta: URL del grafico e riepilogo
 * della pulizia vengono conservati per il front end.
 */
async function analizza_dati(domanda) {
  const erroreGenerico = {
    grafico: null,
    pulizia: null,
    chiamateOpenAI: CHIAMATE_MASSIME_DATA_AGENT,
  };

  let risposta;
  try {
    risposta = await fetch(`${indirizzoDataAgent()}/analizza`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domanda }),
      signal: AbortSignal.timeout(TIMEOUT_DATA_AGENT_MS),
    });
  } catch (errore) {
    // Servizio spento oppure tempo scaduto
    const tempoScaduto = errore.name === "TimeoutError";
    console.error(`[analizza_dati] data agent non raggiungibile (${errore.name})`);
    return {
      ...erroreGenerico,
      testoPerLLM: tempoScaduto
        ? "Errore: l'analisi dei dati ha impiegato più di 120 secondi ed è stata interrotta. Avvisa lo Store Manager e suggerisci di riprovare con una domanda più semplice."
        : "Errore: il servizio di analisi dei dati non risponde. Avvisa lo Store Manager che al momento non è possibile analizzare i dati del negozio e di riprovare più tardi.",
    };
  }

  if (!risposta.ok) {
    // Il data agent restituisce già messaggi d'errore in italiano, senza dettagli sensibili
    let dettaglio = "errore sconosciuto";
    try {
      const corpo = await risposta.json();
      if (typeof corpo.detail === "string") dettaglio = corpo.detail;
    } catch {
      // corpo non leggibile: resta il messaggio generico
    }
    console.error(`[analizza_dati] il data agent ha risposto con stato ${risposta.status}`);
    return {
      ...erroreGenerico,
      testoPerLLM: `Errore: l'analisi dei dati non è riuscita (${dettaglio}). Avvisa lo Store Manager e non inventare numeri.`,
    };
  }

  const dati = await risposta.json();
  return {
    testoPerLLM: dati.risposta,
    grafico: dati.grafico || null,
    pulizia: dati.pulizia ?? null,
    chiamateOpenAI: CHIAMATE_MASSIME_DATA_AGENT,
  };
}

// Mappa nome dello strumento -> funzione, usata dal ciclo di function calling
const STRUMENTI = { cerca_procedure, analizza_dati };

module.exports = { STRUMENTI, CHIAMATE_MASSIME_DATA_AGENT, indirizzoDataAgent };
