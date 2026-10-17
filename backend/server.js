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

const { STRUMENTI, STRUMENTI_SENZA_PARAMETRI, CHIAMATE_MASSIME_DATA_AGENT, indirizzoDataAgent } = require("./strumenti");
const { creaClient } = require("./rag/config");

// ---------------------------------------------------------------------------
// Configurazione
// ---------------------------------------------------------------------------

const PORTA = Number(process.env.BACKEND_PORT || 3001);
const ORIGINE_FRONT_END = "http://localhost:5173";

const LUNGHEZZA_MASSIMA_MESSAGGIO = 1000; // caratteri
const MESSAGGI_IN_MEMORIA = 10;           // ultimi messaggi della sessione mandati all'LLM
const MAX_ITERAZIONI = 6;                 // chiamate al modello per ogni richiesta
const MAX_TOKEN_RISPOSTA = 1000;          // token massimi generati in una singola chiamata
const TIMEOUT_OPENAI_MS = 60_000;         // tempo massimo per una singola chiamata a OpenAI

// Tetto facoltativo alle chiamate OpenAI per tutta la vita del server (usato dal test).
// Conta le chiamate dell'orchestratore, gli embedding della ricerca e, per il data agent,
// sempre il caso peggiore di 5 chiamate. Se la variabile manca non c'è limite.
const MAX_CHIAMATE_OPENAI = process.env.MAX_CHIAMATE_OPENAI ? Number(process.env.MAX_CHIAMATE_OPENAI) : Infinity;
let chiamateOpenAIUsate = 0;

