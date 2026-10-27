// Strumenti che l'orchestratore mette a disposizione dell'LLM.
// Ogni strumento restituisce un oggetto con testoPerLLM, l'unico contenuto rimandato al modello;
// gli altri campi (fonti, grafico, pulizia, calcolo...) vanno solo al front end.
const { cercaProcedure } = require("./rag/cerca");

const NUMERO_RISULTATI = 3;   // sezioni chieste a ChromaDB
const DISTANZA_MASSIMA = 0.4; // oltre questa distanza del coseno la sezione è considerata non pertinente

const TIMEOUT_DATA_AGENT_MS = 120_000;
const TIMEOUT_BRIEFING_MS = 30_000; // calcoli senza LLM: bastano pochi secondi
// Il data agent fa al massimo 5 passi per domanda (MAX_PASSI_PER_DOMANDA in data_agent/app.py):
// nel conteggio delle chiamate a OpenAI si considera sempre il caso peggiore
const CHIAMATE_MASSIME_DATA_AGENT = 5;
const MAX_CARATTERI_CALCOLO = 5000; // il data agent tronca già il codice a 4000

// "Come l'ho calcolato": codice eseguito dal data agent oppure regole fisse.
// Si mostra solo come testo nel front end, mai eseguito.
function calcolo(tipo, testo) {
  if (typeof testo !== "string" || !testo.trim()) return null;
  return { tipo, testo: testo.slice(0, MAX_CARATTERI_CALCOLO) };
}

// Segnale che scatta per il timeout oppure quando il front end chiude la richiesta
function segnaleConTimeout(millisecondi, segnaleRichiesta) {
  const segnali = [AbortSignal.timeout(millisecondi)];
  if (segnaleRichiesta) segnali.push(segnaleRichiesta);
  return AbortSignal.any(segnali);
}

function indirizzoDataAgent() {
  return `http://127.0.0.1:${process.env.DATA_AGENT_PORT || 8001}`;
}

// Nomi dei grafici creati dal data agent: solo questo formato è servito da /api/grafici
const NOME_GRAFICO = /^(grafico|briefing)_[0-9a-f]{32}\.png$/;

// Il browser non raggiunge il data agent (in produzione è interno al contenitore):
// i grafici passano dal back end, su /api/grafici/<nome>
function indirizzoGrafico(url) {
  const nome = typeof url === "string" ? url.split("/").pop() : "";
  return NOME_GRAFICO.test(nome) ? `/api/grafici/${nome}` : null;
}

/**
 * POST al data agent. Restituisce { dati } se la risposta è valida, altrimenti { testoErrore }
 * già pronto per l'LLM. Nel log solo il tipo di errore o lo stato: mai il messaggio originale.
 * @param {string|function(Error): string} nonRaggiungibile - testo se il servizio non risponde
 * @param {function(string): string} nonRiuscita - testo se risponde con un errore (riceve il detail)
 */
