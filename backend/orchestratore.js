// Orchestratore: fa decidere all'LLM quali strumenti usare (function calling) e costruisce la
// risposta finale con strumenti usati, sezioni del manuale consultate, grafici e riepilogo della pulizia dati.
const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");

const { MESSAGGI_IN_MEMORIA, MAX_ITERAZIONI, MAX_TOKEN_RISPOSTA, TIMEOUT_OPENAI_MS, LINGUE, MODELLO } = require("./config");
const { RichiestaAnnullata, ErroreUtente, erroreOpenAI } = require("./errori");
const { controllaTettoGiornaliero, prenotaChiamate, aggiungiTokenOggi } = require("./limiti");
const { STRUMENTI, STRUMENTI_SENZA_PARAMETRI, STRUMENTI_CON_PERIODO, CHIAMATE_MASSIME_DATA_AGENT } = require("./strumenti");
const { separaBozza, separaFonti, togliDomandaFinale, aggiungiFonteUfficiale } = require("./testo_risposte");
const { dateScenario, DateNonDisponibili } = require("./date_scenario");
const { logger, taglia, aggiungiTokenRichiesta } = require("./log");

// Prompt e definizioni degli strumenti, letti una sola volta dai file in prompts/
const CARTELLA_PROMPT = path.join(__dirname, "prompts");
const MODELLO_PROMPT = fs.readFileSync(path.join(CARTELLA_PROMPT, "sistema.txt"), "utf-8");
const DEFINIZIONI_STRUMENTI = JSON.parse(fs.readFileSync(path.join(CARTELLA_PROMPT, "strumenti.json"), "utf-8"));

// Date di riferimento dello scenario, calcolate dal data agent (date_scenario.js).
// Se il data agent non risponde la richiesta non riesce, con un messaggio chiaro.
async function dateDelloScenario(scenario) {
  try {
    return await dateScenario(scenario);
  } catch (errore) {
    if (errore instanceof DateNonDisponibili) {
      throw new ErroreUtente(503, "Il servizio di analisi dei dati non è raggiungibile: riprova tra poco.", "data_agent_non_raggiungibile");
    }
    throw errore;
  }
}

// Prompt di sistema di uno scenario, con data e negozio nei segnaposto (date dal data agent).
// Si costruisce una volta per scenario: resta identico tra le chiamate, così vale la cache di OpenAI.
const promptPerScenario = new Map();
async function promptSistema(scenario) {
  if (!promptPerScenario.has(scenario.id)) {
    const d = await dateDelloScenario(scenario);
    promptPerScenario.set(scenario.id, MODELLO_PROMPT
      .replaceAll("{negozio}", scenario.negozio)
      .replaceAll("{oggi}", d.oggi_esteso)
      .replaceAll("{ieri}", d.ieri_esteso)
      .replaceAll("{inizio_settimana}", d.inizio_settimana_esteso)
      .replaceAll("{mese_corrente}", d.mese_corrente));
  }
  return promptPerScenario.get(scenario.id);
}

// Client OpenAI: nessun nuovo tentativo automatico, per non moltiplicare le chiamate
const openai = new OpenAI({ maxRetries: 0, timeout: TIMEOUT_OPENAI_MS });

// Messaggi per il modello: prompt di sistema (sempre uguale, così resta nella cache di OpenAI),
// memoria della sessione, lingua della risposta e infine il messaggio o le istruzioni dell'azione
async function componiMessaggi(storico, lingua, contenuto, scenario) {
  return [
    { role: "system", content: await promptSistema(scenario) },
    ...storico.slice(-MESSAGGI_IN_MEMORIA),
    { role: "system", content: `Lingua della risposta: ${LINGUE[lingua]}.` },
    { role: "user", content: contenuto },
  ];
}

// Vero se il testo contiene cifre in euro o in percentuale (es. "98.765 euro", "4,2%")
const CIFRE_CON_UNITA = /\d[\d.,]*\s*(€|%|euro\b)/i;

// Legge gli argomenti generati dal modello e controlla che ci sia la domanda
function leggiDomanda(argomentiJson) {
  try {
    const argomenti = JSON.parse(argomentiJson);
    if (typeof argomenti.domanda === "string" && argomenti.domanda.trim()) {
      return argomenti.domanda.trim();
    }
  } catch {
    // JSON non valido: gestito sotto
  }
  return null;
}

