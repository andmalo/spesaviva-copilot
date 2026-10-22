"""
genera_dataset.py
-----------------
Genera il dataset simulato per l'AI Store Manager Copilot.

Scenario: catena di supermercati immaginaria, 6 punti vendita in Romagna,
dati giornalieri per 2 anni (settembre 2024 - agosto 2026).

Il file prodotto contiene di proposito:
  A) anomalie di BUSINESS (fatti veri che l'agente deve SCOPRIRE e segnalare)
  B) anomalie SPORCHE (errori di registrazione che l'agente deve PULIRE)

Tutte le ipotesi sui numeri sono documentate nei commenti e vanno riportate nel README.

Uso:
    python genera_dataset.py
Output:
    dati_negozi.csv (nella stessa cartella dello script)
"""

from pathlib import Path

import numpy as np
import pandas as pd

# Seed fisso: chiunque rilanci lo script ottiene ESATTAMENTE lo stesso CSV (riproducibilità)
rng = np.random.default_rng(42)

CARTELLA = Path(__file__).parent
FILE_OUTPUT = CARTELLA / "dati_negozi.csv"

# ---------------------------------------------------------------------------
# 1. PARAMETRI DI BASE
# ---------------------------------------------------------------------------

DATA_INIZIO = "2024-09-01"
DATA_FINE = "2026-08-31"

# Vendite medie giornaliere per negozio (euro).
# Ancoraggio: dati pubblici Lidl Italia -> ~7,5 mld / ~800 negozi = ~26.000 euro/giorno.
# NEG06 e' un negozio della costa: in estate lavora molto di piu' (turismo).
NEGOZI = {
    "NEG01": 26000,
    "NEG02": 22000,
    "NEG03": 30000,
    "NEG04": 19000,
    "NEG05": 25000,
    "NEG06": 24000,  # costiero
}

# Moltiplicatori per giorno della settimana (0 = lunedi'). Validati con esperienza diretta:
# sabato e domenica sono i giorni piu' intensi.
GIORNO_SETTIMANA = {0: 0.85, 1: 0.90, 2: 0.90, 3: 0.95, 4: 1.10, 5: 1.35, 6: 1.25}

# Stagionalita' mensile (dicembre alto per le feste, gennaio-febbraio bassi).
MESE = {1: 0.92, 2: 0.92, 3: 0.97, 4: 1.00, 5: 1.00, 6: 1.02,
        7: 1.04, 8: 1.02, 9: 0.98, 10: 0.98, 11: 0.98, 12: 1.15}

# Extra estivo solo per il negozio costiero
EXTRA_COSTA = {6: 1.10, 7: 1.30, 8: 1.35}

CRESCITA_ANNUA = 0.02          # trend di fondo +2% annuo
SCONTRINO_MEDIO = 25.0         # euro (stima: 22-28 euro)

# Quote dei reparti sulle vendite totali (stime)
QUOTA_REPARTO = {"ortofrutta": 0.11, "panetteria": 0.05, "freschi": 0.27}

# Tasso di scarto medio per reparto, in % delle vendite del reparto (stime)
TASSO_SCARTO = {"ortofrutta": 0.045, "panetteria": 0.060, "freschi": 0.022}

# Prezzo medio al kg per convertire gli scarti da euro a kg (stime)
PREZZO_KG = {"ortofrutta": 2.2, "panetteria": 3.5, "freschi": 9.0}

# Giorni di chiusura: le righe di questi giorni NON esistono nel dataset
CHIUSURE = pd.to_datetime([
    "2024-12-25", "2024-12-26", "2025-01-01", "2025-04-20",  # Pasqua 2025
    "2025-12-25", "2025-12-26", "2026-01-01", "2026-04-05",  # Pasqua 2026
])

# Festivi in cui il negozio e' aperto: piu' affluenza
FESTIVI_APERTI = pd.to_datetime([
    "2024-11-01", "2024-12-08", "2025-01-06", "2025-04-25", "2025-05-01",
    "2025-06-02", "2025-08-15", "2025-11-01", "2025-12-08", "2026-01-06",
    "2026-04-25", "2026-05-01", "2026-06-02", "2026-08-15",
])

# ---------------------------------------------------------------------------
# 2. CALENDARIO COMUNE (il meteo e' uguale per tutti i negozi della zona)
# ---------------------------------------------------------------------------

date = pd.date_range(DATA_INIZIO, DATA_FINE, freq="D")
date = date[~date.isin(CHIUSURE)]

# Circa 5% di giorni di maltempo, gli stessi per tutti i negozi
giorni_maltempo = set(rng.choice(date, size=int(len(date) * 0.05), replace=False))

# ---------------------------------------------------------------------------
# 3. GENERAZIONE DEI DATI "PULITI"
# ---------------------------------------------------------------------------

