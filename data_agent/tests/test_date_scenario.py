"""Date di riferimento dei tre scenari della demo, contro valori scritti a mano.

Regola: ieri = oggi - 1; "questa settimana" = gli ultimi 7 giorni fino a ieri compreso;
mese corrente = mese di ieri (completo se ieri è l'ultimo giorno del mese);
ultima settimana completa = ultima lunedì-domenica che finisce entro ieri.
"""

import json

import pytest
from fastapi.testclient import TestClient

import app
from date_scenario import date_riferimento

ATTESE = {
    # oggi martedì 1/9/2026: ieri lunedì 31/8, ultimo giorno del mese
    "tranquilla": {
        "oggi": "2026-09-01",
        "ieri": "2026-08-31",
        "inizio_settimana": "2026-08-25",
        "mese_corrente": "agosto 2026, l'ultimo mese completo nei dati",
        "ultima_settimana_completa": {"inizio": "2026-08-24", "fine": "2026-08-30"},
        "oggi_esteso": "martedì 1 settembre 2026",
        "ieri_esteso": "lunedì 31 agosto 2026",
        "inizio_settimana_esteso": "martedì 25 agosto 2026",
    },
    # oggi giovedì 17/7/2025: ieri mercoledì 16/7, mese in corso
    "caldo": {
        "oggi": "2025-07-17",
        "ieri": "2025-07-16",
        "inizio_settimana": "2025-07-10",
        "mese_corrente": "luglio 2025, il mese in corso (dati dal 1 al 16 luglio 2025)",
        "ultima_settimana_completa": {"inizio": "2025-07-07", "fine": "2025-07-13"},
        "oggi_esteso": "giovedì 17 luglio 2025",
        "ieri_esteso": "mercoledì 16 luglio 2025",
        "inizio_settimana_esteso": "giovedì 10 luglio 2025",
    },
    # oggi martedì 10/3/2026: ieri lunedì 9/3, mese in corso
    "fornitore": {
        "oggi": "2026-03-10",
        "ieri": "2026-03-09",
        "inizio_settimana": "2026-03-03",
        "mese_corrente": "marzo 2026, il mese in corso (dati dal 1 al 9 marzo 2026)",
        "ultima_settimana_completa": {"inizio": "2026-03-02", "fine": "2026-03-08"},
        "oggi_esteso": "martedì 10 marzo 2026",
        "ieri_esteso": "lunedì 9 marzo 2026",
        "inizio_settimana_esteso": "martedì 3 marzo 2026",
    },
}


@pytest.fixture(scope="module")
def scenari():
    return json.loads(app.PERCORSO_SCENARI.read_text(encoding="utf-8"))


@pytest.fixture
def client(scenari, monkeypatch):
    # Senza il ciclo di vita (che caricherebbe i dati): basta l'elenco degli scenari
    monkeypatch.setitem(app.stato, "scenari", scenari)
    return TestClient(app.app)


def test_ci_sono_tutti_e_tre_gli_scenari(scenari):
    assert sorted(s["id"] for s in scenari) == sorted(ATTESE)


@pytest.mark.parametrize("id_scenario", ATTESE)
def test_date_riferimento(scenari, id_scenario):
    scenario = next(s for s in scenari if s["id"] == id_scenario)
    assert date_riferimento(scenario) == ATTESE[id_scenario]


@pytest.mark.parametrize("id_scenario", ATTESE)
def test_endpoint_date(client, id_scenario):
    risposta = client.get(f"/scenari/{id_scenario}/date")
    assert risposta.status_code == 200
    assert risposta.json() == {"scenario": id_scenario, **ATTESE[id_scenario]}


def test_endpoint_scenario_non_valido(client):
    risposta = client.get("/scenari/inventato/date")
    assert risposta.status_code == 400
    assert risposta.json()["detail"] == "Scenario della demo non valido."


def test_versione_per_la_cache_del_back_end(client, monkeypatch):
    monkeypatch.setitem(app.stato, "impronta", "a" * 64)
    monkeypatch.setitem(app.stato, "testo_prompt", "prompt di prova")
    dati = client.get("/versione").json()
    assert dati["impronta_dati"] == "a" * 64
    assert dati["modello"] == app.modello_data_agent()
    assert len(dati["prompt"]) == 64
    # Un prompt diverso cambia la versione (e quindi la chiave della cache)
    monkeypatch.setitem(app.stato, "testo_prompt", "prompt cambiato")
    assert client.get("/versione").json()["prompt"] != dati["prompt"]
