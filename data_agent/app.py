"""Servizio FastAPI del data agent.

Riceve una domanda in linguaggio naturale, la fa analizzare al pandas agent
sui dati puliti dei negozi e restituisce la risposta, l'URL del grafico
generato e il riepilogo della pulizia dei dati.
Prepara inoltre il briefing del mattino, calcolato solo con pandas (POST /briefing).

Avvio (dalla cartella principale del progetto, con il .venv attivo):
    python data_agent/app.py
"""

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path

# Backend "Agg": matplotlib disegna solo su file, senza aprire finestre.
# Va impostato prima di qualsiasi import di matplotlib.pyplot (anche da parte dell'agente).
import matplotlib

matplotlib.use("Agg")

import openai
import pandas as pd
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from langchain_experimental.agents import create_pandas_dataframe_agent
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from briefing import prepara_briefing
from grafici import disegna_grafico, estrai_blocco_grafico
from pulizia import pulisci_dati, riepilogo_pulizia

# Percorsi del progetto
CARTELLA_AGENTE = Path(__file__).resolve().parent
CARTELLA_PROGETTO = CARTELLA_AGENTE.parent
PERCORSO_CSV = CARTELLA_PROGETTO / "data" / "dati_negozi.csv"
PERCORSO_PROMPT = CARTELLA_AGENTE / "prompt_data_agent.txt"
CARTELLA_GRAFICI = CARTELLA_AGENTE / "charts"

# Carico le variabili dal file .env della cartella principale
load_dotenv(CARTELLA_PROGETTO / ".env")

# Limiti alle chiamate OpenAI, per evitare loop e costi imprevisti
MAX_TOKEN_RISPOSTA = 2000     # con meno token il codice scritto dall'agente veniva troncato
MAX_PASSI_PER_DOMANDA = 5     # ogni passo dell'agente è una chiamata al modello
MAX_SECONDI_PER_DOMANDA = 90  # tempo massimo per una singola domanda
TIMEOUT_CHIAMATA = 60         # tempo massimo per una singola chiamata a OpenAI
RIGHE_ANTEPRIMA = 3           # righe di esempio del DataFrame incluse nel prompt

MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]

logger = logging.getLogger("data_agent")

# Stato caricato all'avvio e condiviso tra le richieste (solo in lettura)
stato = {}


@asynccontextmanager
async def ciclo_di_vita(app: FastAPI):
    """All'avvio controlla la configurazione, carica e pulisce i dati una sola volta."""
    for variabile in ("OPENAI_API_KEY", "OPENAI_MODEL", "DATA_RIFERIMENTO", "NEGOZIO_UTENTE"):
        if not os.getenv(variabile):
            raise RuntimeError(f"Variabile {variabile} mancante nel file .env")
    if os.getenv("OPENAI_MODEL") == "nome-del-modello":
        raise RuntimeError("OPENAI_MODEL nel file .env contiene ancora il valore di esempio")

    df_originale = pd.read_csv(PERCORSO_CSV)
    df_pulito, report = pulisci_dati(df_originale)
    stato["df_pulito"] = df_pulito
    stato["riepilogo_pulizia"] = riepilogo_pulizia(report)
    stato["testo_prompt"] = PERCORSO_PROMPT.read_text(encoding="utf-8")
    logger.info("Dati caricati: %d righe dopo la pulizia", len(df_pulito))
    yield
    stato.clear()


app = FastAPI(title="Data agent", lifespan=ciclo_di_vita)

# La cartella dei grafici deve esistere prima di essere servita come file statici
CARTELLA_GRAFICI.mkdir(exist_ok=True)
app.mount("/charts", StaticFiles(directory=CARTELLA_GRAFICI), name="charts")


class Domanda(BaseModel):
    domanda: str


def costruisci_prompt() -> str:
    """Riempie i segnaposto del prompt, come nel notebook."""
    oggi = date.fromisoformat(os.getenv("DATA_RIFERIMENTO"))
    ieri = oggi - timedelta(days=1)
    inizio_settimana = ieri - timedelta(days=6)
    return stato["testo_prompt"].format(
        oggi=oggi.isoformat(),
        ieri=ieri.isoformat(),
        inizio_settimana=inizio_settimana.isoformat(),
        mese_corrente=f"{MESI[ieri.month - 1]} {ieri.year}",
        negozio=os.getenv("NEGOZIO_UTENTE"),
    )


def grafico_dalla_risposta(testo: str, percorso_grafico: Path) -> str:
    """Toglie dalla risposta il blocco ```json del grafico e, se la spec è valida, disegna il grafico.
    Restituisce il testo senza il blocco. Se manca o non è valido: nessun grafico, solo una riga di log."""
    testo_pulito, spec, motivo = estrai_blocco_grafico(testo)
    if spec is not None:
        try:
            creato, motivo = disegna_grafico(spec, percorso_grafico)
        except Exception as errore:
            creato, motivo = False, f"errore nel disegno ({type(errore).__name__})"
        if creato:
            return testo_pulito
    if spec is not None:
        # Si registra anche la spec scartata (solo dati del grafico, niente di sensibile), troncata
        logger.warning("Grafico non prodotto: %s | spec: %s", motivo, json.dumps(spec, ensure_ascii=False)[:500])
    else:
        logger.warning("Grafico non prodotto: %s", motivo)
    return testo_pulito


