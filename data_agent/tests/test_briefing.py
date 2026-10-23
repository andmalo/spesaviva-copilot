"""Test del briefing deterministico sulle tre date già verificate a mano."""

from datetime import date

import pandas as pd
import pytest

from briefing import controlla_miglioramenti, prepara_briefing


def tipi(anomalie):
    return [a["tipo"] for a in anomalie]


def test_1_settembre_2026_nessuna_anomalia(dati_puliti, tmp_path):
    grafico = tmp_path / "briefing.png"
    b = prepara_briefing(dati_puliti.copy(), "NEG01", date(2026, 9, 1), grafico)

    assert b["kpi"]["data"] == "2026-08-31"
    assert b["kpi"]["giorno_settimana"] == "lunedì"
    assert b["kpi"]["referenze_in_rottura"] == 54
    assert b["anomalie"] == []
    # Ortofrutta 7,02%: sopra soglia ieri, ma da 2 giorni (ne servono 3): non è un'anomalia
    orto = b["controlli"]["scarti"]["ortofrutta"]
    assert orto["valore"] == 7.02
    assert orto["giorni_sopra_soglia"] == 2
    assert orto["anomalia"] is False
    # Panetteria di ieri dopo il miglioramento piantato (scarti × 0,82 da luglio 2026)
    assert b["controlli"]["scarti"]["panetteria"]["valore"] == 4.53
    # 54 referenze esaurite il lunedì: sotto il limite di 60
    assert b["controlli"]["rotture"]["anomalia"] is False
    assert grafico.exists()


def test_17_luglio_2025_ondata_di_caldo(dati_puliti):
    b = prepara_briefing(dati_puliti.copy(), "NEG01", date(2025, 7, 17))

    assert tipi(b["anomalie"]) == ["scarti_sopra_soglia"]
    anomalia = b["anomalie"][0]
    assert anomalia["reparto"] == "ortofrutta"
    assert anomalia["periodo"] == "dal 12 luglio 2025 al 16 luglio 2025"
    assert b["controlli"]["scarti"]["ortofrutta"]["giorni_sopra_soglia"] == 5


def test_10_marzo_2026_ritardi_neg03(dati_puliti):
    b = prepara_briefing(dati_puliti.copy(), "NEG03", date(2026, 3, 10))

    # Ieri era lunedì: si controllano la settimana in corso e quella completa precedente
    assert tipi(b["anomalie"]) == ["consegne_in_ritardo", "consegne_in_ritardo"]
    totali = [c["valore"] for c in b["controlli"]["consegne"]]
    assert totali == [3, 7]
    # 91 referenze in rottura ieri, ma il giorno prima erano 59: un solo giorno, non è un'anomalia
    assert b["controlli"]["rotture"]["valore"] == 91
    assert b["controlli"]["rotture"]["giorni_sopra_limite"] == 1
    assert b["controlli"]["rotture"]["anomalia"] is False


def test_ogni_anomalia_ha_i_campi_richiesti(dati_puliti):
    b = prepara_briefing(dati_puliti.copy(), "NEG03", date(2026, 3, 10))
    for a in b["anomalie"]:
        for campo in ("tipo", "valore", "soglia", "periodo", "testo", "domanda_procedura"):
            assert a[campo], f"campo {campo} vuoto"


# ---------------------------------------------------------------------------
# Riconoscimenti di squadra (miglioramenti duraturi del tasso di scarto)
# ---------------------------------------------------------------------------

def test_riconoscimento_neg01_panetteria_agosto_2026(dati_puliti):
    b = prepara_briefing(dati_puliti.copy(), "NEG01", date(2026, 9, 1))

    assert len(b["riconoscimenti"]) == 1
    r = b["riconoscimenti"][0]
    assert r["reparto"] == "panetteria"
    assert r["mesi"] == ["luglio 2026", "agosto 2026"]
    assert r["tassi"] == [4.77, 4.9]
    # Riferimento: gli stessi mesi dell'anno prima (confronto destagionalizzato)
    assert r["riferimenti"] == [5.92, 6.18]
    assert r["periodo_riferimento"] == "luglio 2025 e agosto 2025"
    assert r["riferimento"] == 6.05
    assert r["variazioni_pct"] == [-19.3, -20.7]
    assert r["variazione_pct"] == -20.1
    assert r["euro_risparmiati"] == pytest.approx(1096.93, abs=0.01)
    assert "ad agosto 2026" in r["testo"]
    # I riconoscimenti non sono anomalie
    assert b["anomalie"] == []