righe = []
for negozio, base in NEGOZI.items():
    for giorno in date:
        anni_trascorsi = (giorno - date[0]).days / 365

        # Vendite attese = base x settimana x mese x trend (senza rumore)
        atteso = (base
                  * GIORNO_SETTIMANA[giorno.dayofweek]
                  * MESE[giorno.month]
                  * (1 + CRESCITA_ANNUA) ** anni_trascorsi)
        if negozio == "NEG06":
            atteso *= EXTRA_COSTA.get(giorno.month, 1.0)

        # Obiettivo: le vendite attese maggiorate del 3%, arrotondate alle decine
        obiettivo = round(atteso * 1.03, -1)

        # Evento del giorno e suo effetto
        if giorno in giorni_maltempo:
            evento, effetto = "maltempo", 0.88
        elif giorno in FESTIVI_APERTI:
            evento, effetto = "festivo", 1.10
        elif rng.random() < 0.10:
            evento, effetto = "promo", 1.08
        else:
            evento, effetto = "nessuno", 1.0

        # Rumore casuale moltiplicativo (~5%)
        vendite = atteso * effetto * rng.lognormal(0, 0.05)

        # Scontrini: nel weekend si spende un po' di piu' per scontrino
        scontrino = SCONTRINO_MEDIO * (1.05 if giorno.dayofweek >= 5 else 1.0)
        scontrino *= rng.normal(1, 0.04)
        scontrini = vendite / scontrino

        # Vendite e scarti per reparto
        vend_rep, scarti_rep = {}, {}
        for reparto, quota in QUOTA_REPARTO.items():
            vend_rep[reparto] = vendite * quota * rng.normal(1, 0.05)
            tasso = TASSO_SCARTO[reparto]
            if reparto == "ortofrutta" and giorno.month in (6, 7, 8):
                tasso += 0.01  # d'estate la frutta si rovina prima
            scarti_rep[reparto] = vend_rep[reparto] * tasso * rng.lognormal(0, 0.20)

        # Operativita'
        rotture = rng.poisson(40 + (15 if giorno.dayofweek == 0 else 0))  # lunedi' post weekend
        ritardi = min(rng.poisson(0.15), 5)  # ~1 ritardo a settimana: la soglia di 3 resta significativa
        ore_pian = 185 * (atteso / base) ** 0.6 * rng.normal(1, 0.03)
        ore_ass = ore_pian * max(rng.normal(0.045, 0.015), 0)
        donate = max(rng.normal(20, 6), 0)

        righe.append({
            "data": giorno, "negozio": negozio,
            "vendite_totali": vendite, "obiettivo_vendite": obiettivo,
            "numero_scontrini": scontrini,
            "vendite_ortofrutta": vend_rep["ortofrutta"],
            "vendite_panetteria": vend_rep["panetteria"],
            "vendite_freschi": vend_rep["freschi"],
            "scarti_ortofrutta": scarti_rep["ortofrutta"],
            "scarti_panetteria": scarti_rep["panetteria"],
            "scarti_freschi": scarti_rep["freschi"],
            "referenze_in_rottura": rotture, "consegne_in_ritardo": ritardi,
            "ore_pianificate": ore_pian, "ore_assenza": ore_ass,
            "eccedenze_donate_kg": donate, "evento": evento,
        })

df = pd.DataFrame(righe)

# ---------------------------------------------------------------------------
# 4. ANOMALIE DI BUSINESS (da SCOPRIRE, non da pulire)
# ---------------------------------------------------------------------------

# 4.1 Negozio "sprecone": NEG05 butta il doppio del pane, tutto l'anno
m = df["negozio"] == "NEG05"
df.loc[m, "scarti_panetteria"] *= 2.0

# 4.2 Ondata di caldo: 2 settimane di luglio 2025, scarti ortofrutta +50% ovunque
m = df["data"].between("2025-07-07", "2025-07-20")
df.loc[m, "scarti_ortofrutta"] *= 1.5

# 4.3 Fornitore in crisi: marzo 2026, NEG03 e NEG04.
#     Ritardi triplicati e, pochi giorni dopo, piu' prodotti a scaffale vuoto.
neg_crisi = df["negozio"].isin(["NEG03", "NEG04"])
m = neg_crisi & df["data"].between("2026-03-01", "2026-03-31")
df.loc[m, "consegne_in_ritardo"] = rng.poisson(1.3, m.sum()).clip(max=5)
m = neg_crisi & df["data"].between("2026-03-04", "2026-04-03")
df.loc[m, "referenze_in_rottura"] = (df.loc[m, "referenze_in_rottura"] * 1.6).round()

# 4.4 Settimana influenzale: NEG02, gennaio 2026.
#     Assenze al 15%, meno casse aperte -> meno clienti serviti -> vendite sotto obiettivo.
m = (df["negozio"] == "NEG02") & df["data"].between("2026-01-12", "2026-01-18")
df.loc[m, "ore_assenza"] = df.loc[m, "ore_pianificate"] * 0.15
for col in ["vendite_totali", "numero_scontrini", "vendite_ortofrutta",
            "vendite_panetteria", "vendite_freschi"]:
    df.loc[m, col] *= 0.88

# 4.5 Miglioramento: NEG01 rivede gli ordini del pane da luglio 2026
m = (df["negozio"] == "NEG01") & df["data"].between("2026-07-01", "2026-08-31")
df.loc[m, "scarti_panetteria"] *= 0.82