def messaggio_errore(errore: Exception) -> str:
    """Traduce l'errore in un messaggio in italiano, senza mai riportare il testo originale
    (i messaggi di OpenAI possono contenere parti della chiave API)."""
    if isinstance(errore, openai.AuthenticationError):
        return "Chiave API OpenAI non valida o non autorizzata: controlla OPENAI_API_KEY nel file .env."
    if isinstance(errore, openai.RateLimitError):
        return "Limite di utilizzo OpenAI raggiunto (troppe richieste o credito esaurito). Riprova più tardi."
    if isinstance(errore, (openai.APITimeoutError, TimeoutError)):
        return "OpenAI non ha risposto in tempo. Riprova più tardi."
    if isinstance(errore, openai.APIConnectionError):
        return "Impossibile collegarsi a OpenAI: controlla la connessione di rete."
    if isinstance(errore, openai.BadRequestError):
        return "OpenAI ha rifiutato la richiesta: controlla che OPENAI_MODEL nel file .env sia un modello valido."
    return f"Errore interno durante l'analisi ({type(errore).__name__})."


@app.get("/health")
def health():
    """Controllo rapido che il servizio sia attivo."""
    return {"stato": "ok"}


@app.post("/analizza")
def analizza(richiesta: Domanda, request: Request):
    """Fa rispondere il pandas agent alla domanda e restituisce risposta, grafico e nota sulla pulizia."""
    domanda = richiesta.domanda.strip()
    if not domanda:
        raise HTTPException(status_code=400, detail="La domanda è vuota.")

    # a) Copia dei dati puliti: l'agente non può modificare i dati condivisi tra le richieste
    df_richiesta = stato["df_pulito"].copy()

    # b) Nome file unico per il grafico di questa richiesta (lo disegna il codice, non l'agente)
    nome_grafico = f"grafico_{uuid.uuid4().hex}.png"
    percorso_grafico = CARTELLA_GRAFICI / nome_grafico

    try:
        # c) Prompt con i segnaposto riempiti
        prompt = costruisci_prompt()

        # d) Modello e agente, creati per ogni richiesta sulla copia dei dati
        llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL"),
            temperature=0,
            max_tokens=MAX_TOKEN_RISPOSTA,
            max_retries=0,  # nessun nuovo tentativo automatico in caso di errore
            timeout=TIMEOUT_CHIAMATA,
        )
        agente = create_pandas_dataframe_agent(
            llm,
            df_richiesta,
            agent_type="tool-calling",
            prefix=prompt,
            number_of_head_rows=RIGHE_ANTEPRIMA,
            max_iterations=MAX_PASSI_PER_DOMANDA,
            max_execution_time=MAX_SECONDI_PER_DOMANDA,
            allow_dangerous_code=True,
        )
        risultato = agente.invoke({"input": domanda})
    except Exception as errore:
        logger.error("Analisi non riuscita: %s", type(errore).__name__)
        raise HTTPException(status_code=500, detail=messaggio_errore(errore))

    # e) Il blocco json del grafico si toglie sempre dalla risposta; il grafico si disegna solo se è valido
    risposta = grafico_dalla_risposta(risultato["output"], percorso_grafico)

    # f) URL del grafico solo se il file è stato davvero creato
    url_grafico = f"{str(request.base_url).rstrip('/')}/charts/{nome_grafico}" if percorso_grafico.exists() else None

    return {
        "risposta": risposta,
        "grafico": url_grafico,
        "pulizia": stato["riepilogo_pulizia"],
    }


@app.post("/briefing")
def briefing(request: Request):
    """Briefing del mattino: KPI di ieri, anomalie secondo le soglie del manuale e grafico degli scarti.
    Calcolato solo con pandas, senza chiamate a OpenAI."""
    # Copia dei dati puliti, come per /analizza
    df_richiesta = stato["df_pulito"].copy()
    nome_grafico = f"briefing_{uuid.uuid4().hex}.png"
    percorso_grafico = CARTELLA_GRAFICI / nome_grafico
    oggi = date.fromisoformat(os.getenv("DATA_RIFERIMENTO"))

    try:
        risultato = prepara_briefing(df_richiesta, os.getenv("NEGOZIO_UTENTE"), oggi, percorso_grafico)
    except ValueError as errore:
        # Messaggio scritto da noi in italiano (es. nessun dato per ieri): si può mostrare
        raise HTTPException(status_code=404, detail=str(errore))
    except Exception as errore:
        logger.error("Briefing non riuscito: %s", type(errore).__name__)
        raise HTTPException(status_code=500, detail=f"Errore interno durante il briefing ({type(errore).__name__}).")

    url_grafico = f"{str(request.base_url).rstrip('/')}/charts/{nome_grafico}" if percorso_grafico.exists() else None
    return {
        "kpi": risultato["kpi"],
        "controlli": risultato["controlli"],
        "anomalie": risultato["anomalie"],
        "grafico": url_grafico,
        "pulizia": stato["riepilogo_pulizia"],
    }


if __name__ == "__main__":
    porta = int(os.getenv("DATA_AGENT_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=porta)