@pytest.mark.parametrize("ultimo_mese", ["2025-07", "2025-08"])
def test_nessun_riconoscimento_dopo_ondata_di_caldo(dati_puliti, ultimo_mese):
    # Luglio 2025 ha scarti di ortofrutta alti ovunque: nessun negozio deve ricevere riconoscimenti
    # (in questi mesi manca ancora un anno di storico, quindi il controllo non si applica)
    for negozio in sorted(dati_puliti["negozio"].unique()):
        assert controlla_miglioramenti(dati_puliti, negozio, pd.Period(ultimo_mese, freq="M")) == []


@pytest.mark.parametrize("ultimo_mese", ["2026-07", "2026-08"])
def test_ondata_di_caldo_non_crea_falsi_riconoscimenti_un_anno_dopo(dati_puliti, ultimo_mese):
    # Luglio 2026 si confronta con luglio 2025, gonfiato dall'ondata di caldo: l'ortofrutta di luglio
    # sembra migliorata di circa il 20%, ma serve anche il mese prima, e non deve scattare per nessuno
    for negozio in sorted(dati_puliti["negozio"].unique()):
        reparti = [r["reparto"] for r in controlla_miglioramenti(dati_puliti, negozio, pd.Period(ultimo_mese, freq="M"))]
        assert "ortofrutta" not in reparti


def test_un_solo_riconoscimento_in_tutto_il_dataset(dati_puliti):
    # Verifica dei falsi riconoscimenti: tutti i negozi, reparti e mesi esaminabili
    mesi = pd.period_range("2025-10", "2026-08", freq="M")
    trovati = [(n, str(m), r["reparto"]) for n in sorted(dati_puliti["negozio"].unique())
               for m in mesi for r in controlla_miglioramenti(dati_puliti, n, m)]
    assert trovati == [("NEG01", "2026-08", "panetteria")]


def test_nessun_riconoscimento_senza_dati_sufficienti(dati_puliti):
    # Agosto e settembre 2025 non hanno gli stessi mesi dell'anno prima (i dati partono da settembre 2024)
    assert controlla_miglioramenti(dati_puliti, "NEG01", pd.Period("2025-09", freq="M")) == []


# ---------------------------------------------------------------------------
# controlla_soglie: le regole del briefing su un periodo qualsiasi
# ---------------------------------------------------------------------------

# testo_soglie si importa con un altro nome: pytest raccoglierebbe come test
# qualsiasi funzione il cui nome inizia con "test"
from briefing import controlla_soglie  # noqa: E402
from briefing import testo_soglie as descrivi_soglie  # noqa: E402


def test_soglie_agosto_2026_trova_la_settimana_con_3_ritardi(dati_puliti):
    esito = controlla_soglie(dati_puliti, "NEG01", date(2026, 8, 1), date(2026, 8, 31))
    raggiunte = [(w["lunedi"], w["consegne_in_ritardo"]) for w in esito["settimane"] if w["consegne_in_ritardo"] >= 3]
    assert raggiunte == [(date(2026, 8, 10), 3)]
    # la settimana del 31 agosto (solo lunedì nei dati) è segnata come non completa
    assert esito["settimane"][-1]["completa"] is False
    assert "SOGLIA RAGGIUNTA" in descrivi_soglie(esito)


def test_soglie_ondata_di_caldo_luglio_2025(dati_puliti):
    esito = controlla_soglie(dati_puliti, "NEG01", date(2025, 7, 7), date(2025, 7, 20))
    lunghi = [(e["dal"], e["giorni"]) for e in esito["scarti"]["ortofrutta"] if e["giorni"] >= 3]
    assert (date(2025, 7, 12), 5) in lunghi
    assert esito["scarti_oltre_doppio"]["ortofrutta"]  # almeno un giorno oltre il 10%


def test_soglie_fornitore_in_crisi_neg03(dati_puliti):
    esito = controlla_soglie(dati_puliti, "NEG03", date(2026, 3, 1), date(2026, 3, 15))
    episodi = [(e["dal"], e["al"]) for e in esito["rotture"]]
    assert (date(2026, 3, 4), date(2026, 3, 5)) in episodi
    assert (date(2026, 3, 9), date(2026, 3, 11)) in episodi
    assert all(w["consegne_in_ritardo"] >= 3 for w in esito["settimane"])


def test_briefing_usa_controlla_soglie_senza_cambiare_risultati(dati_puliti):
    # Il briefing del 10 marzo 2026 (NEG03) resta quello verificato a mano
    b = prepara_briefing(dati_puliti.copy(), "NEG03", date(2026, 3, 10))
    assert [(a["tipo"], a["periodo"]) for a in b["anomalie"]] == [
        ("consegne_in_ritardo", "settimana in corso, 9 marzo 2026"),
        ("consegne_in_ritardo", "settimana precedente, dal 2 marzo 2026 all'8 marzo 2026"),
    ]
