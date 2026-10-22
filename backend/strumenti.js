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
const TIMEOUT_BRIEFING_MS = 30_000; // il briefing non usa l'LLM: bastano pochi secondi
// Il data agent fa al massimo 5 passi per domanda (MAX_PASSI_PER_DOMANDA in data_agent/app.py):
// nel conteggio delle chiamate a OpenAI si considera sempre il caso peggiore
const CHIAMATE_MASSIME_DATA_AGENT = 5;

// Segnale che scatta per il timeout oppure quando il front end chiude la richiesta
function segnaleConTimeout(millisecondi, segnaleRichiesta) {
  const segnali = [AbortSignal.timeout(millisecondi)];
  if (segnaleRichiesta) segnali.push(segnaleRichiesta);
  return AbortSignal.any(segnali);
}

// Indirizzo base del data agent, sulla porta DATA_AGENT_PORT del .env
function indirizzoDataAgent() {
  return `http://127.0.0.1:${process.env.DATA_AGENT_PORT || 8001}`;
}

/**
 * Cerca nel manuale le sezioni pertinenti alla domanda.
 * All'LLM passa il testo di ogni sezione con file e titolo.
 */
async function cerca_procedure(domanda, segnaleRichiesta) {
  // La ricerca in ChromaDB non si può interrompere a metà: si evita solo di iniziarla
  if (segnaleRichiesta?.aborted) return { testoPerLLM: "Richiesta annullata.", fonti: [], chiamateOpenAI: 0 };

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
  const testoPerLLM =
    pertinenti
      .map((r) => `[File: ${r.metadati.file} | Sezione: ${r.metadati.sezione}]\n${r.testo}`)
      .join("\n\n---\n\n") +
    // Le sezioni mostrate al front end saranno solo quelle che l'LLM dichiara di aver usato
    "\n\nAlla fine della risposta elenca le sezioni che hai usato davvero tra una riga [FONTI] " +
    "e una riga [/FONTI], con i titoli esatti separati da punto e virgola. Non elencare le sezioni non usate.";

  return { testoPerLLM, fonti, chiamateOpenAI: 1 };
}

/**
 * Fa analizzare la domanda al data agent (POST /analizza).
 * All'LLM passa solo il testo della risposta: URL del grafico e riepilogo
 * della pulizia vengono conservati per il front end.
 */
async function analizza_dati(domanda, segnaleRichiesta) {
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
      // Nota: l'analisi già partita nel data agent finisce comunque; si smette solo di aspettarla
      signal: segnaleConTimeout(TIMEOUT_DATA_AGENT_MS, segnaleRichiesta),
    });
  } catch (errore) {
    // Servizio spento oppure tempo scaduto
    if (segnaleRichiesta?.aborted) return { ...erroreGenerico, testoPerLLM: "Richiesta annullata." };
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
    // Token usati dal data agent: contano nella risposta e nel tetto giornaliero
    token: Number.isFinite(dati.token) ? dati.token : 0,
  };
}

// Formattazione dei numeri all'italiana per il testo passato all'LLM
const euro = (n) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const numero = (n) => n.toLocaleString("it-IT", { maximumFractionDigits: 2 });

// "1 giorno" / "3 giorni"
const giorni = (n) => (n === 1 ? "1 giorno" : `${n} giorni`);

// Esito di un controllo su più giorni consecutivi (scarti, rotture), già deciso dal codice
function esitoConsecutivo({ anomalia, giorniSopra, giorniPerAnomalia, sopraIeri, nomeLimite }) {
  if (anomalia) return `ANOMALIA: sopra ${nomeLimite} da ${giorni(giorniSopra)} consecutivi`;
  if (sopraIeri) {
    return `sopra ${nomeLimite} ieri, da ${giorni(giorniSopra)}, non è un'anomalia (servono ${giorni(giorniPerAnomalia)} consecutivi)`;
  }
  return `sotto ${nomeLimite}, non è un'anomalia`;
}

