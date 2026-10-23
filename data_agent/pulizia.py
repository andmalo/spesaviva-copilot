"""Regole di pulizia del dataset dei negozi.

La pulizia avviene solo in memoria: il CSV originale non viene mai modificato.
"""

import numpy as np
import pandas as pd

# Colonne dei tre reparti
REPARTI_VENDITE = ["vendite_ortofrutta", "vendite_panetteria", "vendite_freschi"]
REPARTI_SCARTI = ["scarti_ortofrutta", "scarti_panetteria", "scarti_freschi"]

# Tolleranza ammessa rispetto al rapporto tipico somma reparti / vendite totali
TOLLERANZA_COERENZA = 0.20

# Soglia per le vendite anomale: più di 3 volte la mediana del negozio
MOLTIPLICATORE_ANOMALIA = 3

# I tre formati di data presenti nel file: (espressione regolare, formato strptime)
FORMATI_DATA = [
    (r"\d{4}-\d{2}-\d{2}", "%Y-%m-%d"),  # AAAA-MM-GG
    (r"\d{2}/\d{2}/\d{4}", "%d/%m/%Y"),  # GG/MM/AAAA
    (r"\d{2}-\d{2}-\d{4}", "%d-%m-%Y"),  # GG-MM-AAAA
]


def _converti_date(serie):
    """Converte le date applicando esplicitamente ciascuno dei tre formati."""
    testo = serie.astype(str).str.strip()
    risultato = pd.Series(pd.NaT, index=serie.index, dtype="datetime64[ns]")
    for regex, formato in FORMATI_DATA:
        maschera = testo.str.fullmatch(regex)
        risultato[maschera] = pd.to_datetime(testo[maschera], format=formato, errors="coerce")
    return risultato


def _uniforma_negozio(serie):
    """Ricava il numero del negozio dal testo e lo riscrive come NEG01...NEG06."""
    # Tolgo spazi, trattini e underscore e porto tutto in maiuscolo
    testo = serie.astype(str).str.upper().str.replace(r"[\s\-_]", "", regex=True)
    # Il numero del negozio è la parte numerica finale (es. "NEGOZIO3" -> 3, "NEG05" -> 5)
    numero = pd.to_numeric(testo.str.extract(r"(\d+)$", expand=False), errors="coerce")
    return numero.map(lambda n: f"NEG{int(n):02d}" if pd.notna(n) else np.nan)


def _coerente(valore, somma_reparti, rapporto_tipico):
    """Vero se somma_reparti / valore è entro il 20% dal rapporto tipico."""
    rapporto = somma_reparti / valore
    return (rapporto / rapporto_tipico - 1).abs() <= TOLLERANZA_COERENZA


