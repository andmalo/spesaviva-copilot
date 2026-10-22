"""Test della pulizia dei dati: conteggi del report e anomalie di business conservate."""

import pytest

from pulizia import riepilogo_pulizia


def tasso_scarto(df, reparto):
    """Tasso di scarto di un reparto in %, sul totale del periodo."""
    return df[f"scarti_{reparto}"].sum() / df[f"vendite_{reparto}"].sum() * 100


# ---------------------------------------------------------------------------
# Conteggi del report (le anomalie "sporche" piantate nel dataset)
# ---------------------------------------------------------------------------

def test_conteggi_del_report(pulizia):
    _, report = pulizia
    attesi = {
        "date_corrette": 129,
        "date_non_convertibili": 0,
        "negozi_uniformati": 132,
        "duplicati_rimossi": 43,
        "vendite_negative_corrette": 5,
        "vendite_negative_scartate": 0,
        "vendite_x10_corrette": 5,
        "vendite_x10_scartate": 0,
        "assenze_scartate": 5,
        "scontrini_stimati": 43,
        "scontrini_non_stimabili": 0,
        "righe_scarti_stimati": 127,
    }
    for chiave, valore in attesi.items():
        assert report[chiave] == valore, f"{chiave}: atteso {valore}, trovato {report[chiave]}"


def test_righe_dopo_la_pulizia(dati_grezzi, dati_puliti):
    # Si tolgono solo i 43 duplicati
    assert len(dati_grezzi) == 4375
    assert len(dati_puliti) == 4332


def test_dati_puliti_coerenti(dati_puliti):
    assert dati_puliti["data"].isna().sum() == 0
    assert sorted(dati_puliti["negozio"].unique()) == ["NEG01", "NEG02", "NEG03", "NEG04", "NEG05", "NEG06"]
    assert not dati_puliti.duplicated(["data", "negozio"]).any()
    assert (dati_puliti["vendite_totali"] > 0).all()
    # Le ore di assenza impossibili sono state scartate (NaN): le altre non superano le pianificate
    assenze = dati_puliti["ore_assenza"]
    assert assenze.isna().sum() == 5
    validi = assenze.notna()
    assert (assenze[validi] <= dati_puliti.loc[validi, "ore_pianificate"]).all()


def test_riepilogo_in_italiano(pulizia):
    testo = riepilogo_pulizia(pulizia[1])
    assert testo.startswith("Pulizia dati:")
    assert "rimossi 43 duplicati" in testo


# ---------------------------------------------------------------------------
# Anomalie di business: sono fatti veri, la pulizia NON deve cancellarle
# ---------------------------------------------------------------------------

def test_neg05_butta_il_doppio_del_pane(dati_puliti):
    tassi = {n: tasso_scarto(g, "panetteria") for n, g in dati_puliti.groupby("negozio")}
    altri = [v for n, v in tassi.items() if n != "NEG05"]
    assert tassi["NEG05"] > 1.8 * max(altri)


def test_ondata_di_caldo_luglio_2025(dati_puliti):
    caldo = dati_puliti[dati_puliti["data"].between("2025-07-07", "2025-07-20")]
    giugno = dati_puliti[dati_puliti["data"].between("2025-06-01", "2025-06-30")]
    assert tasso_scarto(caldo, "ortofrutta") > 1.3 * tasso_scarto(giugno, "ortofrutta")


@pytest.mark.parametrize("negozio", ["NEG03", "NEG04"])
def test_fornitore_in_crisi_marzo_2026(dati_puliti, negozio):
    d = dati_puliti[dati_puliti["negozio"] == negozio]
    marzo = d[d["data"].between("2026-03-01", "2026-03-31")]["consegne_in_ritardo"].sum()
    febbraio = d[d["data"].between("2026-02-01", "2026-02-28")]["consegne_in_ritardo"].sum()
    assert marzo > 5 * febbraio


def test_settimana_influenzale_neg02(dati_puliti):
    s = dati_puliti[(dati_puliti["negozio"] == "NEG02") & dati_puliti["data"].between("2026-01-12", "2026-01-18")]
    tasso_assenze = s["ore_assenza"].sum() / s["ore_pianificate"].sum() * 100
    assert tasso_assenze == pytest.approx(15.0, abs=0.5)
