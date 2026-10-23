// Orchestratore: riceve i messaggi del front end, fa decidere all'LLM quali
// strumenti usare (function calling) e restituisce la risposta finale con
// strumenti usati, sezioni del manuale consultate, grafici e riepilogo della pulizia dati.
//
// Avvio (dalla cartella backend, con ChromaDB e data agent avviati): node server.js
const fs = require("node:fs");
const path = require("node:path");

// Carico le variabili dal file .env della cartella principale del progetto
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { rateLimit } = require("express-rate-limit");

const {
  STRUMENTI, STRUMENTI_SENZA_PARAMETRI, STRUMENTI_CON_PERIODO, CHIAMATE_MASSIME_DATA_AGENT, indirizzoDataAgent,
} = require("./strumenti");
const { creaClient } = require("./rag/config");
const { separaBozza, separaFonti, togliDomandaFinale, aggiungiFonteUfficiale } = require("./testo_risposte");
const { AZIONI, creaAzioni } = require("./azioni");
const { SCENARI, trovaScenario, dateScenario } = require("./scenari");
const { creaFeedback } = require("./feedback");

// ---------------------------------------------------------------------------
// Configurazione
// ---------------------------------------------------------------------------

const PORTA = Number(process.env.BACKEND_PORT || 3001);
// Solo localhost: il back end non deve essere raggiungibile dagli altri dispositivi della rete
const INDIRIZZO_ASCOLTO = "127.0.0.1";
const ORIGINE_FRONT_END = "http://localhost:5173";

const LUNGHEZZA_MASSIMA_MESSAGGIO = 1000; // caratteri
const MESSAGGI_IN_MEMORIA = 10;           // ultimi messaggi della sessione mandati all'LLM
const MAX_ITERAZIONI = 6;                 // chiamate al modello per ogni richiesta
const MAX_TOKEN_RISPOSTA = 1000;          // token massimi generati in una singola chiamata
const TIMEOUT_OPENAI_MS = 60_000;         // tempo massimo per una singola chiamata a OpenAI

// Sessioni in memoria: numero massimo e scadenza dopo un periodo di inattività
const MAX_SESSIONI = 100;
const SCADENZA_SESSIONE_MS = 60 * 60 * 1000; // 1 ora

// Legge un numero intero positivo dal .env, con un valore di default se manca o non è valido
function numeroDaEnv(nome, predefinito) {
  const valore = Number(process.env[nome]);
  return Number.isInteger(valore) && valore > 0 ? valore : predefinito;
}

// Limite di frequenza su /api/chat e tetto di token giornaliero (configurabili nel .env)
const LIMITE_RICHIESTE_MINUTO = numeroDaEnv("LIMITE_RICHIESTE_MINUTO", 10);
const TETTO_TOKEN_GIORNALIERO = numeroDaEnv("TETTO_TOKEN_GIORNALIERO", 300_000);

// Tetto facoltativo alle chiamate OpenAI per tutta la vita del server (usato dal test).
// Conta le chiamate dell'orchestratore, gli embedding della ricerca e, per il data agent,
// sempre il caso peggiore di 5 chiamate. Se la variabile manca non c'è limite.
const MAX_CHIAMATE_OPENAI = process.env.MAX_CHIAMATE_OPENAI ? Number(process.env.MAX_CHIAMATE_OPENAI) : Infinity;
let chiamateOpenAIUsate = 0;

// Controllo all'avvio che la configurazione necessaria sia presente
// (data e negozio non servono più: vengono dallo scenario della demo, in scenari.json)
for (const variabile of ["OPENAI_API_KEY", "ORCHESTRATOR_MODEL"]) {
  if (!process.env[variabile]) {
    console.error(`Variabile ${variabile} mancante nel file .env`);
    process.exit(1);
  }
}
if (process.env.ORCHESTRATOR_MODEL === "nome-del-modello") {
  console.error("ORCHESTRATOR_MODEL nel file .env contiene ancora il valore di esempio");
  process.exit(1);
}
const MODELLO = process.env.ORCHESTRATOR_MODEL;

