"""Pulizia periodica dei grafici PNG più vecchi di 24 ore.

Un giro all'avvio del data agent e poi uno ogni PULIZIA_GRAFICI_MINUTI (predefinito 60), con un
task asyncio avviato e fermato nel ciclo di vita di FastAPI (vedi app.py).
Un errore di cancellazione (per esempio un file in uso su Windows) va nel log con il nome del file
e il motivo, senza fermare né il giro né il servizio; a fine giro una riga con i conteggi.
"""

import asyncio
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger("data_agent")

DURATA_GRAFICI_ORE = 24
INTERVALLO_PREDEFINITO_MINUTI = 60


def intervallo_da_env() -> int:
    """Minuti tra due giri (PULIZIA_GRAFICI_MINUTI, intero positivo; altrimenti 60)."""
    try:
        minuti = int(os.getenv("PULIZIA_GRAFICI_MINUTI", ""))
    except ValueError:
        return INTERVALLO_PREDEFINITO_MINUTI
    return minuti if minuti > 0 else INTERVALLO_PREDEFINITO_MINUTI


def pulisci_grafici_vecchi(cartella: Path, durata_ore: float = DURATA_GRAFICI_ORE,
                           adesso: float | None = None) -> dict:
    """Cancella i PNG di cartella modificati più di durata_ore fa.
    Restituisce i conteggi del giro: {"controllati", "cancellati", "errori"}."""
    limite = (adesso if adesso is not None else time.time()) - durata_ore * 3600
    esito = {"controllati": 0, "cancellati": 0, "errori": 0}
    for file in cartella.glob("*.png"):
        esito["controllati"] += 1
        try:
            if file.stat().st_mtime < limite:
                file.unlink()
                esito["cancellati"] += 1
        except FileNotFoundError:
            pass  # già cancellato nel frattempo (per esempio da un altro giro): niente da fare
        except OSError as errore:
            # Per esempio un file in uso su Windows: si riprova al giro successivo
            esito["errori"] += 1
            logger.warning("grafico non cancellato", extra={
                "file": file.name, "motivo": f"{type(errore).__name__}: {errore.strerror or errore}"})
    logger.info("pulizia dei grafici completata", extra={**esito, "durata_ore": durata_ore})
    return esito


async def ciclo_pulizia(cartella: Path, intervallo_secondi: float, durata_ore: float = DURATA_GRAFICI_ORE) -> None:
    """Un giro subito e poi uno ogni intervallo_secondi, finché il task non viene annullato.
    La cancellazione dei file gira in un thread, per non bloccare le richieste."""
    while True:
        try:
            await asyncio.to_thread(pulisci_grafici_vecchi, cartella, durata_ore)
        except asyncio.CancelledError:
            raise
        except Exception as errore:  # un errore imprevisto non deve fermare i giri successivi
            logger.error("pulizia dei grafici non riuscita", extra={"errore": type(errore).__name__})
        await asyncio.sleep(intervallo_secondi)


def avvia_pulizia(cartella: Path, intervallo_minuti: int) -> asyncio.Task:
    """Avvia il ciclo di pulizia come task in background (nel ciclo di vita di FastAPI)."""
    logger.info("pulizia periodica dei grafici avviata", extra={"intervallo_minuti": intervallo_minuti})
    return asyncio.create_task(ciclo_pulizia(cartella, intervallo_minuti * 60), name="pulizia_grafici")


async def ferma_pulizia(task: asyncio.Task) -> None:
    """Ferma il task alla chiusura del servizio e aspetta che sia davvero finito."""
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    logger.info("pulizia periodica dei grafici fermata")