async function chiediAlDataAgent(nome, percorso, corpo, { timeoutMs, segnale, nonRaggiungibile, nonRiuscita }) {
  let risposta;
  try {
    risposta = await fetch(`${indirizzoDataAgent()}${percorso}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      // Un'analisi già partita nel data agent finisce comunque: si smette solo di aspettarla
      signal: segnaleConTimeout(timeoutMs, segnale),
    });
  } catch (errore) {
    if (segnale?.aborted) return { testoErrore: "Richiesta annullata." };
    console.error(`[${nome}] data agent non raggiungibile (${errore.name})`);
    return { testoErrore: typeof nonRaggiungibile === "function" ? nonRaggiungibile(errore) : nonRaggiungibile };
  }

  if (!risposta.ok) {
    // Il data agent restituisce già messaggi d'errore in italiano, senza dettagli sensibili
    let dettaglio = "errore sconosciuto";
    try {
      const errore = await risposta.json();
      if (typeof errore.detail === "string") dettaglio = errore.detail;
    } catch {
      // corpo non leggibile: resta il messaggio generico
    }
    console.error(`[${nome}] il data agent ha risposto con stato ${risposta.status}`);
    return { testoErrore: nonRiuscita(dettaglio) };
  }
  return { dati: await risposta.json() };
}

/** Cerca nel manuale le sezioni pertinenti alla domanda; all'LLM passa ogni sezione con file e titolo. */
async function cerca_procedure(domanda, segnaleRichiesta) {
  // La ricerca in ChromaDB non si può interrompere a metà: si evita solo di iniziarla
  if (segnaleRichiesta?.aborted) return { testoPerLLM: "Richiesta annullata.", fonti: [] };

  let risultati;
  try {
    risultati = await cercaProcedure(domanda, NUMERO_RISULTATI);
  } catch (errore) {
    console.error(`[cerca_procedure] ricerca non riuscita (${errore.name})`);
    return {
      testoPerLLM: "Errore: la ricerca nel manuale non è al momento disponibile. Avvisa lo Store Manager che non è possibile consultare le procedure e di riprovare più tardi.",
      fonti: [],
    };
  }

  const pertinenti = risultati.filter((r) => r.distanza <= DISTANZA_MASSIMA);
  if (pertinenti.length === 0) {
    return { testoPerLLM: "Nessuna sezione pertinente trovata nel manuale", fonti: [] };
  }

  const fonti = pertinenti.map((r) => ({ file: r.metadati.file, sezione: r.metadati.sezione }));
  const testoPerLLM =
    pertinenti
      .map((r) => `[File: ${r.metadati.file} | Sezione: ${r.metadati.sezione}]\n${r.testo}`)
      .join("\n\n---\n\n") +
    // Al front end andranno solo le sezioni che l'LLM dichiara di aver usato
    "\n\nAlla fine della risposta elenca le sezioni che hai usato davvero tra una riga [FONTI] " +
    "e una riga [/FONTI], con i titoli esatti separati da punto e virgola. Non elencare le sezioni non usate.";

  return { testoPerLLM, fonti };
}

/** Fa analizzare la domanda al data agent (POST /analizza). All'LLM passa solo il testo della risposta. */
async function analizza_dati(domanda, segnaleRichiesta, scenario) {
  const { dati, testoErrore } = await chiediAlDataAgent("analizza_dati", "/analizza", { domanda, scenario }, {
    timeoutMs: TIMEOUT_DATA_AGENT_MS,
    segnale: segnaleRichiesta,
    nonRaggiungibile: (errore) => (errore.name === "TimeoutError"
      ? "Errore: l'analisi dei dati ha impiegato più di 120 secondi ed è stata interrotta. Avvisa lo Store Manager e suggerisci di riprovare con una domanda più semplice."
      : "Errore: il servizio di analisi dei dati non risponde. Avvisa lo Store Manager che al momento non è possibile analizzare i dati del negozio e di riprovare più tardi."),
    nonRiuscita: (dettaglio) => `Errore: l'analisi dei dati non è riuscita (${dettaglio}). Avvisa lo Store Manager e non inventare numeri.`,
  });
  if (testoErrore) return { testoPerLLM: testoErrore };

  return {
    testoPerLLM: dati.risposta,
    grafico: indirizzoGrafico(dati.grafico),
    pulizia: dati.pulizia ?? null,
    calcolo: calcolo("codice", dati.codice),
    // Contano nella risposta e nel tetto giornaliero
    token: Number.isFinite(dati.token) ? dati.token : 0,
  };
}

// Numeri all'italiana per il testo passato all'LLM
const euro = (n) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const numero = (n) => n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
const giorni = (n) => (n === 1 ? "1 giorno" : `${n} giorni`);

// Esito di un controllo su più giorni consecutivi (scarti, rotture), già deciso dal codice
function esitoConsecutivo({ anomalia, giorniSopra, giorniPerAnomalia, sopraIeri, nomeLimite }) {
  if (anomalia) return `ANOMALIA: sopra ${nomeLimite} da ${giorni(giorniSopra)} consecutivi`;
  if (sopraIeri) {
    return `sopra ${nomeLimite} ieri, da ${giorni(giorniSopra)}, non è un'anomalia (servono ${giorni(giorniPerAnomalia)} consecutivi)`;
  }
  return `sotto ${nomeLimite}, non è un'anomalia`;
}

// Eccedenze donate: solo chilogrammi, nessuna conversione
function righeEccedenze(e) {
  if (!e) return [];
  return [`- eccedenze donate (in kg): ieri ${numero(e.ieri)} kg; nell'ultima settimana completa, dal ${e.settimana_dal} al ${e.settimana_al}, ${numero(e.settimana)} kg`];
}

