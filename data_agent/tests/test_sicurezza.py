"""Test delle correzioni di sicurezza del data agent (nessuna chiamata a OpenAI).

Nessun test stampa la chiave: i confronti producono solo vero/falso.
"""

import os
import pickle

import pytest
from langchain_experimental.tools.python.tool import PythonAstREPLTool

import app


@pytest.fixture(scope="module", autouse=True)
def dati_caricati():
    """Carica i dati puliti come all'avvio del servizio."""
    app.carica_dati_puliti()
    yield
    app.stato.clear()


def test_chiave_non_in_os_environ():
    assert "OPENAI_API_KEY" not in os.environ


def test_codice_agente_non_vede_la_chiave():
    # Lo stesso strumento usato dal pandas agent, eseguito nel processo del data agent
    strumento = PythonAstREPLTool(locals={"df": app.nuova_copia_dati()})
    esito = strumento.run("'OPENAI_API_KEY' in __import__('os').environ")
    # Lo strumento restituisce il valore dell'ultima espressione (qui un booleano)
    assert str(esito).strip() == "False"


def test_filtro_blocca_sk():
    # Chiave finta costruita al momento: così le scansioni dei segreti nel repository non la segnalano
    chiave_finta = "sk-" + "a" * 24
    assert app.contiene_dati_riservati("ecco la chiave: " + chiave_finta) is True


def test_filtro_blocca_il_valore_della_chiave():
    if not app._CHIAVE_OPENAI:
        pytest.skip("nessuna chiave nel .env")
    # Il risultato si calcola prima: se l'asserzione fallisse, pytest mostrerebbe
    # l'argomento della chiamata, cioè la chiave
    bloccato = app.contiene_dati_riservati("testo " + app._CHIAVE_OPENAI + " testo")
    assert bloccato is True


def test_filtro_blocca_altri_valori_riservati(monkeypatch):
    # Un valore riservato del .env senza "sk-" (es. una password) viene riconosciuto lo stesso
    monkeypatch.setattr(app, "VALORI_RISERVATI", ["password-di-prova-123"])
    assert app.contiene_dati_riservati("la password è password-di-prova-123") is True


def test_filtro_lascia_passare_le_risposte_normali():
    risposta = ("Nel mese di agosto 2026 il negozio NEG01 ha venduto 899.860,46 €, "
                "il 2,94% sotto il budget. Modello gpt-4.1-mini, dati al 2026-09-01.")
    assert app.contiene_dati_riservati(risposta) is False


def test_modifica_di_una_copia_non_si_vede_nella_successiva():
    prima = app.nuova_copia_dati()
    totale = prima["vendite_totali"].sum()
    prima.loc[:, "vendite_totali"] = 0  # come farebbe il codice dell'agente
    dopo = app.nuova_copia_dati()
    assert dopo["vendite_totali"].sum() == pytest.approx(totale)


def test_dati_condivisi_alterati_vengono_ricaricati():
    # L'attacco visto nella revisione: arrivare allo stato condiviso e sostituire i dati
    originale = app.nuova_copia_dati()
    alterato = originale.copy()
    alterato.loc[:, "vendite_totali"] = 0
    app.stato["dati"] = pickle.dumps(alterato)

    ricaricato = app.nuova_copia_dati()
    assert ricaricato["vendite_totali"].sum() == pytest.approx(originale["vendite_totali"].sum())
