# Avvio manuale dei servizi

I servizi sono quattro e vanno avviati **in quest'ordine**, ognuno in un
terminale Windows PowerShell separato. Ogni terminale resta occupato dal
suo servizio: per fermarlo, premi `Ctrl+C` in quel terminale.

Le porte sono quelle del file `.env` (valori predefiniti: ChromaDB 8000,
data agent 8001, back end 3001; il front end usa sempre 5173).

## Prima volta soltanto

Il `.env` deve contenere `OPENAI_API_KEY`, `OPENAI_MODEL` e
`ORCHESTRATOR_MODEL` (vedi `.env.example`). Poi installa le dipendenze:

```powershell
cd "C:\Users\maloa\OneDrive\Desktop\Progetto finale"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd backend;  npm install;  cd ..
cd frontend; npm install;  cd ..
```

Se la collezione del manuale non esiste ancora in ChromaDB, avvia
ChromaDB (terminale 1) e poi esegui una volta, dalla cartella `backend`:
`node rag/indicizza.js`.

## Terminale 1 – ChromaDB

```powershell
cd "C:\Users\maloa\OneDrive\Desktop\Progetto finale"
.\.venv\Scripts\chroma.exe run --path .\chroma_data --port 8000
```

Pronto quando compare `Frontend server listening on address, addr: localhost:8000`.

## Terminale 2 – Data agent (FastAPI)

```powershell
cd "C:\Users\maloa\OneDrive\Desktop\Progetto finale"
.\.venv\Scripts\python.exe data_agent\app.py
```

Pronto quando compare `Uvicorn running on http://127.0.0.1:8001`.

## Terminale 3 – Back end (orchestratore Node.js)

```powershell
cd "C:\Users\maloa\OneDrive\Desktop\Progetto finale\backend"
node server.js
```

Pronto quando compare `Orchestratore in ascolto su http://127.0.0.1:3001` (il back end
risponde solo da questo computer, non dagli altri dispositivi della rete).

## Terminale 4 – Front end (React + Vite)

```powershell
cd "C:\Users\maloa\OneDrive\Desktop\Progetto finale\frontend"
npm run dev
```

Poi apri il browser su <http://localhost:5173>.

## Controllo

Con tutti e quattro i servizi avviati, l'indirizzo
<http://localhost:5173/api/health> deve rispondere:

```json
{"stato":"ok","server":"ok","chromadb":"ok","dataAgent":"ok"}
```

Se `chromadb` o `dataAgent` risultano `non raggiungibile`, controlla il
terminale del servizio corrispondente.