// Prompt e definizioni degli strumenti, letti una sola volta dai file in prompts/
const CARTELLA_PROMPT = path.join(__dirname, "prompts");
const MODELLO_PROMPT = fs.readFileSync(path.join(CARTELLA_PROMPT, "sistema.txt"), "utf-8");
const DEFINIZIONI_STRUMENTI = JSON.parse(fs.readFileSync(path.join(CARTELLA_PROMPT, "strumenti.json"), "utf-8"));

// Prompt di sistema di uno scenario, con data e negozio nei segnaposto (stessa logica del data agent:
// ieri = oggi meno 1 giorno, inizio settimana = ieri meno 6 giorni, mese corrente = mese di ieri).
// Si costruisce una volta per scenario: resta identico tra le chiamate, così vale la cache di OpenAI.
const promptPerScenario = new Map();
function promptSistema(scenario) {
  if (!promptPerScenario.has(scenario.id)) {
    const d = dateScenario(scenario);
    promptPerScenario.set(scenario.id, MODELLO_PROMPT
      .replaceAll("{negozio}", scenario.negozio)
      .replaceAll("{oggi}", d.oggiEsteso)
      .replaceAll("{ieri}", d.ieriEsteso)
      .replaceAll("{inizio_settimana}", d.inizioSettimanaEsteso)
      .replaceAll("{mese_corrente}", d.meseCorrente));
  }
  return promptPerScenario.get(scenario.id);
}

// Client OpenAI: nessun nuovo tentativo automatico, per non moltiplicare le chiamate
const openai = new OpenAI({ maxRetries: 0, timeout: TIMEOUT_OPENAI_MS });

// Memoria delle conversazioni: sessionId -> { messaggi, ultimoUso }.
// Si conservano solo le domande dell'utente e le risposte finali, non i passaggi intermedi.
// L'ordine della Map è quello dell'ultimo uso: la prima sessione è la meno recente.
const sessioni = new Map();

// Token usati oggi (orchestratore + data agent), azzerati al cambio di data
const consumoGiornaliero = { giorno: oggiLocale(), token: 0 };

// ---------------------------------------------------------------------------
// Funzioni di supporto
// ---------------------------------------------------------------------------


// Data di oggi (ora locale) nel formato AAAA-MM-GG, per azzerare il tetto giornaliero
function oggiLocale() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

// Lingue supportate: italiano (predefinita) e inglese
const LINGUE = { it: "italiano", en: "inglese" };
function leggiLingua(valore) {
  return Object.hasOwn(LINGUE, valore) ? valore : "it";
}

