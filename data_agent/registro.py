"""Log strutturato del data agent (modulo logging), con l'identificativo della richiesta in ogni riga.

LOG_LEVEL: debug, info, warn, error (predefinito info).
LOG_FORMAT: json oppure leggibile (predefinito: json in produzione, leggibile in locale).

L'identificativo arriva dal back end nell'intestazione X-Request-Id (vedi il middleware in app.py),
così una richiesta si segue in entrambi i servizi. Ogni riga passa dal filtro dei segreti
(lo stesso delle risposte: "sk-" e i valori riservati del .env) prima di essere scritta.
Regole: mai la chiave API, mai il testo completo delle risposte o il codice generato;
al livello debug al massimo le prime 200 battute della domanda (vedi taglia()).
"""

import contextvars
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone

# Identificativo della richiesta in corso (None fuori da una richiesta, per esempio all'avvio)
ID_RICHIESTA: contextvars.ContextVar[str | None] = contextvars.ContextVar("id_richiesta", default=None)

# Dettagli della richiesta in corso (scenario, token...) per la riga di log di fine richiesta:
# un dizionario creato dal middleware e completato dagli endpoint con annota()
DETTAGLI_RICHIESTA: contextvars.ContextVar[dict | None] = contextvars.ContextVar("dettagli_richiesta", default=None)

# Identificativi accettati dall'intestazione X-Request-Id: solo UUID (niente testo libero nei log)
FORMATO_ID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def annota(**campi) -> None:
    """Aggiunge campi alla riga di log di fine richiesta (se c'è una richiesta in corso)."""
    dettagli = DETTAGLI_RICHIESTA.get()
    if dettagli is not None:
        dettagli.update(campi)


LIVELLI = {"debug": logging.DEBUG, "info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}
NOMI_LIVELLI = {logging.DEBUG: "debug", logging.INFO: "info", logging.WARNING: "warn",
                logging.ERROR: "error", logging.CRITICAL: "error"}
MAX_CARATTERI_DOMANDA = 200
SEGNAPOSTO = "[riservato]"

# Valori riservati del .env (li imposta app.py, che li conosce): si tolgono da ogni riga
_valori_riservati: list[str] = []

# Attributi standard di un LogRecord: tutto il resto è un campo in più (extra=...)
_ATTRIBUTI_STANDARD = (set(vars(logging.LogRecord("", 0, "", 0, "", None, None)))
                       | {"message", "asctime", "requestId", "color_message"})  # color_message: uvicorn


def imposta_valori_riservati(valori) -> None:
    """Valori da togliere dai log (gli stessi del filtro sulle risposte), dal più lungo al più corto."""
    _valori_riservati[:] = sorted({v for v in valori if v}, key=len, reverse=True)


def oscura(testo: str) -> str:
    """Toglie dal testo le chiavi "sk-..." e i valori riservati."""
    pulito = re.sub(r"\bsk-[^\s\"'\\,;]*", SEGNAPOSTO, testo)
    for valore in _valori_riservati:
        pulito = pulito.replace(valore, SEGNAPOSTO)
    return pulito


def taglia(testo: str | None) -> str | None:
    """Le prime 200 battute di un testo (solo per il livello debug)."""
    if testo is None or len(testo) <= MAX_CARATTERI_DOMANDA:
        return testo
    return testo[:MAX_CARATTERI_DOMANDA] + "…"


def _dati_riga(record: logging.LogRecord) -> dict:
    """Contenuto di una riga: ora, livello, servizio, messaggio, requestId e campi in più."""
    dati = {
        "time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
        "level": NOMI_LIVELLI.get(record.levelno, "info"),
        "servizio": "data-agent",
        "logger": record.name,
        "msg": record.getMessage(),
    }
    if getattr(record, "requestId", None):
        dati["requestId"] = record.requestId
    for chiave, valore in vars(record).items():
        if chiave not in _ATTRIBUTI_STANDARD and not chiave.startswith("_"):
            dati[chiave] = valore
    if record.exc_info:
        # Solo il tipo di errore e la traccia (passata dal filtro dei segreti), mai variabili locali
        dati["errore"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        dati["traccia"] = logging.Formatter().formatException(record.exc_info)
    return dati


class FormatoJson(logging.Formatter):
    """Una riga JSON per evento."""

    def format(self, record: logging.LogRecord) -> str:
        return oscura(json.dumps(_dati_riga(record), ensure_ascii=False, default=str))


class FormatoLeggibile(logging.Formatter):
    """"10:15:02 INFO  richiesta completata requestId=... rotta=/analizza durata_ms=812"."""

    FISSI = {"time", "level", "servizio", "logger", "msg", "traccia"}

    @staticmethod
    def _valore(valore) -> str:
        if isinstance(valore, (list, tuple)):
            return ",".join(map(str, valore)) or "-"
        if isinstance(valore, dict):
            return json.dumps(valore, ensure_ascii=False, default=str)
        testo = str(valore)
        return json.dumps(testo, ensure_ascii=False) if re.search(r"\s", testo) else testo

    def format(self, record: logging.LogRecord) -> str:
        dati = _dati_riga(record)
        campi = " ".join(f"{k}={self._valore(v)}" for k, v in dati.items() if k not in self.FISSI)
        riga = f"{dati['time'][11:19]} {dati['level'].upper():<5} {dati['msg']}" + (f" {campi}" if campi else "")
        if "traccia" in dati:
            riga += "\n" + dati["traccia"]
        return oscura(riga)


def _fabbrica_con_id(fabbrica_originale):
    """Ogni LogRecord riceve il requestId della richiesta in corso (anche quelli delle librerie)."""
    def fabbrica(*args, **kwargs):
        record = fabbrica_originale(*args, **kwargs)
        record.requestId = ID_RICHIESTA.get()
        return record
    fabbrica.con_id_richiesta = True
    return fabbrica


def livello_da_env() -> int:
    return LIVELLI.get(os.getenv("LOG_LEVEL", "").strip().lower(), logging.INFO)


def formato_da_env() -> str:
    valore = os.getenv("LOG_FORMAT", "").strip().lower()
    if valore in ("json", "leggibile"):
        return valore
    return "json" if os.getenv("MODALITA") == "produzione" else "leggibile"


def configura_log() -> None:
    """Un solo gestore sullo standard output per tutti i log (anche uvicorn), livello e formato dal .env."""
    if not getattr(logging.getLogRecordFactory(), "con_id_richiesta", False):
        logging.setLogRecordFactory(_fabbrica_con_id(logging.getLogRecordFactory()))

    gestore = logging.StreamHandler(sys.stdout)
    gestore.setFormatter(FormatoJson() if formato_da_env() == "json" else FormatoLeggibile())
    radice = logging.getLogger()
    for vecchio in list(radice.handlers):
        if getattr(vecchio, "del_data_agent", False):
            radice.removeHandler(vecchio)
    gestore.del_data_agent = True
    radice.addHandler(gestore)
    radice.setLevel(livello_da_env())

    # uvicorn scrive attraverso la radice; il suo log di accesso è sostituito dalla riga
    # di fine richiesta del middleware (con il requestId)
    for nome in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(nome).handlers.clear()
        logging.getLogger(nome).propagate = True
    # Librerie troppo verbose (una riga per ogni chiamata HTTP): solo avvisi ed errori
    for nome in ("httpx", "httpx2", "httpcore", "openai", "urllib3", "matplotlib", "langchain", "langchain_core", "asyncio"):
        logging.getLogger(nome).setLevel(logging.WARNING)