// Trasforma KPI, stato dei controlli e anomalie del briefing in un testo compatto per l'LLM.
// Lo stato di ogni controllo è già deciso dal codice: l'LLM non deve confrontare valori e soglie.
function testoBriefing({ kpi, controlli, anomalie, riconoscimenti = [] }) {
  const righe = [
    `KPI di ieri, ${kpi.giorno_settimana} ${kpi.data}, negozio ${kpi.negozio}:`,
    `- vendite ${euro(kpi.vendite)}, obiettivo ${euro(kpi.obiettivo)}, scostamento ${numero(kpi.scostamento_pct)}%`,
    `- scontrini ${kpi.scontrini}, scontrino medio ${euro(kpi.scontrino_medio)}`,
    `- consegne in ritardo ieri ${kpi.consegne_in_ritardo}, tasso di assenza del giorno ${numero(kpi.tasso_assenza_pct)}%`,
    "",
    "Controlli delle soglie del manuale (esito già calcolato, da riportare così com'è):",
  ];

  for (const [reparto, s] of Object.entries(controlli.scarti)) {
    let esito = esitoConsecutivo({
      anomalia: s.anomalia,
      giorniSopra: s.giorni_sopra_soglia,
      giorniPerAnomalia: s.giorni_per_anomalia,
      sopraIeri: s.giorni_sopra_soglia > 0,
      nomeLimite: "soglia",
    });
    if (s.area_manager) esito += "; da comunicare all'Area Manager";
    righe.push(`- scarto ${reparto} ${numero(s.valore)}% (soglia ${numero(s.soglia)}%): ${esito}`);
  }

  const r = controlli.rotture;
  righe.push(
    `- referenze in rottura ${r.valore} (limite ${r.limite}): ` +
      esitoConsecutivo({
        anomalia: r.anomalia,
        giorniSopra: r.giorni_sopra_limite,
        giorniPerAnomalia: r.giorni_per_anomalia,
        sopraIeri: r.giorni_sopra_limite > 0,
        nomeLimite: "il limite",
      })
  );

  for (const c of controlli.consegne) {
    const esito = c.anomalia ? "ANOMALIA: soglia raggiunta" : "sotto soglia, non è un'anomalia";
    righe.push(`- consegne in ritardo nella ${c.settimana} (${c.periodo}): ${c.valore} (soglia ${c.soglia} o più): ${esito}`);
  }
  for (const a of controlli.assenze) {
    const esito = a.anomalia ? "ANOMALIA: oltre la soglia" : "sotto soglia, non è un'anomalia";
    righe.push(`- assenze nella ${a.settimana} (${a.periodo}): ${numero(a.valore)}% delle ore pianificate (soglia ${numero(a.soglia)}%): ${esito}`);
  }

  righe.push("");
  if (anomalie.length === 0) {
    righe.push("Anomalie: nessuna. Non cercare procedure.");
  } else {
    righe.push(`Anomalie (${anomalie.length}), decise dal controllo automatico delle soglie del manuale:`);
    anomalie.forEach((a, i) => {
      righe.push(
        `${i + 1}. ${a.testo} Periodo: ${a.periodo}.` +
          `${a.area_manager ? " Da comunicare all'Area Manager." : ""} domanda_procedura: "${a.domanda_procedura}"`
      );
    });
  }

  // Riconoscimenti: già decisi dal codice, separati dalle anomalie
  righe.push("");
  if (riconoscimenti.length === 0) {
    righe.push("Riconoscimenti: nessuno.");
  } else {
    righe.push(`Riconoscimenti (${riconoscimenti.length}), calcolati dal codice (miglioramenti duraturi del tasso di scarto):`);
    riconoscimenti.forEach((r, i) => righe.push(`${i + 1}. ${r.testo}`));
    righe.push(
      "Scrivi la bozza del messaggio alla squadra tra una riga [BOZZA] e una riga [/BOZZA], " +
        "alla fine della risposta: verrà mostrata in un riquadro separato con il pulsante Copia."
    );
  }
  return righe.join("\n");
}

/**
 * Chiede al data agent il briefing del mattino (POST /briefing), calcolato senza LLM.
 * All'LLM passa solo KPI e anomalie in testo compatto: grafico e pulizia vanno al front end.
 */
async function prepara_briefing(segnaleRichiesta) {
  const erroreGenerico = { grafico: null, pulizia: null, chiamateOpenAI: 0 };

  let risposta;
  try {
    risposta = await fetch(`${indirizzoDataAgent()}/briefing`, {
      method: "POST",
      signal: segnaleConTimeout(TIMEOUT_BRIEFING_MS, segnaleRichiesta),
    });
  } catch (errore) {
    console.error(`[prepara_briefing] data agent non raggiungibile (${errore.name})`);
    return {
      ...erroreGenerico,
      testoPerLLM: "Errore: il servizio che prepara il briefing non risponde. Avvisa lo Store Manager che al momento il briefing non è disponibile e di riprovare più tardi.",
    };
  }

  if (!risposta.ok) {
    let dettaglio = "errore sconosciuto";
    try {
      const corpo = await risposta.json();
      if (typeof corpo.detail === "string") dettaglio = corpo.detail;
    } catch {
      // corpo non leggibile: resta il messaggio generico
    }
    console.error(`[prepara_briefing] il data agent ha risposto con stato ${risposta.status}`);
    return {
      ...erroreGenerico,
      testoPerLLM: `Errore: il briefing non è stato preparato (${dettaglio}). Avvisa lo Store Manager e non inventare numeri.`,
    };
  }

  const dati = await risposta.json();
  return {
    testoPerLLM: testoBriefing(dati),
    // I riconoscimenti vanno anche al front end, già calcolati (non scritti dall'LLM)
    riconoscimenti: Array.isArray(dati.riconoscimenti) ? dati.riconoscimenti : [],
    grafico: dati.grafico || null,
    pulizia: dati.pulizia ?? null,
    chiamateOpenAI: 0, // il briefing è calcolato solo con pandas
  };
}

// Mappa nome dello strumento -> funzione, usata dal ciclo di function calling
const STRUMENTI = { cerca_procedure, analizza_dati, prepara_briefing };

// Strumenti che non ricevono il parametro "domanda"
const STRUMENTI_SENZA_PARAMETRI = new Set(["prepara_briefing"]);

module.exports = { STRUMENTI, STRUMENTI_SENZA_PARAMETRI, CHIAMATE_MASSIME_DATA_AGENT, indirizzoDataAgent };