// Messaggi per il modello: prompt di sistema (sempre uguale, così resta nella cache di OpenAI),
// memoria della sessione, lingua della risposta e infine il messaggio o le istruzioni dell'azione
function componiMessaggi(storico, lingua, contenuto, scenario) {
  return [
    { role: "system", content: promptSistema(scenario) },
    ...storico.slice(-MESSAGGI_IN_MEMORIA),
    { role: "system", content: `Lingua della risposta: ${LINGUE[lingua]}.` },
    { role: "user", content: contenuto },
  ];
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

// Prenota n chiamate OpenAI nel tetto massimo; restituisce false se si sforerebbe
function prenotaChiamate(n) {
  if (chiamateOpenAIUsate + n > MAX_CHIAMATE_OPENAI) return false;
  chiamateOpenAIUsate += n;
  return true;
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

// Legge inizio e fine del periodo (formato AAAA-MM-GG) per controlla_soglie; null se non validi
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

// Scenario della richiesta: si accetta SOLO l'id di uno scenario della lista (mai date o negozi liberi).
// Se manca si usa lo scenario predefinito.
function leggiScenario(id) {
  const scenario = trovaScenario(id);
  if (!scenario) throw new ErroreUtente(400, "Scenario della demo non valido.", "scenario_non_valido");
  return scenario;
}

// Controlla il sessionId inviato dal front end
function controllaSessione(sessionId) {
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 100) {
    throw new ErroreUtente(400, "Sessione non valida.", "sessione_non_valida");
  }
}

/**
 * Una chiamata al modello senza strumenti, per le azioni dirette: stessi controlli della chat
 * (annullamento, tetto giornaliero, tetto di chiamate, errori tradotti, token conteggiati).
 * @returns {Promise<{testo: string, token: number}>}
 */
async function chiamaModello(messaggi, segnale) {
  if (segnale.aborted) throw new RichiestaAnnullata();
  controllaTettoGiornaliero();
  if (!prenotaChiamate(1)) {
    throw new ErroreUtente(429, "È stato raggiunto il numero massimo di chiamate al servizio di intelligenza artificiale.");
  }
  let completamento;
  try {
    completamento = await openai.chat.completions.create(
      { model: MODELLO, messages: messaggi, temperature: 0, max_completion_tokens: MAX_TOKEN_RISPOSTA },
      { signal: segnale }
    );
  } catch (errore) {
    if (segnale.aborted) throw new RichiestaAnnullata();
    console.error(`[openai] chiamata non riuscita (${errore.constructor.name})`);
    throw erroreOpenAI(errore);
  }
  const token = completamento.usage?.total_tokens ?? 0;
  aggiungiTokenOggi(token);
  // Una riga di log con i token (input, di cui dalla cache, output): serve a stimare i costi
  const uso = completamento.usage ?? {};
  console.log(`[openai] input=${uso.prompt_tokens ?? 0} cache=${uso.prompt_tokens_details?.cached_tokens ?? 0} output=${uso.completion_tokens ?? 0}`);
  return { testo: completamento.choices[0].message.content?.trim() ?? "", token };
}

/**
 * Fa rispondere l'LLM al messaggio, eseguendo gli strumenti che sceglie.
 * @param {Array} storico - messaggi precedenti della sessione
 * @param {string} messaggio - nuovo messaggio dell'utente
 * @param {AbortSignal} segnale - si attiva se il front end chiude la richiesta
 * @param {string} lingua - "it" oppure "en"
 */
async function rispondi(storico, messaggio, segnale, lingua, scenario) {
  // Messaggi mandati al modello: sistema + ultimi messaggi della sessione + lingua + nuovo messaggio
  const messaggi = componiMessaggi(storico, lingua, messaggio, scenario);

  const esito = {
    risposta: null, strumenti: [], sezioni_consultate: [], grafici: [], pulizia: null,
    riconoscimenti: [], bozza_riconoscimento: null, eccedenze_donate: null, calcoli: [], token: 0,
  };

  // Se il front end ha chiuso la richiesta non si fanno altre chiamate
  const controllaAnnullamento = () => {
    if (segnale.aborted) throw new RichiestaAnnullata();
  };

  // Si attiva se il modello prova a dare numeri senza aver usato strumenti (una volta per richiesta)
  let strumentoObbligatorio = false;
  // Vale solo per la chiamata successiva al controllo: dopo, il modello torna libero di rispondere
  let obbligoPerProssimaChiamata = false;

  for (let iterazione = 1; iterazione <= MAX_ITERAZIONI; iterazione++) {
    controllaAnnullamento();
    controllaTettoGiornaliero();
    if (!prenotaChiamate(1)) {
      throw new ErroreUtente(429, "È stato raggiunto il numero massimo di chiamate al servizio di intelligenza artificiale.");
    }

    // All'ultima iterazione il modello deve rispondere senza chiamare altri strumenti
    const ultimaIterazione = iterazione === MAX_ITERAZIONI;

    let completamento;
    try {
      completamento = await openai.chat.completions.create(
        {
          model: MODELLO,
          messages: messaggi,
          tools: DEFINIZIONI_STRUMENTI,
          tool_choice: ultimaIterazione ? "none" : obbligoPerProssimaChiamata ? "required" : "auto",
          // Uno strumento alla volta: nelle domande ibride la procedura si cerca DOPO l'analisi
          parallel_tool_calls: false,
          temperature: 0,
          max_completion_tokens: MAX_TOKEN_RISPOSTA,
        },
        // Il segnale interrompe la chiamata in corso se il front end chiude la richiesta
        { signal: segnale }
      );
    } catch (errore) {
      if (segnale.aborted) throw new RichiestaAnnullata();
      console.error(`[openai] chiamata non riuscita (${errore.constructor.name})`);
      throw erroreOpenAI(errore);
    }

    obbligoPerProssimaChiamata = false;
    const tokenChiamata = completamento.usage?.total_tokens ?? 0;
    esito.token += tokenChiamata;
    aggiungiTokenOggi(tokenChiamata);
    const risposta = completamento.choices[0].message;
    const chiamate = risposta.tool_calls ?? [];

    // Nessuno strumento richiesto: questa è la risposta finale
    if (chiamate.length === 0) {
      let testoFinale = risposta.content?.trim() || "Non sono riuscito a formulare una risposta. Prova a riformulare la domanda.";

      // Controllo fisso: cifre in euro o percentuale senza nessuno strumento usato = numeri inventati.
      // Si scarta la risposta e si obbliga il modello a usare uno strumento (una sola volta).
      if (esito.strumenti.length === 0 && CIFRE_CON_UNITA.test(testoFinale) && !strumentoObbligatorio && !ultimaIterazione) {
        console.log("[chat] risposta con numeri senza strumenti: scartata, strumento obbligatorio");
        strumentoObbligatorio = true;
        obbligoPerProssimaChiamata = true;
        messaggi.push({
          role: "system",
          content: "La risposta che stavi per dare contiene numeri ma non hai usato strumenti: è vietato. " +
            "Usa analizza_dati per i numeri del negozio o cerca_procedure per il manuale, poi rispondi.",
        });
        continue;
      }

      // Sezioni del manuale: si mostrano solo quelle che il modello dichiara di aver usato,
      // e solo se sono davvero tra quelle restituite dalla ricerca (così non può inventarne)
      const { testo: senzaFonti, titoli } = separaFonti(testoFinale);
      testoFinale = senzaFonti;
      if (titoli && titoli.length > 0) {
        const usate = esito.sezioni_consultate.filter((s) =>
          titoli.some((t) => t.toLowerCase() === s.sezione.toLowerCase())
        );
        if (usate.length > 0) esito.sezioni_consultate = usate;
      }

      // La bozza si separa solo se il briefing ha davvero restituito dei riconoscimenti
      if (esito.riconoscimenti.length > 0) {
        const { testo, bozza } = separaBozza(testoFinale);
        esito.risposta = testo;
        esito.bozza_riconoscimento = bozza;
      } else {
        esito.risposta = separaBozza(testoFinale).testo; // un'eventuale bozza non richiesta si toglie
      }
      // Niente domanda finale che offre altro (regola del prompt che il modello a volte ignora)
      esito.risposta = togliDomandaFinale(esito.risposta);
      // In inglese, la fonte ufficiale (manuale in italiano) la aggiunge il codice
      esito.risposta = aggiungiFonteUfficiale(esito.risposta, lingua, esito.sezioni_consultate);
      return esito;
    }

    // Il messaggio dell'assistente con le chiamate va rimandato al modello insieme ai risultati
    messaggi.push({ role: "assistant", content: risposta.content ?? null, tool_calls: chiamate });

    for (const chiamata of chiamate) {
      const nome = chiamata.function?.name;
      // Parametri per tipo di strumento: nessuno (prepara_briefing), un periodo (controlla_soglie)
      // oppure la domanda (analizza_dati, cerca_procedure)
      const senzaParametri = STRUMENTI_SENZA_PARAMETRI.has(nome);
      const conPeriodo = STRUMENTI_CON_PERIODO.has(nome);
      const periodo = conPeriodo ? leggiPeriodo(chiamata.function?.arguments) : null;
      const domanda = senzaParametri || conPeriodo ? null : leggiDomanda(chiamata.function?.arguments);
      let contenuto;

      if (!STRUMENTI[nome]) {
        contenuto = `Errore: lo strumento "${nome}" non esiste.`;
      } else if (conPeriodo && !periodo) {
        contenuto = "Errore: inizio e fine devono essere date nel formato AAAA-MM-GG.";
      } else if (!senzaParametri && !conPeriodo && !domanda) {
        contenuto = "Errore: manca il parametro obbligatorio \"domanda\".";
      } else {
        controllaAnnullamento();
        // Prenoto le chiamate OpenAI che lo strumento può fare (caso peggiore): 5 per il data agent,
        // 1 embedding per la ricerca, nessuna per briefing e controllo delle soglie (solo pandas)
        const chiamateStrumento = {
          analizza_dati: CHIAMATE_MASSIME_DATA_AGENT, cerca_procedure: 1, prepara_briefing: 0, controlla_soglie: 0,
        }[nome];
        if (!prenotaChiamate(chiamateStrumento)) {
          contenuto = "Errore: raggiunto il numero massimo di chiamate consentite, lo strumento non è stato eseguito. Avvisa lo Store Manager.";
        } else {
          // Per il front end: la domanda passata, oppure il periodo controllato
          esito.strumenti.push({ nome, domanda: periodo ? `dal ${periodo.inizio} al ${periodo.fine}` : domanda });
          const risultato = senzaParametri
            ? await STRUMENTI[nome](segnale, scenario.id)
            : await STRUMENTI[nome](periodo ?? domanda, segnale, scenario.id);
          controllaAnnullamento();
          contenuto = risultato.testoPerLLM;

          // Token usati dal data agent (se li comunica): contano nella risposta e nel tetto giornaliero
          if (risultato.token) {
            esito.token += risultato.token;
            aggiungiTokenOggi(risultato.token);
          }

          // Fonti, grafici e pulizia restano al server e vanno solo al front end
          for (const fonte of risultato.fonti ?? []) {
            const giaPresente = esito.sezioni_consultate.some((f) => f.file === fonte.file && f.sezione === fonte.sezione);
            if (!giaPresente) esito.sezioni_consultate.push(fonte);
          }
          if (risultato.grafico) esito.grafici.push(risultato.grafico);
          if (risultato.riconoscimenti?.length) esito.riconoscimenti.push(...risultato.riconoscimenti);
          if (risultato.eccedenze) esito.eccedenze_donate = risultato.eccedenze;
          // "Come l'ho calcolato": codice del data agent o regole fisse degli strumenti deterministici
          if (risultato.calcolo) esito.calcoli.push({ strumento: nome, ...risultato.calcolo });
          if (risultato.pulizia) esito.pulizia = risultato.pulizia;
        }
      }

      messaggi.push({ role: "tool", tool_call_id: chiamata.id, content: contenuto });
    }
  }

  // Non si arriva qui: l'ultima iterazione impone una risposta senza strumenti
  esito.risposta = "Non sono riuscito a completare la risposta. Prova a riformulare la domanda.";
  return esito;
}

// ---------------------------------------------------------------------------
// Server Express
// ---------------------------------------------------------------------------

// Azioni dirette dei pulsanti (briefing, soglie, report), con gli stessi servizi della chat
const azioni = creaAzioni({ chiamaModello, componiMessaggi });

// Valutazioni delle risposte: una riga per voto in feedback.jsonl (FILE_FEEDBACK solo per i test)
const feedback = creaFeedback({
  percorsoFile: process.env.FILE_FEEDBACK || path.join(__dirname, "feedback.jsonl"),
  ErroreUtente,
});

const app = express();

// CORS abilitato solo per il front end React
app.use(cors({ origin: ORIGINE_FRONT_END }));
app.use(express.json({ limit: "20kb" }));

// Limite di frequenza su /api/chat: oltre la soglia risponde 429 con un messaggio in italiano
const limiteFrequenza = rateLimit({
  windowMs: 60 * 1000,
  limit: LIMITE_RICHIESTE_MINUTO,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { errore: "Troppe richieste in poco tempo: aspetta un minuto e riprova.", codice: "troppe_richieste" },
});

// Domanda dell'utente: {"sessionId": "...", "messaggio": "..."}
app.post("/api/chat", limiteFrequenza, async (req, res, next) => {
  const inizio = Date.now();

  // Se il front end chiude la connessione prima della risposta, si interrompono ciclo e chiamate.
  // Si ascolta "close" sulla risposta: sulla richiesta scatta già quando il corpo è stato letto.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const { sessionId, messaggio } = req.body ?? {};
    const lingua = leggiLingua(req.body?.lingua);
    const scenario = leggiScenario(req.body?.scenario);

    controllaSessione(sessionId);
    if (typeof messaggio !== "string") {
      throw new ErroreUtente(400, "Il messaggio deve essere un testo.", "messaggio_non_valido");
    }
    if (!messaggio.trim()) {
      throw new ErroreUtente(400, "Il messaggio è vuoto: scrivi una domanda.", "messaggio_vuoto");
    }
    const testo = messaggio.trim();
    if (testo.length > LUNGHEZZA_MASSIMA_MESSAGGIO) {
      throw new ErroreUtente(400, `Il messaggio è troppo lungo: al massimo ${LUNGHEZZA_MASSIMA_MESSAGGIO} caratteri.`, "messaggio_lungo");
    }

    controllaTettoGiornaliero();
    const storico = leggiSessione(sessionId, scenario);
    const esito = await rispondi(storico, testo, controller.signal, lingua, scenario);

    // In memoria salvo solo domanda e risposta finale, e solo se la richiesta è riuscita
    const aggiornato = [...storico, { role: "user", content: testo }, { role: "assistant", content: esito.risposta }];
    salvaSessione(sessionId, aggiornato.slice(-MESSAGGI_IN_MEMORIA), scenario);
    // Id della risposta, per la valutazione con i pollici
    esito.id_messaggio = feedback.ricordaRisposta({
      sessionId, scenario: scenario.id, domanda: testo, strumenti: esito.strumenti, risposta: esito.risposta,
    });

    // Log della richiesta: strumenti, token e tempo
    const elencoStrumenti = esito.strumenti.map((s) => s.nome).join(" -> ") || "nessuno";
    const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
    console.log(
      `[chat] strumenti: ${elencoStrumenti} | token: ${esito.token} | tempo: ${secondi}s | ` +
        `token oggi: ${tokenUsatiOggi()}/${TETTO_TOKEN_GIORNALIERO} | chiamate OpenAI totali: ${chiamateOpenAIUsate}`
    );

    res.json(esito);
  } catch (errore) {
    const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
    if (errore instanceof RichiestaAnnullata) {
      // Il front end non aspetta più: nessuna risposta da inviare e niente salvato in memoria
      console.log(`[chat] richiesta annullata dal client | tempo: ${secondi}s | chiamate OpenAI totali: ${chiamateOpenAIUsate}`);
      return;
    }
    console.log(`[chat] richiesta non riuscita | tempo: ${secondi}s | chiamate OpenAI totali: ${chiamateOpenAIUsate}`);
    next(errore);
  }
});

