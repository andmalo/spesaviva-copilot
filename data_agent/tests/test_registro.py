"""Log strutturato del data agent: formato, requestId, filtro dei segreti, troncamento della domanda."""

import json
import logging

import pytest
from fastapi.testclient import TestClient

import app
import registro

ID = "11111111-2222-3333-4444-555555555555"


def riga(formato: logging.Formatter, messaggio: str, livello=logging.INFO, **campi) -> str:
    record = logging.getLogger("data_agent").makeRecord("data_agent", livello, __file__, 1, messaggio, (), None,
                                                         extra=campi)
    return formato.format(record)


def test_formato_json_con_request_id():
    gettone = registro.ID_RICHIESTA.set(ID)
    try:
        dati = json.loads(riga(registro.FormatoJson(), "richiesta completata", rotta="/soglie", durata_ms=12))
    finally:
        registro.ID_RICHIESTA.reset(gettone)
    assert dati["level"] == "info"
    assert dati["servizio"] == "data-agent"
    assert dati["requestId"] == ID
    assert dati["rotta"] == "/soglie" and dati["durata_ms"] == 12


def test_formato_leggibile():
    testo = riga(registro.FormatoLeggibile(), "richiesta completata", livello=logging.WARNING, esito="ok", strumenti=["a", "b"])
    assert "WARN  richiesta completata" in testo
    assert "esito=ok" in testo and "strumenti=a,b" in testo


def test_filtro_dei_segreti_nei_log(monkeypatch):
    monkeypatch.setattr(registro, "_valori_riservati", ["password-segretissima"])
    testo = riga(registro.FormatoJson(), "chiave sk-proj-abc123 e password-segretissima", nota="sk-xyz")
    assert "sk-proj" not in testo and "sk-xyz" not in testo and "password-segretissima" not in testo
    assert testo.count("[riservato]") == 3
    # "sk-" in mezzo a una parola non è una chiave
    assert "task-list" in registro.oscura("task-list")


def test_i_valori_riservati_del_data_agent_sono_filtrati():
    # app.py passa al registro gli stessi valori del filtro sulle risposte
    assert registro._valori_riservati == app.VALORI_RISERVATI


def test_domanda_al_massimo_200_battute():
    assert registro.taglia("a" * 500) == "a" * 200 + "…"
    assert registro.taglia("breve") == "breve"
    assert registro.taglia(None) is None


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setitem(app.stato, "scenari", json.loads(app.PERCORSO_SCENARI.read_text(encoding="utf-8")))
    return TestClient(app.app)


def test_request_id_dal_back_end_nella_riga_di_fine_richiesta(client, caplog):
    with caplog.at_level(logging.INFO, logger="data_agent"):
        assert client.get("/scenari/caldo/date", headers={"X-Request-Id": ID}).status_code == 200
    righe = [r for r in caplog.records if r.getMessage() == "richiesta completata"]
    assert len(righe) == 1
    r = righe[0]
    assert r.requestId == ID
    assert (r.rotta, r.esito, r.stato, r.scenario) == ("/scenari/caldo/date", "ok", 200, "caldo")
    assert isinstance(r.durata_ms, int)


def test_request_id_non_valido_sostituito(client, caplog):
    with caplog.at_level(logging.INFO, logger="data_agent"):
        client.get("/scenari/inventato/date", headers={"X-Request-Id": "<script>alert(1)</script>"})
    r = [r for r in caplog.records if r.getMessage() == "richiesta completata"][0]
    assert registro.FORMATO_ID.match(r.requestId)
    assert (r.esito, r.stato) == ("errore", 400)


def test_livello_e_formato_dal_env(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "warn")
    assert registro.livello_da_env() == logging.WARNING
    monkeypatch.setenv("LOG_LEVEL", "sconosciuto")
    assert registro.livello_da_env() == logging.INFO
    monkeypatch.delenv("LOG_FORMAT", raising=False)
    monkeypatch.delenv("MODALITA", raising=False)
    assert registro.formato_da_env() == "leggibile"
    monkeypatch.setenv("MODALITA", "produzione")
    assert registro.formato_da_env() == "json"
    monkeypatch.setenv("LOG_FORMAT", "leggibile")
    assert registro.formato_da_env() == "leggibile"


def test_nessuna_print_nel_data_agent():
    for file in app.CARTELLA_AGENTE.glob("*.py"):
        assert "print(" not in file.read_text(encoding="utf-8"), file.name