// Controllo all'avvio che la configurazione necessaria sia presente
for (const variabile of ["OPENAI_API_KEY", "ORCHESTRATOR_MODEL", "NEGOZIO_UTENTE", "DATA_RIFERIMENTO"]) {
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

// Date del prompt, con la stessa logica del data agent:
// ieri = DATA_RIFERIMENTO meno 1 giorno; inizio settimana = ieri meno 6 giorni;
// mese corrente = mese di ieri, per esteso
const OGGI = new Date(`${process.env.DATA_RIFERIMENTO}T12:00:00`);
const IERI = new Date(OGGI);
IERI.setDate(IERI.getDate() - 1);
const INIZIO_SETTIMANA = new Date(IERI);
INIZIO_SETTIMANA.setDate(INIZIO_SETTIMANA.getDate() - 6);
const MESE_CORRENTE = IERI.toLocaleDateString("it-IT", { month: "long", year: "numeric" }); // es. "agosto 2026"

// Prompt e definizioni degli strumenti, letti una sola volta dai file in prompts/
const CARTELLA_PROMPT = path.join(__dirname, "prompts");
const PROMPT_SISTEMA = fs
  .readFileSync(path.join(CARTELLA_PROMPT, "sistema.txt"), "utf-8")
  .replaceAll("{negozio}", process.env.NEGOZIO_UTENTE)
  .replaceAll("{oggi}", formattaData(OGGI))
  .replaceAll("{ieri}", formattaData(IERI))
  .replaceAll("{inizio_settimana}", formattaData(INIZIO_SETTIMANA))
  .replaceAll("{mese_corrente}", MESE_CORRENTE);
const DEFINIZIONI_STRUMENTI = JSON.parse(fs.readFileSync(path.join(CARTELLA_PROMPT, "strumenti.json"), "utf-8"));

// Client OpenAI: nessun nuovo tentativo automatico, per non moltiplicare le chiamate
const openai = new OpenAI({ maxRetries: 0, timeout: TIMEOUT_OPENAI_MS });

// Memoria delle conversazioni: sessionId -> elenco di messaggi {role, content}.
// Si conservano solo le domande dell'utente e le risposte finali, non i passaggi intermedi.
const sessioni = new Map();

// ---------------------------------------------------------------------------
// Funzioni di supporto
// ---------------------------------------------------------------------------

// Scrive una data per esteso, es. "martedì 1 settembre 2026"
function formattaData(data) {
  return data.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Errore con un messaggio fisso in italiano, che si può mostrare al front end
class ErroreUtente extends Error {
  constructor(stato, messaggio) {
    super(messaggio);
    this.stato = stato;
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

// Prenota n chiamate OpenAI nel tetto massimo; restituisce false se si sforerebbe
function prenotaChiamate(n) {
  if (chiamateOpenAIUsate + n > MAX_CHIAMATE_OPENAI) return false;
  chiamateOpenAIUsate += n;
  return true;
}

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

// ---------------------------------------------------------------------------
// Ciclo di function calling
// ---------------------------------------------------------------------------

/**
 * Fa rispondere l'LLM al messaggio, eseguendo gli strumenti che sceglie.
 * @param {Array} storico - messaggi precedenti della sessione
 * @param {string} messaggio - nuovo messaggio dell'utente
 */
async function rispondi(storico, messaggio) {
  // Messaggi mandati al modello: sistema + ultimi messaggi della sessione + nuovo messaggio
  const messaggi = [
    { role: "system", content: PROMPT_SISTEMA },
    ...storico.slice(-MESSAGGI_IN_MEMORIA),
    { role: "user", content: messaggio },
  ];

  const esito = { risposta: null, strumenti: [], sezioni_consultate: [], grafici: [], pulizia: null, token: 0 };

  for (let iterazione = 1; iterazione <= MAX_ITERAZIONI; iterazione++) {
    if (!prenotaChiamate(1)) {
      throw new ErroreUtente(429, "È stato raggiunto il numero massimo di chiamate al servizio di intelligenza artificiale.");
    }

    // All'ultima iterazione il modello deve rispondere senza chiamare altri strumenti
    const ultimaIterazione = iterazione === MAX_ITERAZIONI;

    let completamento;
    try {
      completamento = await openai.chat.completions.create({
        model: MODELLO,
        messages: messaggi,
        tools: DEFINIZIONI_STRUMENTI,
        tool_choice: ultimaIterazione ? "none" : "auto",
        // Uno strumento alla volta: nelle domande ibride la procedura si cerca DOPO l'analisi
        parallel_tool_calls: false,
        temperature: 0,
        max_completion_tokens: MAX_TOKEN_RISPOSTA,
      });
    } catch (errore) {
      console.error(`[openai] chiamata non riuscita (${errore.constructor.name})`);
      throw erroreOpenAI(errore);
    }

    esito.token += completamento.usage?.total_tokens ?? 0;
    const risposta = completamento.choices[0].message;
    const chiamate = risposta.tool_calls ?? [];

    // Nessuno strumento richiesto: questa è la risposta finale
    if (chiamate.length === 0) {
      esito.risposta = risposta.content?.trim() || "Non sono riuscito a formulare una risposta. Prova a riformulare la domanda.";
      return esito;
    }

    // Il messaggio dell'assistente con le chiamate va rimandato al modello insieme ai risultati
    messaggi.push({ role: "assistant", content: risposta.content ?? null, tool_calls: chiamate });

    for (const chiamata of chiamate) {
      const nome = chiamata.function?.name;
      // Gli strumenti senza parametri (prepara_briefing) non ricevono la domanda
      const senzaParametri = STRUMENTI_SENZA_PARAMETRI.has(nome);
      const domanda = senzaParametri ? null : leggiDomanda(chiamata.function?.arguments);
      let contenuto;

      if (!STRUMENTI[nome]) {
        contenuto = `Errore: lo strumento "${nome}" non esiste.`;
      } else if (!senzaParametri && !domanda) {
        contenuto = "Errore: manca il parametro obbligatorio \"domanda\".";
      } else {
        // Prenoto le chiamate OpenAI che lo strumento può fare (caso peggiore):
        // 5 per il data agent, 1 embedding per la ricerca, nessuna per il briefing (solo pandas)
        const chiamateStrumento = { analizza_dati: CHIAMATE_MASSIME_DATA_AGENT, cerca_procedure: 1, prepara_briefing: 0 }[nome];
        if (!prenotaChiamate(chiamateStrumento)) {
          contenuto = "Errore: raggiunto il numero massimo di chiamate consentite, lo strumento non è stato eseguito. Avvisa lo Store Manager.";
        } else {
          esito.strumenti.push({ nome, domanda });
          const risultato = senzaParametri ? await STRUMENTI[nome]() : await STRUMENTI[nome](domanda);
          contenuto = risultato.testoPerLLM;

          // Fonti, grafici e pulizia restano al server e vanno solo al front end
          for (const fonte of risultato.fonti ?? []) {
            const giaPresente = esito.sezioni_consultate.some((f) => f.file === fonte.file && f.sezione === fonte.sezione);
            if (!giaPresente) esito.sezioni_consultate.push(fonte);
          }
          if (risultato.grafico) esito.grafici.push(risultato.grafico);
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

const app = express();

// CORS abilitato solo per il front end React
app.use(cors({ origin: ORIGINE_FRONT_END }));
app.use(express.json({ limit: "20kb" }));

// Domanda dell'utente: {"sessionId": "...", "messaggio": "..."}
app.post("/api/chat", async (req, res, next) => {
  const inizio = Date.now();
  try {
    const { sessionId, messaggio } = req.body ?? {};

    if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 100) {
      throw new ErroreUtente(400, "Sessione non valida.");
    }
    if (typeof messaggio !== "string" || !messaggio.trim()) {
      throw new ErroreUtente(400, "Il messaggio è vuoto: scrivi una domanda.");
    }
    const testo = messaggio.trim();
    if (testo.length > LUNGHEZZA_MASSIMA_MESSAGGIO) {
      throw new ErroreUtente(400, `Il messaggio è troppo lungo: al massimo ${LUNGHEZZA_MASSIMA_MESSAGGIO} caratteri.`);
    }

    const storico = sessioni.get(sessionId) ?? [];
    const esito = await rispondi(storico, testo);

    // In memoria salvo solo domanda e risposta finale, e solo se la richiesta è riuscita
    storico.push({ role: "user", content: testo }, { role: "assistant", content: esito.risposta });
    sessioni.set(sessionId, storico.slice(-MESSAGGI_IN_MEMORIA));

    // Log della richiesta: strumenti, token e tempo
    const elencoStrumenti = esito.strumenti.map((s) => s.nome).join(" -> ") || "nessuno";
    const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
    console.log(
      `[chat] strumenti: ${elencoStrumenti} | token: ${esito.token} | tempo: ${secondi}s | chiamate OpenAI totali: ${chiamateOpenAIUsate}`
    );

    res.json(esito);
  } catch (errore) {
    const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
    console.log(`[chat] richiesta non riuscita | tempo: ${secondi}s | chiamate OpenAI totali: ${chiamateOpenAIUsate}`);
    next(errore);
  }
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
    return res.status(errore.stato).json({ errore: errore.message });
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

app.listen(PORTA, () => {
  console.log(`Orchestratore in ascolto su http://localhost:${PORTA} (modello: ${MODELLO})`);
});