// Azioni dirette dei pulsanti: {"sessionId": "...", "lingua": "it" | "en"}.
// Gli strumenti li chiama il codice (azioni.js); stessi limiti di frequenza e di token della chat.
app.post("/api/azioni/:azione", limiteFrequenza, async (req, res, next) => {
  const inizio = Date.now();
  const { azione } = req.params;

  // Come per la chat: se il front end chiude la connessione si interrompono le chiamate
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (!AZIONI.includes(azione)) {
      throw new ErroreUtente(404, "Azione non disponibile.", "azione_sconosciuta");
    }
    const { sessionId } = req.body ?? {};
    const lingua = leggiLingua(req.body?.lingua);
    const scenario = leggiScenario(req.body?.scenario);
    controllaSessione(sessionId);
    controllaTettoGiornaliero();

    const storico = leggiSessione(sessionId, scenario);
    const { esito, richiesta, rispostaPerMemoria } = await azioni.eseguiAzione(azione, {
      lingua, storico, segnale: controller.signal, scenario,
    });

    // In memoria vanno la richiesta (con il periodo esplicito) e la risposta, come per la chat:
    // così dopo si può chiedere in chat, per esempio, "e la settimana prima?"
    const aggiornato = [...storico, { role: "user", content: richiesta }, { role: "assistant", content: rispostaPerMemoria }];
    salvaSessione(sessionId, aggiornato.slice(-MESSAGGI_IN_MEMORIA), scenario);
    esito.id_messaggio = feedback.ricordaRisposta({
      sessionId, scenario: scenario.id, domanda: richiesta, strumenti: esito.strumenti,
      // Per il report si salva anche la bozza della mail, non solo la frase che la presenta
      risposta: esito.report ? `${esito.risposta}

${esito.report.oggetto}
${esito.report.corpo}` : esito.risposta,
    });

    const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
    console.log(
      `[azione ${azione}] strumenti: ${esito.strumenti.map((s) => s.nome).join(" -> ")} | token: ${esito.token} | ` +
        `tempo: ${secondi}s | token oggi: ${tokenUsatiOggi()}/${TETTO_TOKEN_GIORNALIERO} | chiamate OpenAI totali: ${chiamateOpenAIUsate}`
    );
    res.json({ ...esito, azione, richiesta });
  } catch (errore) {
    const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
    if (errore instanceof RichiestaAnnullata) {
      console.log(`[azione ${azione}] richiesta annullata dal client | tempo: ${secondi}s`);
      return;
    }
    console.log(`[azione ${azione}] richiesta non riuscita (${errore.name}) | tempo: ${secondi}s`);
    next(errore);
  }
});

