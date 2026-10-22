"""Test del briefing deterministico sulle tre date già verificate a mano."""

from datetime import date

from briefing import prepara_briefing


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
