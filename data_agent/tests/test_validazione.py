"""Test della validazione del dataset: lo sporco previsto passa, i dati impossibili no."""

import pandas as pd
import pytest

from conftest import PERCORSO_CSV
from validazione import DatasetNonValido, carica_e_valida


def scrivi_csv(cartella, df, nome="dati.csv"):
    percorso = cartella / nome
    df.to_csv(percorso, index=False)
    return percorso


@pytest.fixture
def grezzo():
    """Una copia del CSV originale, da modificare nel singolo test."""
    return pd.read_csv(PERCORSO_CSV)


def test_csv_attuale_accettato():
    df, report = carica_e_valida(PERCORSO_CSV)
    assert len(df) == 4332
    assert report["duplicati_rimossi"] == 43


def test_colonna_mancante_rifiutata(tmp_path, grezzo):
    percorso = scrivi_csv(tmp_path, grezzo.drop(columns=["ore_assenza"]))
    with pytest.raises(DatasetNonValido, match="mancano 1 colonne attese \\(ore_assenza\\)"):
        carica_e_valida(percorso)


def test_colonna_in_piu_accettata(tmp_path, grezzo):
    grezzo["note"] = "prova"
    df, _ = carica_e_valida(scrivi_csv(tmp_path, grezzo))
    assert len(df) == 4332


def test_file_vuoto_rifiutato(tmp_path):
    vuoto = tmp_path / "vuoto.csv"
    vuoto.write_text("", encoding="utf-8")
    with pytest.raises(DatasetNonValido, match="file è vuoto"):
        carica_e_valida(vuoto)


def test_solo_intestazione_rifiutato(tmp_path, grezzo):
    with pytest.raises(DatasetNonValido, match="non contiene righe"):
        carica_e_valida(scrivi_csv(tmp_path, grezzo.iloc[0:0]))


def test_data_del_1990_rifiutata(tmp_path, grezzo):
    grezzo.loc[0, "data"] = "1990-05-12"
    with pytest.raises(DatasetNonValido, match="1 righe con data fuori dall'intervallo.*1990-05-12"):
        carica_e_valida(scrivi_csv(tmp_path, grezzo))


def test_data_futura_rifiutata(tmp_path, grezzo):
    grezzo.loc[0, "data"] = "2030-01-01"
    with pytest.raises(DatasetNonValido, match="2030-01-01"):
        carica_e_valida(scrivi_csv(tmp_path, grezzo))


def test_negozio_neg09_rifiutato(tmp_path, grezzo):
    grezzo.loc[0, "negozio"] = "NEG09"
    with pytest.raises(DatasetNonValido, match="1 righe con un negozio diverso da NEG01-NEG06, per esempio NEG09"):
        carica_e_valida(scrivi_csv(tmp_path, grezzo))


def test_riga_duplicata_dieci_volte_accettata(tmp_path, grezzo):
    # La pulizia toglie i duplicati data + negozio: le righe pulite restano le stesse
    con_duplicati = pd.concat([grezzo] + [grezzo.iloc[[0]]] * 10, ignore_index=True)
    df, report = carica_e_valida(scrivi_csv(tmp_path, con_duplicati))
    assert len(df) == 4332
    assert report["duplicati_rimossi"] == 53


def test_scarti_negativi_rifiutati(tmp_path, grezzo):
    grezzo.loc[0, "scarti_panetteria"] = -5
    with pytest.raises(DatasetNonValido, match="1 righe con scarti_panetteria negativo"):
        carica_e_valida(scrivi_csv(tmp_path, grezzo))


def test_colonna_numerica_con_testo_rifiutata(tmp_path, grezzo):
    grezzo["ore_pianificate"] = grezzo["ore_pianificate"].astype(object)
    grezzo.loc[0, "ore_pianificate"] = "otto"
    with pytest.raises(DatasetNonValido, match="ore_pianificate.*\"otto\""):
        carica_e_valida(scrivi_csv(tmp_path, grezzo))


def test_date_non_interpretabili_sotto_e_sopra_soglia(tmp_path, grezzo):
    # 1% di 4375 righe = 43,75: 40 date illeggibili passano, 60 no
    sotto = grezzo.copy()
    sotto.loc[:39, "data"] = "non è una data"
    df, report = carica_e_valida(scrivi_csv(tmp_path, sotto, "sotto.csv"))
    assert report["date_non_convertibili"] == 40

    sopra = grezzo.copy()
    sopra.loc[:59, "data"] = "non è una data"
    with pytest.raises(DatasetNonValido, match="60 righe su .* con data non interpretabile"):
        carica_e_valida(scrivi_csv(tmp_path, sopra, "sopra.csv"))