# Colonna derivata dagli scarti in euro (calcolata DOPO le anomalie, cosi' resta coerente)
df["scarti_kg_totali"] = sum(df[f"scarti_{r}"] / PREZZO_KG[r] for r in PREZZO_KG)

# Arrotondamenti realistici
for col in ["vendite_totali", "vendite_ortofrutta", "vendite_panetteria", "vendite_freschi",
            "scarti_ortofrutta", "scarti_panetteria", "scarti_freschi"]:
    df[col] = df[col].round(2)
for col in ["scarti_kg_totali", "ore_pianificate", "ore_assenza", "eccedenze_donate_kg"]:
    df[col] = df[col].round(1)
df["numero_scontrini"] = df["numero_scontrini"].round().astype(int)
df["referenze_in_rottura"] = df["referenze_in_rottura"].astype(int)

# Ordine delle colonne
colonne = ["data", "negozio", "vendite_totali", "obiettivo_vendite", "numero_scontrini",
           "vendite_ortofrutta", "vendite_panetteria", "vendite_freschi",
           "scarti_ortofrutta", "scarti_panetteria", "scarti_freschi", "scarti_kg_totali",
           "referenze_in_rottura", "consegne_in_ritardo", "ore_pianificate", "ore_assenza",
           "eccedenze_donate_kg", "evento"]
df = df[colonne]

# ---------------------------------------------------------------------------
# 5. ANOMALIE SPORCHE (da PULIRE)
#    Le righe coinvolte sono scelte a caso, ma MAI dentro i periodi delle anomalie
#    di business, cosi' errori e fatti veri restano distinguibili.
# ---------------------------------------------------------------------------

periodi_protetti = (
    df["data"].between("2025-07-07", "2025-07-20")
    | df["data"].between("2026-01-12", "2026-01-18")
    | (neg_crisi & df["data"].between("2026-03-01", "2026-04-03"))
)
indici_liberi = df.index[~periodi_protetti]


def scegli(n):
    """Sceglie n righe a caso tra quelle non protette."""
    return rng.choice(indici_liberi, size=n, replace=False)


# Le colonne numeriche diventano float per poter contenere valori mancanti (NaN)
df["numero_scontrini"] = df["numero_scontrini"].astype("float")

# 5.1 Valori mancanti (~1% per colonna)
for col in ["numero_scontrini", "scarti_ortofrutta", "scarti_panetteria", "scarti_freschi"]:
    df.loc[scegli(int(len(df) * 0.01)), col] = np.nan

# 5.2 Valori impossibili: vendite negative, assenze superiori alle ore pianificate
idx = scegli(5)
df.loc[idx, "vendite_totali"] = -df.loc[idx, "vendite_totali"]
idx = scegli(5)
df.loc[idx, "ore_assenza"] = df.loc[idx, "ore_pianificate"] * 1.4

# 5.3 Errori di battitura: vendite moltiplicate per 10 (virgola spostata)
idx = scegli(5)
df.loc[idx, "vendite_totali"] = df.loc[idx, "vendite_totali"] * 10

# 5.4 Nomi dei negozi incoerenti (~3% delle righe)
varianti = {
    "NEG01": ["neg01", "Negozio 1"], "NEG02": ["neg_02", "Negozio 2"],
    "NEG03": ["NEG 03", "negozio 3"], "NEG04": ["neg04", "Negozio 4"],
    "NEG05": ["NEG-05", "Negozio 5"], "NEG06": ["neg06 ", "Negozio 6"],
}
for i in scegli(int(len(df) * 0.03)):
    df.loc[i, "negozio"] = rng.choice(varianti[df.loc[i, "negozio"]])

# 5.5 Date in formati misti (~3% delle righe). Prima convertiamo tutte le date in testo ISO.
df["data_ordinamento"] = df["data"]           # colonna di servizio, rimossa alla fine
df["data"] = df["data"].dt.strftime("%Y-%m-%d")
for i in scegli(int(len(df) * 0.03)):
    formato = rng.choice(["%d/%m/%Y", "%d-%m-%Y"])
    df.loc[i, "data"] = df.loc[i, "data_ordinamento"].strftime(formato)

# 5.6 Righe duplicate (~1%), come un doppio caricamento
duplicati = df.loc[scegli(int(len(df) * 0.01))]
df = pd.concat([df, duplicati])

# Ordine finale per data e negozio, poi via la colonna di servizio
df = df.sort_values(["data_ordinamento", "negozio"], kind="stable")
df = df.drop(columns="data_ordinamento").reset_index(drop=True)

# ---------------------------------------------------------------------------
# 6. SALVATAGGIO E RIEPILOGO
# ---------------------------------------------------------------------------

df.to_csv(FILE_OUTPUT, index=False)

print(f"Creato {FILE_OUTPUT.name}: {len(df)} righe, {df.shape[1]} colonne")
print(f"Valori mancanti totali: {int(df.isna().sum().sum())}")
print(f"Righe duplicate: {int(df.duplicated().sum())}")