// Legge inizio e fine del periodo (formato AAAA-MM-GG) per controlla_soglie e confronta_negozi; null se non validi
function leggiPeriodo(argomentiJson) {
  try {
    const { inizio, fine } = JSON.parse(argomentiJson);
    const formato = /^\d{4}-\d{2}-\d{2}$/;
    if (formato.test(inizio) && formato.test(fine)) return { inizio, fine };
  } catch {
    // JSON non valido: gestito dal chiamante
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ciclo di function calling
// ---------------------------------------------------------------------------

// Motivo per cui una risposta non va nella cache (routes/chat.js). È un Symbol: non finisce nel JSON per il front end.
const NON_IN_CACHE = Symbol("nonInCache");

/**
 * Perché questa risposta non si può salvare in cache, oppure null se si può:
 * errori (di uno strumento o del ciclo), risposte bloccate dal filtro, numeri senza strumenti usati.
 */
function motivoNonInCache(esito) {
  if (esito[NON_IN_CACHE]) return esito[NON_IN_CACHE];
  if (esito.strumenti.length === 0 && /\d/.test(esito.risposta ?? "")) return "numeri senza strumenti";
  return null;
}

// Chiamate OpenAI che ogni strumento può fare nel caso peggiore, prenotate nel tetto di chiamate:
// 5 per il data agent, 1 embedding per la ricerca, nessuna per i calcoli fatti solo con pandas
const CHIAMATE_PER_STRUMENTO = {
  analizza_dati: CHIAMATE_MASSIME_DATA_AGENT, cerca_procedure: 1, prepara_briefing: 0, controlla_soglie: 0, confronta_negozi: 0,
};

/**
 * Una chiamata al modello con tutti i controlli: annullamento, tetto giornaliero, tetto di chiamate,
 * errori di OpenAI tradotti in messaggi fissi.
 */
async function creaCompletamento(parametri, segnale) {
  if (segnale.aborted) throw new RichiestaAnnullata();
  await controllaTettoGiornaliero();
  if (!prenotaChiamate(1)) {
    throw new ErroreUtente(429, "È stato raggiunto il numero massimo di chiamate al servizio di intelligenza artificiale.");
  }
  let completamento;
  try {
    completamento = await openai.chat.completions.create(
      { model: MODELLO, temperature: 0, max_completion_tokens: MAX_TOKEN_RISPOSTA, ...parametri },
      // Il segnale interrompe la chiamata in corso se il front end chiude la richiesta
      { signal: segnale }
    );
  } catch (errore) {
    if (segnale.aborted) throw new RichiestaAnnullata();
    logger.error({ errore: errore.constructor.name }, "chiamata OpenAI non riuscita");
    throw erroreOpenAI(errore);
  }
  // Token di input (di cui dalla cache) e di output: servono a stimare i costi
  const uso = completamento.usage ?? {};
  aggiungiTokenRichiesta(uso.prompt_tokens, uso.completion_tokens);
  logger.debug({
    token_ingresso: uso.prompt_tokens ?? 0, token_cache: uso.prompt_tokens_details?.cached_tokens ?? 0,
    token_uscita: uso.completion_tokens ?? 0,
  }, "chiamata OpenAI");
  return completamento;
}

/**
 * Una chiamata al modello senza strumenti, per le azioni dirette (token conteggiati e registrati).
 * @returns {Promise<{testo: string, token: number}>}
 */
async function chiamaModello(messaggi, segnale) {
  const completamento = await creaCompletamento({ messages: messaggi }, segnale);
  const token = completamento.usage?.total_tokens ?? 0;
  await aggiungiTokenOggi(token);
  return { testo: completamento.choices[0].message.content?.trim() ?? "", token };
}

/**
 * Esegue uno strumento chiesto dal modello e raccoglie in esito ciò che va al front end.
 * Restituisce il contenuto da rimandare al modello.
 */
async function eseguiStrumento(chiamata, esito, segnale, scenario) {
  const nome = chiamata.function?.name;
  // Un errore restituito al modello: la risposta finale non va in cache
  const errore = (testo) => {
    esito[NON_IN_CACHE] ??= "errore di uno strumento";
    return testo;
  };
  // Parametri: nessuno (prepara_briefing), un periodo (controlla_soglie, confronta_negozi)
  // oppure la domanda (analizza_dati, cerca_procedure)
  const senzaParametri = STRUMENTI_SENZA_PARAMETRI.has(nome);
  const conPeriodo = STRUMENTI_CON_PERIODO.has(nome);
  const periodo = conPeriodo ? leggiPeriodo(chiamata.function?.arguments) : null;
  const domanda = senzaParametri || conPeriodo ? null : leggiDomanda(chiamata.function?.arguments);

  if (!STRUMENTI[nome]) return errore(`Errore: lo strumento "${nome}" non esiste.`);
  if (conPeriodo && !periodo) return errore("Errore: inizio e fine devono essere date nel formato AAAA-MM-GG.");
  if (!senzaParametri && !conPeriodo && !domanda) return errore("Errore: manca il parametro obbligatorio \"domanda\".");

  if (segnale.aborted) throw new RichiestaAnnullata();
  if (!prenotaChiamate(CHIAMATE_PER_STRUMENTO[nome])) {
    return errore("Errore: raggiunto il numero massimo di chiamate consentite, lo strumento non è stato eseguito. Avvisa lo Store Manager.");
  }

  // Per il front end: la domanda passata, oppure il periodo controllato
  esito.strumenti.push({ nome, domanda: periodo ? `dal ${periodo.inizio} al ${periodo.fine}` : domanda });
  logger.debug({ strumento: nome, domanda: taglia(domanda), periodo }, "strumento chiamato");
  const risultato = senzaParametri
    ? await STRUMENTI[nome](segnale, scenario.id)
    : await STRUMENTI[nome](periodo ?? domanda, segnale, scenario.id);
  if (segnale.aborted) throw new RichiestaAnnullata();
  if (risultato.errore) esito[NON_IN_CACHE] ??= "errore di uno strumento";
  if (risultato.bloccata) esito[NON_IN_CACHE] ??= "bloccata dal filtro";

  // Token del data agent: contano nella risposta e nel tetto giornaliero
  if (risultato.token) {
    esito.token += risultato.token;
    await aggiungiTokenOggi(risultato.token);
    aggiungiTokenRichiesta(risultato.tokenIngresso, risultato.tokenUscita);
  }
  for (const fonte of risultato.fonti ?? []) {
    const giaPresente = esito.sezioni_consultate.some((f) => f.file === fonte.file && f.sezione === fonte.sezione);
    if (!giaPresente) esito.sezioni_consultate.push(fonte);
  }
  if (risultato.grafico) esito.grafici.push(risultato.grafico);
  if (risultato.riconoscimenti?.length) esito.riconoscimenti.push(...risultato.riconoscimenti);
  if (risultato.eccedenze) esito.eccedenze_donate = risultato.eccedenze;
  if (risultato.calcolo) esito.calcoli.push({ strumento: nome, ...risultato.calcolo });
  if (risultato.pulizia) esito.pulizia = risultato.pulizia;
  return risultato.testoPerLLM;
}

// Regole fisse sul testo finale, applicate dal codice perché il modello a volte le ignora
function completaRisposta(testoFinale, esito, lingua) {
  // Sezioni del manuale: si mostrano solo quelle che il modello dichiara di aver usato,
  // e solo se sono davvero tra quelle restituite dalla ricerca (così non può inventarne)
  const { testo: senzaFonti, titoli } = separaFonti(testoFinale);
  if (titoli && titoli.length > 0) {
    const usate = esito.sezioni_consultate.filter((s) => titoli.some((t) => t.toLowerCase() === s.sezione.toLowerCase()));
    if (usate.length > 0) esito.sezioni_consultate = usate;
  }

  // La bozza si separa solo se il briefing ha davvero restituito dei riconoscimenti;
  // un'eventuale bozza non richiesta si toglie e basta
  const { testo, bozza } = separaBozza(senzaFonti);
  if (esito.riconoscimenti.length > 0) esito.bozza_riconoscimento = bozza;
  // Niente domanda finale che offre altro; in inglese la fonte ufficiale (manuale in italiano) la aggiunge il codice
  esito.risposta = aggiungiFonteUfficiale(togliDomandaFinale(testo), lingua, esito.sezioni_consultate);
  return esito;
}

/**
 * Fa rispondere l'LLM al messaggio, eseguendo gli strumenti che sceglie.
 * @param {Array} storico - messaggi precedenti della sessione
 * @param {string} messaggio - nuovo messaggio dell'utente
 * @param {AbortSignal} segnale - si attiva se il front end chiude la richiesta
 * @param {string} lingua - "it" oppure "en"
 */
async function rispondi(storico, messaggio, segnale, lingua, scenario) {
  const messaggi = await componiMessaggi(storico, lingua, messaggio, scenario);
  const esito = {
    risposta: null, strumenti: [], sezioni_consultate: [], grafici: [], pulizia: null,
    riconoscimenti: [], bozza_riconoscimento: null, eccedenze_donate: null, calcoli: [], token: 0,
  };

  // Si attiva se il modello prova a dare numeri senza aver usato strumenti (una volta per richiesta)
  let strumentoObbligatorio = false;
  // Vale solo per la chiamata successiva al controllo: dopo, il modello torna libero di rispondere
  let obbligoPerProssimaChiamata = false;

  for (let iterazione = 1; iterazione <= MAX_ITERAZIONI; iterazione++) {
    // All'ultima iterazione il modello deve rispondere senza chiamare altri strumenti
    const ultimaIterazione = iterazione === MAX_ITERAZIONI;
    const completamento = await creaCompletamento({
      messages: messaggi,
      tools: DEFINIZIONI_STRUMENTI,
      tool_choice: ultimaIterazione ? "none" : obbligoPerProssimaChiamata ? "required" : "auto",
      // Uno strumento alla volta: nelle domande ibride la procedura si cerca DOPO l'analisi
      parallel_tool_calls: false,
    }, segnale);

    obbligoPerProssimaChiamata = false;
    const tokenChiamata = completamento.usage?.total_tokens ?? 0;
    esito.token += tokenChiamata;
    await aggiungiTokenOggi(tokenChiamata);
    const risposta = completamento.choices[0].message;
    const chiamate = risposta.tool_calls ?? [];

    // Nessuno strumento richiesto: questa è la risposta finale
    if (chiamate.length === 0) {
      if (!risposta.content?.trim()) esito[NON_IN_CACHE] ??= "risposta vuota";
      const testoFinale = risposta.content?.trim() || "Non sono riuscito a formulare una risposta. Prova a riformulare la domanda.";

      // Controllo fisso: cifre in euro o percentuale senza nessuno strumento usato = numeri inventati.
      // Si scarta la risposta e si obbliga il modello a usare uno strumento (una sola volta).
      if (esito.strumenti.length === 0 && CIFRE_CON_UNITA.test(testoFinale) && !strumentoObbligatorio && !ultimaIterazione) {
        logger.info("risposta con numeri senza strumenti: scartata, strumento obbligatorio");
        strumentoObbligatorio = true;
        obbligoPerProssimaChiamata = true;
        messaggi.push({
          role: "system",
          content: "La risposta che stavi per dare contiene numeri ma non hai usato strumenti: è vietato. " +
            "Usa analizza_dati per i numeri del negozio o cerca_procedure per il manuale, poi rispondi.",
        });
        continue;
      }
      return completaRisposta(testoFinale, esito, lingua);
    }

    // Il messaggio con le chiamate va rimandato al modello insieme ai risultati
    messaggi.push({ role: "assistant", content: risposta.content ?? null, tool_calls: chiamate });
    for (const chiamata of chiamate) {
      const contenuto = await eseguiStrumento(chiamata, esito, segnale, scenario);
      messaggi.push({ role: "tool", tool_call_id: chiamata.id, content: contenuto });
    }
  }

  // Non si arriva qui: l'ultima iterazione impone una risposta senza strumenti
  esito[NON_IN_CACHE] ??= "risposta non completata";
  esito.risposta = "Non sono riuscito a completare la risposta. Prova a riformulare la domanda.";
  return esito;
}

module.exports = { rispondi, chiamaModello, componiMessaggi, dateDelloScenario, motivoNonInCache, MODELLO_PROMPT, DEFINIZIONI_STRUMENTI };
