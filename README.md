# SpesaViva – Store Manager Copilot

Assistente per lo Store Manager di un supermercato: risponde a domande sui dati
del negozio e sulle procedure del manuale operativo, prepara il briefing del
mattino, controlla le soglie del manuale e scrive la bozza del report per
l'Area Manager.

- **Orchestratore** (Node.js, `backend/`): un LLM con function calling sceglie
  gli strumenti; regole fisse nel codice controllano la risposta finale.
- **Data agent** (Python, FastAPI, `data_agent/`): un pandas agent di LangChain
  per le domande libere sui dati, più calcoli deterministici (briefing, soglie,
  confronto tra negozi) fatti solo con pandas.
- **RAG** sul manuale operativo (ChromaDB, embedding OpenAI, `backend/rag/`).
- **Front end** (React + Vite, `frontend/`), in italiano e in inglese, con tre
  scenari della demo (giornata tranquilla, ondata di caldo, fornitore in crisi).

## Struttura del progetto

```
├── avvia.mjs          ← installazione e avvio con un solo comando
├── backend/           ← orchestratore Node.js
│   ├── prompts/       ← prompt di sistema e definizioni degli strumenti
│   ├── rag/           ← indicizzazione e ricerca nel manuale (ChromaDB)
│   └── scenari.json   ← scenari della demo (letti anche da data agent e front end)
├── data_agent/        ← servizio Python: pandas agent, briefing, grafici, pulizia
│   └── tests/         ← test pytest (nessuna chiamata a OpenAI)
├── frontend/          ← interfaccia React
├── data/              ← dataset, script che lo genera, manuale operativo
├── docs/              ← diario di bordo, revisione di sicurezza, mappa del codice
├── test/              ← domande di test e risultati, esperimento sui modelli
├── .env.example       ← modello del file .env (chiavi mai su GitHub)
└── requirements.txt   ← dipendenze Python
```

## Avvio con due comandi (consigliato)

Serve Node.js 20.11 o successivo e Python 3. Prima di tutto copia
`.env.example` in `.env` e inserisci `OPENAI_API_KEY`, `OPENAI_MODEL` e
`ORCHESTRATOR_MODEL`: senza `.env` i comandi si fermano con un messaggio.

Dalla cartella principale del progetto:

```powershell
npm run setup   # solo la prima volta (o dopo aver cambiato le dipendenze)
npm start       # ogni volta che vuoi usare il progetto
```

- `npm run setup` crea il `.venv` se manca, installa `requirements.txt`,
  esegue `npm install` in `backend` e `frontend`, avvia ChromaDB,
  indicizza il manuale e ferma ChromaDB. L'indicizzazione usa gli embedding
  OpenAI, quindi si fa **solo se la collezione del manuale non esiste
  ancora**; per rifarla da capo: `npm run setup -- --reindicizza`.
- `npm start` avvia ChromaDB, data agent, back end e front end in
  quest'ordine, aspettando che ognuno sia pronto. L'output di tutti è nello
  stesso terminale, con un prefisso (`[chromadb]`, `[data-agent]`,
  `[backend]`, `[frontend]`). Quando compare
  `Tutto pronto: apri http://localhost:5173` apri quell'indirizzo nel browser.
- **Ctrl+C** ferma tutti i servizi. Su Windows il terminale può poi chiedere
  `Terminare il processo batch (S/N)?`: i servizi sono già fermi, rispondi `S`.
- Se una porta è già occupata (per esempio il progetto è già avviato in un
  altro terminale) `npm start` si ferma subito e lo dice. Se un servizio si
  chiude da solo, vengono fermati anche gli altri.

Lo script funziona su Windows, macOS e Linux (Python del `.venv` in
`Scripts\python.exe` su Windows e in `bin/python` altrove).

### Controllo

Con i servizi avviati, <http://localhost:5173/api/health> deve rispondere:

```json
{"stato":"ok","server":"ok","chromadb":"ok","dataAgent":"ok"}
```

Se `chromadb` o `dataAgent` risultano `non raggiungibile`, controlla l'output
del servizio corrispondente.

## In alternativa: avvio manuale dei servizi

I servizi sono quattro e vanno avviati **in quest'ordine**, ognuno in un
terminale PowerShell separato (`Ctrl+C` nel terminale per fermarlo). Le porte
sono quelle del `.env` (predefinite: ChromaDB 8000, data agent 8001, back end
3001; il front end usa sempre 5173).

La prima volta, installa le dipendenze:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd backend;  npm install;  cd ..
cd frontend; npm install;  cd ..
```

Se la collezione del manuale non esiste ancora, con ChromaDB avviato esegui
una volta, dalla cartella `backend`: `node rag/indicizza.js`.

| Terminale | Comando (dalla cartella principale) | Pronto quando compare |
|---|---|---|
| 1 – ChromaDB | `.\.venv\Scripts\chroma.exe run --path .\chroma_data --port 8000` | `Frontend server listening on address, addr: localhost:8000` |
| 2 – Data agent | `.\.venv\Scripts\python.exe data_agent\app.py` | `Uvicorn running on http://127.0.0.1:8001` |
| 3 – Back end | `cd backend; node server.js` | `Orchestratore in ascolto su http://127.0.0.1:3001` |
| 4 – Front end | `cd frontend; npm run dev` | poi apri <http://localhost:5173> |

Il back end e il data agent ascoltano solo su 127.0.0.1: non sono raggiungibili
dagli altri dispositivi della rete.

## Test

Senza chiamate a OpenAI:

```powershell
cd data_agent; ..\.venv\Scripts\python.exe -m pytest   # pulizia, briefing, soglie, confronto, grafici, sicurezza
cd backend;    npm test                                  # scenari della demo e valutazioni (con un finto OpenAI)
cd frontend;   npm run build; npm run lint
```

Con chiamate reali a OpenAI (a pagamento, da eseguire solo quando serve):
`backend/test_orchestratore.js` (domande end-to-end, con tetto di chiamate) e
`backend/rag/test_ricerca.js` (ricerca nel manuale con le domande di
`test/domande_test.md`).

## Documentazione

- `docs/mappa_del_codice.md` – a cosa serve ogni file e il percorso di una richiesta
- `docs/diario_di_bordo.md` – problemi incontrati, decisioni e motivi
- `docs/revisione.md` – revisione di sicurezza e correzioni
- `test/domande_test.md` – le 20 domande di test e i risultati
- `test/esperimento_modelli.md` – confronto tra gpt-4.1-mini e gpt-4.1
- `backend/riepilogo_feedback.js` – riepilogo delle valutazioni con i pollici, per strumento
