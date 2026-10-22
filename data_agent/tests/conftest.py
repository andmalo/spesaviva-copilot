"""Configurazione comune dei test del data agent (nessuna chiamata a OpenAI).

Uso (dalla cartella principale del progetto, con il .venv attivo):
    python -m pytest data_agent/tests
"""

import sys
from pathlib import Path

import pandas as pd
import pytest

CARTELLA_AGENTE = Path(__file__).resolve().parent.parent
PERCORSO_CSV = CARTELLA_AGENTE.parent / "data" / "dati_negozi.csv"

# I moduli del data agent (pulizia, briefing, grafici, app) si importano dalla sua cartella
sys.path.insert(0, str(CARTELLA_AGENTE))

from pulizia import pulisci_dati  # noqa: E402


@pytest.fixture(scope="session")
def dati_grezzi() -> pd.DataFrame:
    """Il CSV originale, letto una sola volta per tutti i test."""
    return pd.read_csv(PERCORSO_CSV)


@pytest.fixture(scope="session")
def pulizia(dati_grezzi):
    """Dati puliti e report della pulizia, calcolati una sola volta."""
    return pulisci_dati(dati_grezzi.copy())


@pytest.fixture(scope="session")
def dati_puliti(pulizia) -> pd.DataFrame:
    return pulizia[0]