def pulisci_dati(df):
    """Applica le regole di pulizia e restituisce (df_pulito, report)."""
    df = df.copy()  # lavoro su una copia per non toccare il DataFrame originale
    report = {}

    # a) DATE: conto quelle non in formato AAAA-MM-GG e converto tutte in datetime
    non_standard = ~df["data"].astype(str).str.strip().str.fullmatch(FORMATI_DATA[0][0])
    df["data"] = _converti_date(df["data"])
    report["date_corrette"] = int((non_standard & df["data"].notna()).sum())
    report["date_non_convertibili"] = int(df["data"].isna().sum())

    # b) NEGOZI: uniformo i nomi e conto quelli che sono cambiati
    originali = df["negozio"].copy()
    df["negozio"] = _uniforma_negozio(df["negozio"])
    report["negozi_uniformati"] = int((originali != df["negozio"]).sum())

    # c) DUPLICATI: tengo solo la prima riga per ogni coppia data + negozio
    duplicati = df.duplicated(subset=["data", "negozio"], keep="first")
    report["duplicati_rimossi"] = int(duplicati.sum())
    df = df[~duplicati].reset_index(drop=True)

    # Somma delle vendite dei tre reparti, usata per verificare la coerenza
    somma_reparti = df[REPARTI_VENDITE].sum(axis=1, min_count=len(REPARTI_VENDITE))

    # Righe valide per il rapporto tipico: vendite positive e non anomale
    mediana_negozio = df.groupby("negozio")["vendite_totali"].transform("median")
    valide = (
        (df["vendite_totali"] > 0)
        & (df["vendite_totali"] <= MOLTIPLICATORE_ANOMALIA * mediana_negozio)
        & somma_reparti.notna()
    )
    rapporto_tipico = (somma_reparti[valide] / df.loc[valide, "vendite_totali"]).median()
    report["rapporto_tipico_reparti"] = round(float(rapporto_tipico), 4)

    # d) VENDITE NEGATIVE: inverto il segno solo se coerente con i reparti, altrimenti NaN
    negative = df["vendite_totali"] < 0
    valore_assoluto = df["vendite_totali"].abs()
    ok_negative = negative & _coerente(valore_assoluto, somma_reparti, rapporto_tipico)
    df.loc[ok_negative, "vendite_totali"] = valore_assoluto[ok_negative]
    df.loc[negative & ~ok_negative, "vendite_totali"] = np.nan
    report["vendite_negative_corrette"] = int(ok_negative.sum())
    report["vendite_negative_scartate"] = int((negative & ~ok_negative).sum())

    # e) VENDITE x10: oltre 3 volte la mediana del negozio -> divido per 10 se coerente
    mediana_negozio = df.groupby("negozio")["vendite_totali"].transform("median")
    anomale = df["vendite_totali"] > MOLTIPLICATORE_ANOMALIA * mediana_negozio
    diviso = df["vendite_totali"] / 10
    ok_anomale = anomale & _coerente(diviso, somma_reparti, rapporto_tipico)
    df.loc[ok_anomale, "vendite_totali"] = diviso[ok_anomale]
    df.loc[anomale & ~ok_anomale, "vendite_totali"] = np.nan
    report["vendite_x10_corrette"] = int(ok_anomale.sum())
    report["vendite_x10_scartate"] = int((anomale & ~ok_anomale).sum())

    # f) ASSENZE: ore di assenza superiori alle ore pianificate sono impossibili -> NaN
    assenze_errate = df["ore_assenza"] > df["ore_pianificate"]
    df.loc[assenze_errate, "ore_assenza"] = np.nan
    report["assenze_scartate"] = int(assenze_errate.sum())

    # g) SCONTRINI MANCANTI: stima = vendite / scontrino medio (mediana) del negozio
    righe_ok = (df["vendite_totali"] > 0) & (df["numero_scontrini"] > 0)
    scontrino_medio = (
        (df.loc[righe_ok, "vendite_totali"] / df.loc[righe_ok, "numero_scontrini"])
        .groupby(df.loc[righe_ok, "negozio"])
        .median()
    )
    mancanti = df["numero_scontrini"].isna()
    stima = (df["vendite_totali"] / df["negozio"].map(scontrino_medio)).round()
    stimabili = mancanti & stima.notna()  # se anche le vendite sono NaN resta NaN
    df.loc[stimabili, "numero_scontrini"] = stima[stimabili]
    df["scontrini_stimati"] = stimabili
    report["scontrini_stimati"] = int(stimabili.sum())
    report["scontrini_non_stimabili"] = int((mancanti & ~stimabili).sum())

    # h) SCARTI MANCANTI: mediana dello stesso reparto, negozio e mese
    mese = df["data"].dt.to_period("M")
    df["scarti_stimati"] = False
    for colonna in REPARTI_SCARTI:
        mancanti = df[colonna].isna()
        mediana_gruppo = df.groupby([df["negozio"], mese])[colonna].transform("median")
        stimabili = mancanti & mediana_gruppo.notna()
        df.loc[stimabili, colonna] = mediana_gruppo[stimabili]
        df["scarti_stimati"] |= stimabili
        report[f"{colonna}_stimati"] = int(stimabili.sum())
    report["righe_scarti_stimati"] = int(df["scarti_stimati"].sum())

    # i) SETTIMANA: lunedì di inizio, solo per le settimane complete (lunedì-domenica,
    #    7 giorni presenti per quel negozio); vuota (NaT) per le settimane parziali.
    #    Così un groupby sulla colonna esclude da solo le settimane incomplete,
    #    come quella in corso quando ieri è lunedì.
    lunedi = (df["data"] - pd.to_timedelta(df["data"].dt.weekday, unit="D")).dt.normalize()
    giorni = df.groupby([df["negozio"], lunedi])["data"].transform("nunique")
    df["settimana"] = lunedi.where(giorni == 7)

    return df, report


def riepilogo_pulizia(report):
    """Restituisce una frase in italiano che riassume le operazioni di pulizia."""
    parti = [
        f"corrette {report['date_corrette']} date",
        f"uniformati {report['negozi_uniformati']} nomi di negozio",
        f"rimossi {report['duplicati_rimossi']} duplicati",
        f"corrette {report['vendite_negative_corrette']} vendite negative "
        f"(scartate {report['vendite_negative_scartate']})",
        f"corrette {report['vendite_x10_corrette']} vendite moltiplicate per 10 "
        f"(scartate {report['vendite_x10_scartate']})",
        f"scartate {report['assenze_scartate']} ore di assenza impossibili",
        f"stimati {report['scontrini_stimati']} numeri di scontrini",
        f"stimati gli scarti in {report['righe_scarti_stimati']} righe",
    ]
    return "Pulizia dati: " + ", ".join(parti) + "."
