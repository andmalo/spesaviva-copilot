"""Validazione del dataset dei negozi, in due momenti.

Il CSV è sporco di proposito (date in tre formati, nomi dei negozi incoerenti,
duplicati, valori fuori range) e lo sistema pulizia.py: la validazione non
rifiuta lo sporco previsto, ma ciò che la pulizia non può sistemare.

1. controlla_struttura(): prima della pulizia, sul CSV grezzo (colonne, righe).
2. controlla_valori(): dopo la pulizia, sui dati puliti (date, negozi, duplicati,
   valori negativi, tipi).

Se un controllo fallisce si solleva DatasetNonValido e il caricamento si interrompe.
"""

import logging
from datetime import date

import pandas as pd

from pulizia import pulisci_dati

logger = logging.getLogger("data_agent")

COLONNE_ATTESE = [
    "data", "negozio", "vendite_totali", "obiettivo_vendite", "numero_scontrini",
    "vendite_ortofrutta", "vendite_panetteria", "vendite_freschi",
    "scarti_ortofrutta", "scarti_panetteria", "scarti_freschi", "scarti_kg_totali",
    "referenze_in_rottura", "consegne_in_ritardo", "ore_pianificate", "ore_assenza",
    "eccedenze_donate_kg", "evento",
]
COLONNE_TESTO = {"data", "negozio", "evento"}
COLONNE_NUMERICHE = [c for c in COLONNE_ATTESE if c not in COLONNE_TESTO]
# Vendite, scarti e ore non possono essere negativi (i valori mancanti sono ammessi)
COLONNE_NON_NEGATIVE = [c for c in COLONNE_NUMERICHE if c.startswith(("vendite_", "scarti_", "ore_"))]

NEGOZI_AMMESSI = {f"NEG{n:02d}" for n in range(1, 7)}  # NEG01 ... NEG06
PRIMA_DATA_PLAUSIBILE = date(2020, 1, 1)
QUOTA_MASSIMA_DATE_NON_INTERPRETABILI = 0.01  # 1% delle righe


class DatasetNonValido(Exception):
    """Il dataset non supera un controllo: il messaggio (in italiano) dice quale,
    su quante righe e con un esempio."""


def _esempio(valori) -> str:
    """Il primo valore della serie, come testo leggibile."""
    valore = valori.iloc[0]
    if isinstance(valore, pd.Timestamp):
        return valore.date().isoformat()
    return str(valore)


def controlla_struttura(df: pd.DataFrame) -> None:
    """Prima della pulizia: tutte le colonne attese presenti e almeno una riga.
    Le colonne in più non bloccano il caricamento: si segnalano nel log."""
    mancanti = [c for c in COLONNE_ATTESE if c not in df.columns]
    if mancanti:
        raise DatasetNonValido(
            f"Controllo della struttura fallito: mancano {len(mancanti)} colonne attese "
            f"({', '.join(mancanti)})."
        )
    in_piu = [c for c in df.columns if c not in COLONNE_ATTESE]
    if in_piu:
        logger.warning("Il dataset ha %d colonne in più, ignorate dai controlli: %s", len(in_piu), ", ".join(in_piu))
    if len(df) == 0:
        raise DatasetNonValido("Controllo della struttura fallito: il file non contiene righe di dati.")
    # Anche prima della pulizia: con un testo in una colonna numerica la pulizia non può funzionare
    _controlla_tipi(df)


def _controlla_tipi(df: pd.DataFrame) -> None:
    """Le colonne numeriche devono essere di tipo numerico."""
    non_numeriche = [c for c in COLONNE_NUMERICHE if not pd.api.types.is_numeric_dtype(df[c])]
    if non_numeriche:
        colonna = non_numeriche[0]
        testo = pd.to_numeric(df[colonna], errors="coerce").isna() & df[colonna].notna()
        esempio = f", per esempio \"{_esempio(df.loc[testo, colonna])}\"" if testo.any() else ""
        raise DatasetNonValido(
            f"Controllo dei tipi fallito: {len(non_numeriche)} colonne non numeriche "
            f"({', '.join(non_numeriche)}); in {colonna}, {int(testo.sum())} righe con valori non numerici{esempio}."
        )


def controlla_valori(df: pd.DataFrame, report: dict, righe_lette: int, oggi: date | None = None) -> None:
    """Dopo la pulizia: i valori che la pulizia non ha potuto sistemare bloccano il caricamento.
    report e righe_lette vengono dalla pulizia e dal CSV grezzo: le righe con data illeggibile
    dello stesso negozio la pulizia le unisce come duplicati, quindi si contano prima.
    oggi: limite superiore delle date (predefinito: la data di sistema)."""
    oggi = oggi or date.today()
    _controlla_tipi(df)

    # Date non interpretabili: ammesse solo sotto la soglia
    illeggibili = report["date_non_convertibili"]
    if illeggibili > QUOTA_MASSIMA_DATE_NON_INTERPRETABILI * righe_lette:
        raise DatasetNonValido(
            f"Controllo delle date fallito: {illeggibili} righe su {righe_lette} con data non "
            f"interpretabile, oltre la soglia del {QUOTA_MASSIMA_DATE_NON_INTERPRETABILI:.0%}."
        )

    # Date valide in un intervallo plausibile
    giorni = df["data"].dt.date
    fuori = df["data"].notna() & ((giorni < PRIMA_DATA_PLAUSIBILE) | (giorni > oggi))
    if fuori.any():
        raise DatasetNonValido(
            f"Controllo delle date fallito: {int(fuori.sum())} righe con data fuori dall'intervallo "
            f"{PRIMA_DATA_PLAUSIBILE.isoformat()} - {oggi.isoformat()}, per esempio {_esempio(df.loc[fuori, 'data'])}."
        )

    # Negozi solo tra NEG01 e NEG06
    negozi_errati = ~df["negozio"].isin(NEGOZI_AMMESSI)
    if negozi_errati.any():
        raise DatasetNonValido(
            f"Controllo dei negozi fallito: {int(negozi_errati.sum())} righe con un negozio diverso da "
            f"NEG01-NEG06, per esempio {_esempio(df.loc[negozi_errati, 'negozio'])}."
        )

    # Nessun duplicato data + negozio rimasto dopo la pulizia
    duplicati = df.duplicated(subset=["data", "negozio"], keep=False)
    if duplicati.any():
        riga = df.loc[duplicati].iloc[0]
        raise DatasetNonValido(
            f"Controllo dei duplicati fallito: {int(duplicati.sum())} righe con la stessa coppia data + negozio, "
            f"per esempio {_esempio(pd.Series([riga['data']]))} {riga['negozio']}."
        )

    # Vendite, scarti e ore non negativi
    for colonna in COLONNE_NON_NEGATIVE:
        negativi = df[colonna] < 0
        if negativi.any():
            raise DatasetNonValido(
                f"Controllo dei valori fallito: {int(negativi.sum())} righe con {colonna} negativo, "
                f"per esempio {_esempio(df.loc[negativi, colonna])}."
            )


def carica_e_valida(percorso, oggi: date | None = None):
    """Legge il CSV, ne controlla la struttura, lo pulisce e ne controlla i valori.
    Restituisce (df_pulito, report) come pulisci_dati; solleva DatasetNonValido."""
    try:
        grezzo = pd.read_csv(percorso)
    except pd.errors.EmptyDataError:
        raise DatasetNonValido("Controllo della struttura fallito: il file è vuoto.") from None
    controlla_struttura(grezzo)
    df_pulito, report = pulisci_dati(grezzo)
    controlla_valori(df_pulito, report, len(grezzo), oggi)
    return df_pulito, report
