"""Servizio FastAPI del data agent.

Riceve una domanda in linguaggio naturale, la fa analizzare al pandas agent
sui dati puliti dei negozi e restituisce la risposta, l'URL del grafico
generato e il riepilogo della pulizia dei dati.
Prepara inoltre il briefing del mattino, calcolato solo con pandas (POST /briefing).

Avvio (dalla cartella principale del progetto, con il .venv attivo):
    python data_agent/app.py
"""

import hashlib
import json
import logging
import os
import pickle
import time
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
from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from langchain_core.callbacks import UsageMetadataCallbackHandler
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

# ---------------------------------------------------------------------------
# Configurazione dal .env
# ---------------------------------------------------------------------------
# Il .env si legge con dotenv_values (un dizionario) e NON con load_dotenv:
# così la chiave OpenAI non finisce in os.environ, che il codice generato
# dall'agente potrebbe leggere.
VALORI_ENV = dotenv_values(CARTELLA_PROGETTO / ".env")

# Variabili non segrete: copiate in os.environ (se non già impostate) per il resto del codice
VARIABILI_PUBBLICHE = {
    "OPENAI_MODEL", "ORCHESTRATOR_MODEL", "DATA_RIFERIMENTO", "NEGOZIO_UTENTE",
    "BACKEND_PORT", "DATA_AGENT_PORT", "CHROMA_PORT",
    "LIMITE_RICHIESTE_MINUTO", "TETTO_TOKEN_GIORNALIERO",
}
for _nome in VARIABILI_PUBBLICHE:
    if VALORI_ENV.get(_nome) and _nome not in os.environ:
        os.environ[_nome] = VALORI_ENV[_nome]

# La chiave resta solo in questa variabile e si passa esplicitamente a ChatOpenAI.
# Se fosse impostata anche nella shell, la si toglie comunque da os.environ.
_CHIAVE_OPENAI = os.environ.pop("OPENAI_API_KEY", None) or VALORI_ENV.get("OPENAI_API_KEY")

# Valori che non devono mai comparire in una risposta: la chiave e ogni altro valore
# del .env che non sia esplicitamente pubblico (i valori molto corti si ignorano,
# per non bloccare risposte normali)
VALORI_RISERVATI = sorted(
    {v for k, v in VALORI_ENV.items() if k not in VARIABILI_PUBBLICHE and v and len(v) >= 6}
    | ({_CHIAVE_OPENAI} if _CHIAVE_OPENAI else set()),
    key=len, reverse=True,
)
MESSAGGIO_BLOCCATO = ("La risposta è stata bloccata perché conteneva informazioni riservate. "
                      "Riformula la domanda sui dati del negozio.")

# Limiti alle chiamate OpenAI, per evitare loop e costi imprevisti
MAX_TOKEN_RISPOSTA = 2000     # con meno token il codice scritto dall'agente veniva troncato
MAX_PASSI_PER_DOMANDA = 5     # ogni passo dell'agente è una chiamata al modello
MAX_SECONDI_PER_DOMANDA = 90  # tempo massimo per una singola domanda
TIMEOUT_CHIAMATA = 60         # tempo massimo per una singola chiamata a OpenAI
RIGHE_ANTEPRIMA = 3           # righe di esempio del DataFrame incluse nel prompt
DURATA_GRAFICI_ORE = 24       # i grafici più vecchi si cancellano all'avvio

MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]

logger = logging.getLogger("data_agent")

# Stato caricato all'avvio e condiviso tra le richieste (solo in lettura).
# I dati puliti sono conservati come bytes (immutabili) e ogni richiesta ne ricostruisce
# una copia nuova: anche se il codice dell'agente modificasse la sua copia, o arrivasse
# a questo dizionario, la richiesta successiva parte dai dati originali.
stato = {}


# ---------------------------------------------------------------------------
# Funzioni di supporto
# ---------------------------------------------------------------------------

def contiene_dati_riservati(testo: str) -> bool:
    """Vero se il testo contiene "sk-" (inizio delle chiavi OpenAI) o un valore riservato del .env."""
    return "sk-" in testo or any(valore in testo for valore in VALORI_RISERVATI)


def salva_dati_puliti(df: pd.DataFrame) -> None:
    """Conserva i dati puliti come bytes, con l'impronta per controllarne l'integrità."""
    dati = pickle.dumps(df)
    stato["dati"] = dati
    stato["impronta"] = hashlib.sha256(dati).hexdigest()


def carica_dati_puliti() -> None:
    """Legge il CSV, lo pulisce e conserva il risultato (all'avvio o se i dati risultano alterati)."""
    df_pulito, report = pulisci_dati(pd.read_csv(PERCORSO_CSV))
    salva_dati_puliti(df_pulito)
    stato["riepilogo_pulizia"] = riepilogo_pulizia(report)
    logger.info("Dati caricati: %d righe dopo la pulizia", len(df_pulito))


def nuova_copia_dati() -> pd.DataFrame:
    """Copia profonda e indipendente dei dati puliti, nuova per ogni richiesta.
    Se l'impronta non torna (dati alterati), i dati si ricaricano dal CSV."""
    if hashlib.sha256(stato["dati"]).hexdigest() != stato["impronta"]:
        logger.error("Dati in memoria alterati: ricaricati dal CSV")
        carica_dati_puliti()
    # I bytes li ha creati questo servizio: pickle.loads non riceve mai dati esterni
    return pickle.loads(stato["dati"])