// KPI, controlli e anomalie del briefing in un testo compatto per l'LLM.
// L'esito di ogni controllo è già deciso dal codice: l'LLM non deve confrontare valori e soglie.
function testoBriefing({ kpi, controlli, anomalie, riconoscimenti = [] }) {
  const righe = [
    `KPI di ieri, ${kpi.giorno_settimana} ${kpi.data}, negozio ${kpi.negozio}:`,
    `- vendite ${euro(kpi.vendite)}, obiettivo ${euro(kpi.obiettivo)}, scostamento ${numero(kpi.scostamento_pct)}%`,
    `- scontrini ${kpi.scontrini}, scontrino medio ${euro(kpi.scontrino_medio)}`,
    `- consegne in ritardo ieri ${kpi.consegne_in_ritardo}, tasso di assenza del giorno ${numero(kpi.tasso_assenza_pct)}%`,
    ...righeEccedenze(kpi.eccedenze_donate_kg),
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

/** Briefing del mattino (POST /briefing), calcolato senza LLM. All'LLM va solo il testo compatto. */
async function prepara_briefing(segnaleRichiesta, scenario) {
  const { dati, testoErrore } = await chiediAlDataAgent("prepara_briefing", "/briefing", { scenario }, {
    timeoutMs: TIMEOUT_BRIEFING_MS,
    segnale: segnaleRichiesta,
    nonRaggiungibile: "Errore: il servizio che prepara il briefing non risponde. Avvisa lo Store Manager che al momento il briefing non è disponibile e di riprovare più tardi.",
    nonRiuscita: (dettaglio) => `Errore: il briefing non è stato preparato (${dettaglio}). Avvisa lo Store Manager e non inventare numeri.`,
  });
  if (testoErrore) return { testoPerLLM: testoErrore };

  return {
    testoPerLLM: testoBriefing(dati),
    // Già calcolati dal codice, non scritti dall'LLM
    riconoscimenti: Array.isArray(dati.riconoscimenti) ? dati.riconoscimenti : [],
    // Con domanda_procedura: servono all'azione diretta del briefing
    anomalie: Array.isArray(dati.anomalie) ? dati.anomalie : [],
    eccedenze: dati.kpi?.eccedenze_donate_kg ?? null,
    calcolo: calcolo("regole", dati.regole),
    grafico: indirizzoGrafico(dati.grafico),
    pulizia: dati.pulizia ?? null,
  };
}

/**
 * Soglie del manuale nel periodo (POST /soglie), senza LLM.
 * @param {{inizio: string, fine: string}} periodo - date nel formato AAAA-MM-GG
 */
async function controlla_soglie({ inizio, fine }, segnaleRichiesta, scenario) {
  const { dati, testoErrore } = await chiediAlDataAgent("controlla_soglie", "/soglie", { inizio, fine, scenario }, {
    timeoutMs: TIMEOUT_BRIEFING_MS,
    segnale: segnaleRichiesta,
    nonRaggiungibile: "Errore: il controllo delle soglie non è disponibile. Avvisa lo Store Manager e non dire se le soglie sono superate.",
    nonRiuscita: (dettaglio) => `Errore nel controllo delle soglie: ${dettaglio}`,
  });
  if (testoErrore) return { testoPerLLM: testoErrore };

  return {
    testoPerLLM: dati.testo,
    calcolo: calcolo("regole", dati.regole),
    // KPI e soglie superate servono al report per l'Area Manager
    dati: { kpi: dati.kpi, testoKpi: dati.testo_kpi, superate: dati.superate ?? {}, controlli: dati.esito },
  };
}

/**
 * Tassi di scarto del negozio confrontati con gli altri negozi (POST /confronto), senza LLM:
 * solo rapporti, mai valori assoluti.
 * @param {{inizio: string, fine: string}} periodo - date nel formato AAAA-MM-GG
 */
async function confronta_negozi({ inizio, fine }, segnaleRichiesta, scenario) {
  const { dati, testoErrore } = await chiediAlDataAgent("confronta_negozi", "/confronto", { inizio, fine, scenario }, {
    timeoutMs: TIMEOUT_BRIEFING_MS,
    segnale: segnaleRichiesta,
    nonRaggiungibile: "Errore: il confronto tra negozi non è disponibile. Avvisa lo Store Manager e non inventare numeri.",
    nonRiuscita: (dettaglio) => `Errore nel confronto tra negozi: ${dettaglio}`,
  });
  if (testoErrore) return { testoPerLLM: testoErrore };
  return { testoPerLLM: dati.testo, calcolo: calcolo("regole", dati.regole) };
}

const STRUMENTI = { cerca_procedure, analizza_dati, prepara_briefing, controlla_soglie, confronta_negozi };
const STRUMENTI_SENZA_PARAMETRI = new Set(["prepara_briefing"]);
// Ricevono un periodo (inizio e fine) invece della domanda
const STRUMENTI_CON_PERIODO = new Set(["controlla_soglie", "confronta_negozi"]);

module.exports = {
  STRUMENTI, STRUMENTI_SENZA_PARAMETRI, STRUMENTI_CON_PERIODO, CHIAMATE_MASSIME_DATA_AGENT, indirizzoDataAgent, NOME_GRAFICO,
};