// Valutazione di una risposta: {"sessionId", "idMessaggio", "voto": "su" | "giu", "commento"?}.
// Stesso limite di frequenza della chat; nessuna chiamata a OpenAI.
app.post("/api/feedback", limiteFrequenza, (req, res, next) => {
  try {
    const { sessionId, idMessaggio, voto, commento } = req.body ?? {};
    controllaSessione(sessionId);
    const riga = feedback.registraVoto({ sessionId, idMessaggio, voto, commento });
    console.log(`[feedback] voto: ${riga.voto} | strumenti: ${riga.strumenti.join(", ") || "nessuno"}${riga.commento ? " | con commento" : ""}`);
    res.json({ ok: true });
  } catch (errore) {
    next(errore);
  }
});

// Scenari della demo disponibili (il front end mostra il menu e invia solo l'id)
app.get("/api/scenari", (req, res) => {
  res.json(SCENARI);
});

// Stato del server e dei servizi da cui dipende
app.get("/api/health", async (req, res) => {
  const controlli = await Promise.allSettled([
    creaClient().heartbeat(),
    fetch(`${indirizzoDataAgent()}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => {
      if (!r.ok) throw new Error("stato non valido");
    }),
  ]);
  const chromadb = controlli[0].status === "fulfilled" ? "ok" : "non raggiungibile";
  const dataAgent = controlli[1].status === "fulfilled" ? "ok" : "non raggiungibile";
  const tuttoOk = chromadb === "ok" && dataAgent === "ok";

  res.status(tuttoOk ? 200 : 503).json({
    stato: tuttoOk ? "ok" : "degradato",
    server: "ok",
    chromadb,
    dataAgent,
  });
});

// Gestione centralizzata degli errori: solo messaggi fissi in italiano
app.use((errore, req, res, next) => {
  if (errore instanceof ErroreUtente) {
    return res.status(errore.stato).json({ errore: errore.message, codice: errore.codice });
  }
  // JSON malformato o corpo troppo grande (errori generati da express.json)
  if (errore.type === "entity.parse.failed") {
    return res.status(400).json({ errore: "La richiesta non è in un formato valido." });
  }
  if (errore.type === "entity.too.large") {
    return res.status(413).json({ errore: "La richiesta è troppo grande." });
  }
  console.error(`[server] errore imprevisto (${errore.name})`);
  res.status(500).json({ errore: "Si è verificato un errore interno. Riprova più tardi." });
});

// Pulizia periodica delle sessioni scadute (unref: non impedisce al processo di chiudersi)
setInterval(pulisciSessioni, 10 * 60 * 1000).unref();

app.listen(PORTA, INDIRIZZO_ASCOLTO, () => {
  console.log(
    `Orchestratore in ascolto su http://${INDIRIZZO_ASCOLTO}:${PORTA} (modello: ${MODELLO}, ` +
      `max ${LIMITE_RICHIESTE_MINUTO} richieste/minuto, tetto ${TETTO_TOKEN_GIORNALIERO} token/giorno)`
  );
});