def pulisci_grafici_vecchi() -> int:
    """Cancella i grafici più vecchi di DURATA_GRAFICI_ORE. Restituisce quanti ne ha cancellati."""
    limite = time.time() - DURATA_GRAFICI_ORE * 3600
    cancellati = 0
    for file in CARTELLA_GRAFICI.glob("*.png"):
        try:
            if file.stat().st_mtime < limite:
                file.unlink()
                cancellati += 1
        except OSError:
            pass  # file in uso o già cancellato: si riprova al prossimo avvio
    return cancellati


@asynccontextmanager
async def ciclo_di_vita(app: FastAPI):
    """All'avvio controlla la configurazione, carica e pulisce i dati una sola volta."""
    if not _CHIAVE_OPENAI:
        raise RuntimeError("Variabile OPENAI_API_KEY mancante nel file .env")
    for variabile in ("OPENAI_MODEL", "DATA_RIFERIMENTO", "NEGOZIO_UTENTE"):
        if not os.getenv(variabile):
            raise RuntimeError(f"Variabile {variabile} mancante nel file .env")
    if os.getenv("OPENAI_MODEL") == "nome-del-modello":
        raise RuntimeError("OPENAI_MODEL nel file .env contiene ancora il valore di esempio")

    carica_dati_puliti()
    stato["testo_prompt"] = PERCORSO_PROMPT.read_text(encoding="utf-8")
    cancellati = pulisci_grafici_vecchi()
    if cancellati:
        logger.info("Cancellati %d grafici più vecchi di %d ore", cancellati, DURATA_GRAFICI_ORE)
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
        # Si registra anche la spec scartata (solo dati del grafico, già passati dal filtro), troncata
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


def esegui_analisi(domanda: str, percorso_grafico: Path, callbacks: list | None = None) -> tuple[str, int]:
    """Fa analizzare la domanda al pandas agent su una copia nuova dei dati.

    Restituisce (testo della risposta, token usati). Il testo è già passato dal filtro
    sui dati riservati e non contiene più il blocco del grafico, che se valido è stato
    disegnato in percorso_grafico. Le eccezioni di OpenAI risalgono al chiamante.
    """
    contatore = UsageMetadataCallbackHandler()
    llm = ChatOpenAI(
        model=os.getenv("OPENAI_MODEL"),
        api_key=_CHIAVE_OPENAI,  # passata esplicitamente: non è in os.environ
        temperature=0,
        max_tokens=MAX_TOKEN_RISPOSTA,
        max_retries=0,  # nessun nuovo tentativo automatico in caso di errore
        timeout=TIMEOUT_CHIAMATA,
        callbacks=[contatore, *(callbacks or [])],
    )
    agente = create_pandas_dataframe_agent(
        llm,
        nuova_copia_dati(),  # copia profonda, nuova per ogni richiesta
        agent_type="tool-calling",
        prefix=costruisci_prompt(),
        number_of_head_rows=RIGHE_ANTEPRIMA,
        max_iterations=MAX_PASSI_PER_DOMANDA,
        max_execution_time=MAX_SECONDI_PER_DOMANDA,
        allow_dangerous_code=True,
    )
    risultato = agente.invoke({"input": domanda})
    token = sum(uso.get("total_tokens", 0) for uso in contatore.usage_metadata.values())

    # Filtro sulle risposte: si controlla il testo grezzo, blocco del grafico compreso
    testo = str(risultato["output"])
    if contiene_dati_riservati(testo):
        logger.warning("Risposta bloccata dal filtro: conteneva informazioni riservate")
        return MESSAGGIO_BLOCCATO, token

    return grafico_dalla_risposta(testo, percorso_grafico), token


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    """Controllo rapido che il servizio sia attivo."""
    return {"stato": "ok"}


@app.post("/analizza")
def analizza(richiesta: Domanda, request: Request):
    """Fa rispondere il pandas agent alla domanda e restituisce risposta, grafico, nota sulla pulizia e token."""
    domanda = richiesta.domanda.strip()
    if not domanda:
        raise HTTPException(status_code=400, detail="La domanda è vuota.")

    # Nome file unico per il grafico di questa richiesta (lo disegna il codice, non l'agente)
    nome_grafico = f"grafico_{uuid.uuid4().hex}.png"
    percorso_grafico = CARTELLA_GRAFICI / nome_grafico

    try:
        risposta, token = esegui_analisi(domanda, percorso_grafico)
    except Exception as errore:
        logger.error("Analisi non riuscita: %s", type(errore).__name__)
        raise HTTPException(status_code=500, detail=messaggio_errore(errore))

    # URL del grafico solo se il file è stato davvero creato
    url_grafico = f"{str(request.base_url).rstrip('/')}/charts/{nome_grafico}" if percorso_grafico.exists() else None

    return {
        "risposta": risposta,
        "grafico": url_grafico,
        "pulizia": stato["riepilogo_pulizia"],
        "token": token,
    }


@app.post("/briefing")
def briefing(request: Request):
    """Briefing del mattino: KPI di ieri, anomalie secondo le soglie del manuale e grafico degli scarti.
    Calcolato solo con pandas, senza chiamate a OpenAI."""
    nome_grafico = f"briefing_{uuid.uuid4().hex}.png"
    percorso_grafico = CARTELLA_GRAFICI / nome_grafico
    oggi = date.fromisoformat(os.getenv("DATA_RIFERIMENTO"))

    try:
        # Copia nuova dei dati puliti, come per /analizza
        risultato = prepara_briefing(nuova_copia_dati(), os.getenv("NEGOZIO_UTENTE"), oggi, percorso_grafico)
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
