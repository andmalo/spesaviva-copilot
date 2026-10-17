"""Briefing del mattino calcolato in modo deterministico, solo con pandas (nessun LLM).

Calcola i KPI di ieri e controlla le soglie del manuale operativo su scarti,
referenze in rottura, consegne in ritardo e assenze. Un'anomalia viene segnalata
SOLO quando la condizione prevista dal manuale è vera.
"""

from datetime import date, timedelta

# Backend "Agg": matplotlib disegna solo su file, senza aprire finestre
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd

# ---------------------------------------------------------------------------
# Soglie copiate dal manuale operativo (data/documenti/manuale_operativo.md)
# ---------------------------------------------------------------------------
SOGLIE = {
    # Capitolo 1 "Gestione degli scarti e soglie di attenzione":
    # tasso = scarti del reparto / vendite dello stesso reparto, in %
    "scarti": {
        "ortofrutta": {"soglia": 7.0, "doppio_normale": 10.0},   # normale 4-5%
        "panetteria": {"soglia": 8.0, "doppio_normale": 12.0},   # normale circa 6%
        "freschi": {"soglia": 3.5, "doppio_normale": 4.0},       # normale circa 2%
    },
    # Capitolo 1: azioni obbligatorie dopo 3 giorni consecutivi sopra soglia;
    # segnalazione all'Area Manager dopo 7 giorni consecutivi
    "scarti_giorni_azioni": 3,
    "scarti_giorni_area_manager": 7,
    # Capitolo 5 "Ricevimento merce": oltre 60 referenze in rottura per 2 giorni consecutivi
    "rotture_limite": 60,
    "rotture_giorni": 2,
    # Capitolo 5: 3 o più consegne in ritardo nella stessa settimana (lunedì-domenica)
    "consegne_ritardo_settimana": 3,
    # Capitolo 6 "Gestione del personale": assenze oltre il 10% delle ore pianificate nella settimana
    "assenze_settimana_pct": 10.0,
}

REPARTI = ["ortofrutta", "panetteria", "freschi"]

# Colori del grafico
VERDE = "#1F6B45"
ARANCIONE = "#C2721F"
GRIGIO_SOGLIA = "#5B625C"

MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
GIORNI = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]


# ---------------------------------------------------------------------------
# Funzioni di supporto
# ---------------------------------------------------------------------------

def _data_it(giorno: date) -> str:
    """Data per esteso in italiano, es. '31 agosto 2026'."""
    return f"{giorno.day} {MESI[giorno.month - 1]} {giorno.year}"


def _periodo_it(inizio: date, fine: date) -> str:
    """Periodo in italiano, es. 'dal 2 marzo 2026 all'8 marzo 2026'."""
    if inizio == fine:
        return _data_it(fine)
    articolo = "all'" if fine.day in (8, 11) else "al "
    return f"dal {_data_it(inizio)} {articolo}{_data_it(fine)}"


def _numero_it(valore: float, decimali: int = 2) -> str:
    """Numero con la virgola decimale, es. 7,02."""
    return f"{valore:.{decimali}f}".replace(".", ",")


def _tasso_scarto(righe: pd.DataFrame, reparto: str) -> pd.Series:
    """Tasso di scarto giornaliero del reparto, in % delle vendite dello stesso reparto."""
    return righe[f"scarti_{reparto}"] / righe[f"vendite_{reparto}"] * 100


def _giorni_consecutivi(condizione: pd.Series, fine: date) -> tuple[int, date | None]:
    """Conta i giorni consecutivi, all'indietro da 'fine', in cui la condizione è vera.

    'condizione' è indicizzata per data. Un giorno senza dati interrompe la serie:
    non si può affermare che la soglia sia stata superata in un giorno che non c'è.
    Restituisce il numero di giorni e la data del primo giorno della serie.
    """
    giorni = 0
    giorno = fine
    while giorno in condizione.index and bool(condizione[giorno]):
        giorni += 1
        giorno -= timedelta(days=1)
    primo = giorno + timedelta(days=1) if giorni else None
    return giorni, primo


def _settimane_da_controllare(ieri: date) -> list[tuple[date, date, str]]:
    """Settimana in corso (da lunedì a ieri) e, se ieri era lunedì, anche quella completa precedente."""
    lunedi = ieri - timedelta(days=ieri.weekday())
    settimane = [(lunedi, ieri, "settimana in corso")]
    if ieri.weekday() == 0:
        settimane.append((lunedi - timedelta(days=7), lunedi - timedelta(days=1), "settimana precedente"))
    return settimane


# ---------------------------------------------------------------------------
# Controlli delle soglie
# ---------------------------------------------------------------------------

def _controlla_scarti(serie: pd.DataFrame, ieri: date) -> list[dict]:
    anomalie = []
    for reparto in REPARTI:
        soglie = SOGLIE["scarti"][reparto]
        tassi = _tasso_scarto(serie, reparto)
        giorni, primo = _giorni_consecutivi(tassi > soglie["soglia"], ieri)
        tasso_ieri = float(tassi[ieri])

        # Azioni obbligatorie: sopra soglia per almeno 3 giorni consecutivi fino a ieri
        if giorni >= SOGLIE["scarti_giorni_azioni"]:
            anomalie.append({
                "tipo": "scarti_sopra_soglia",
                "reparto": reparto,
                "valore": f"{_numero_it(tasso_ieri)}% ieri, sopra soglia da {giorni} giorni consecutivi",
                "soglia": f"{_numero_it(soglie['soglia'], 1)}% per {SOGLIE['scarti_giorni_azioni']} giorni consecutivi",
                "periodo": _periodo_it(primo, ieri),
                "testo": (f"Scarto di {reparto} sopra la soglia del {_numero_it(soglie['soglia'], 1)}% "
                          f"per {giorni} giorni consecutivi (ieri {_numero_it(tasso_ieri)}%)."),
                "domanda_procedura": f"Cosa fare se lo scarto di {reparto} supera la soglia per 3 giorni consecutivi",
                "area_manager": False,
            })

        # Da comunicare all'Area Manager: ieri oltre il doppio del normale, o 7 giorni consecutivi sopra soglia
        oltre_doppio = tasso_ieri > soglie["doppio_normale"]
        sette_giorni = giorni >= SOGLIE["scarti_giorni_area_manager"]
        if oltre_doppio or sette_giorni:
            motivi = []
            if oltre_doppio:
                motivi.append(f"ieri {_numero_it(tasso_ieri)}%, oltre il doppio del valore normale "
                              f"({_numero_it(soglie['doppio_normale'], 1)}%)")
            if sette_giorni:
                motivi.append(f"sopra soglia da {giorni} giorni consecutivi")
            anomalie.append({
                "tipo": "scarti_area_manager",
                "reparto": reparto,
                "valore": "; ".join(motivi),
                "soglia": (f"doppio del normale {_numero_it(soglie['doppio_normale'], 1)}% in un giorno, "
                           f"oppure soglia superata per {SOGLIE['scarti_giorni_area_manager']} giorni consecutivi"),
                "periodo": _periodo_it(primo, ieri) if sette_giorni else _data_it(ieri),
                "testo": f"Scarto di {reparto} da comunicare all'Area Manager: {'; '.join(motivi)}.",
                "domanda_procedura": f"Quando segnalare all'Area Manager uno scarto di {reparto} oltre il doppio del valore normale o sopra soglia per 7 giorni consecutivi",
                "area_manager": True,
            })
    return anomalie


def _controlla_rotture(serie: pd.DataFrame, ieri: date) -> list[dict]:
    limite = SOGLIE["rotture_limite"]
    giorni, primo = _giorni_consecutivi(serie["referenze_in_rottura"] > limite, ieri)
    if giorni < SOGLIE["rotture_giorni"]:
        return []
    valori = serie.loc[primo:ieri, "referenze_in_rottura"].astype(int).tolist()
    return [{
        "tipo": "rotture_di_stock",
        "reparto": None,
        "valore": f"{' e '.join(str(v) for v in valori[-2:])} referenze negli ultimi 2 giorni (sopra 60 da {giorni} giorni)",
        "soglia": f"oltre {limite} referenze per {SOGLIE['rotture_giorni']} giorni consecutivi",
        "periodo": _periodo_it(primo, ieri),
        "testo": f"Referenze in rottura oltre {limite} per {giorni} giorni consecutivi (ieri {valori[-1]}).",
        "domanda_procedura": "Cosa fare se le referenze in rottura superano 60 per 2 giorni consecutivi",
        "area_manager": False,
    }]


def _controlla_consegne(serie: pd.DataFrame, ieri: date) -> list[dict]:
    anomalie = []
    for inizio, fine, nome in _settimane_da_controllare(ieri):
        totale = int(serie.loc[inizio:fine, "consegne_in_ritardo"].sum())
        if totale >= SOGLIE["consegne_ritardo_settimana"]:
            anomalie.append({
                "tipo": "consegne_in_ritardo",
                "reparto": None,
                "valore": f"{totale} consegne in ritardo",
                "soglia": f"{SOGLIE['consegne_ritardo_settimana']} o più nella stessa settimana",
                "periodo": f"{nome}, {_periodo_it(inizio, fine)}",
                "testo": f"{totale} consegne in ritardo nella {nome} ({_periodo_it(inizio, fine)}).",
                "domanda_procedura": "Cosa fare se ci sono 3 o più consegne in ritardo nella stessa settimana",
                "area_manager": False,
            })
    return anomalie


def _controlla_assenze(serie: pd.DataFrame, ieri: date) -> list[dict]:
    anomalie = []
    for inizio, fine, nome in _settimane_da_controllare(ieri):
        settimana = serie.loc[inizio:fine]
        pianificate = settimana["ore_pianificate"].sum()
        if pianificate <= 0:
            continue
        tasso = float(settimana["ore_assenza"].sum() / pianificate * 100)
        if tasso > SOGLIE["assenze_settimana_pct"]:
            anomalie.append({
                "tipo": "assenze",
                "reparto": None,
                "valore": f"{_numero_it(tasso)}% delle ore pianificate",
                "soglia": f"oltre il {_numero_it(SOGLIE['assenze_settimana_pct'], 0)}% nella settimana",
                "periodo": f"{nome}, {_periodo_it(inizio, fine)}",
                "testo": f"Assenze al {_numero_it(tasso)}% delle ore pianificate nella {nome} ({_periodo_it(inizio, fine)}).",
                "domanda_procedura": "Cosa fare se le assenze superano il 10% delle ore pianificate nella settimana",
                "area_manager": False,
            })
    return anomalie


# ---------------------------------------------------------------------------
# Stato di ogni controllo (anche quando non c'è anomalia)
# ---------------------------------------------------------------------------

def _stato_controlli(serie: pd.DataFrame, ieri: date, anomalie: list[dict]) -> dict:
    """Valori, soglie e giorni consecutivi di ogni controllo, con l'esito già deciso.

    Serve a passare all'LLM lo stato già calcolato, così non deve confrontare
    da solo valori e soglie (es. 7,02% contro 7%).
    """
    tipi = {(a["tipo"], a.get("reparto")) for a in anomalie}

    scarti = {}
    for reparto in REPARTI:
        soglie = SOGLIE["scarti"][reparto]
        tassi = _tasso_scarto(serie, reparto)
        giorni, _ = _giorni_consecutivi(tassi > soglie["soglia"], ieri)
        scarti[reparto] = {
            "valore": round(float(tassi[ieri]), 2),
            "soglia": soglie["soglia"],
            "giorni_sopra_soglia": giorni,
            "giorni_per_anomalia": SOGLIE["scarti_giorni_azioni"],
            "anomalia": ("scarti_sopra_soglia", reparto) in tipi,
            "area_manager": ("scarti_area_manager", reparto) in tipi,
        }

    giorni_rotture, _ = _giorni_consecutivi(serie["referenze_in_rottura"] > SOGLIE["rotture_limite"], ieri)
    rotture = {
        "valore": int(serie.loc[ieri, "referenze_in_rottura"]),
        "limite": SOGLIE["rotture_limite"],
        "giorni_sopra_limite": giorni_rotture,
        "giorni_per_anomalia": SOGLIE["rotture_giorni"],
        "anomalia": giorni_rotture >= SOGLIE["rotture_giorni"],
    }

    consegne, assenze = [], []
    for inizio, fine, nome in _settimane_da_controllare(ieri):
        settimana = serie.loc[inizio:fine]
        totale = int(settimana["consegne_in_ritardo"].sum())
        consegne.append({
            "settimana": nome,
            "periodo": _periodo_it(inizio, fine),
            "valore": totale,
            "soglia": SOGLIE["consegne_ritardo_settimana"],
            "anomalia": totale >= SOGLIE["consegne_ritardo_settimana"],
        })
        pianificate = settimana["ore_pianificate"].sum()
        tasso = float(settimana["ore_assenza"].sum() / pianificate * 100) if pianificate > 0 else 0.0
        assenze.append({
            "settimana": nome,
            "periodo": _periodo_it(inizio, fine),
            "valore": round(tasso, 2),
            "soglia": SOGLIE["assenze_settimana_pct"],
            "anomalia": tasso > SOGLIE["assenze_settimana_pct"],
        })

    return {"scarti": scarti, "rotture": rotture, "consegne": consegne, "assenze": assenze}


# ---------------------------------------------------------------------------
# Grafico
# ---------------------------------------------------------------------------

def _disegna_grafico(tassi: dict, ieri: date, negozio: str, percorso) -> None:
    """Tasso di scarto per reparto di ieri, in %: barre orizzontali con la soglia di ogni reparto."""
    fig, ax = plt.subplots(figsize=(8, 3.6))
    posizioni = list(range(len(REPARTI)))
    valori = [tassi[r] for r in REPARTI]
    soglie = [SOGLIE["scarti"][r]["soglia"] for r in REPARTI]
    colori = [ARANCIONE if v > s else VERDE for v, s in zip(valori, soglie)]

    ax.barh(posizioni, valori, color=colori, height=0.55)
    massimo = max(valori + soglie) * 1.25

    for y, valore, soglia in zip(posizioni, valori, soglie):
        # Linea tratteggiata della soglia del reparto, all'altezza della sua barra
        ax.vlines(soglia, y - 0.38, y + 0.38, colors=GRIGIO_SOGLIA, linestyles="--", linewidth=1.4)
        # Asse y invertito: va="top" mette la scritta sotto la fine della linea, senza sovrapporla
        ax.text(soglia, y + 0.40, f"soglia {_numero_it(soglia, 1)}%", ha="center", va="top",
                fontsize=8, color=GRIGIO_SOGLIA)
        # Etichetta con il valore alla fine della barra
        ax.text(valore + massimo * 0.01, y, f"{_numero_it(valore)}%", va="center", fontsize=10)

    ax.set_yticks(posizioni, [r.capitalize() for r in REPARTI])
    # Asse invertito (ortofrutta in alto) con margine in basso per la scritta della soglia
    ax.set_ylim(len(REPARTI) - 0.25, -0.6)
    ax.set_xlim(0, massimo)
    ax.set_xlabel("Tasso di scarto (% delle vendite del reparto)")
    ax.set_title(f"Tasso di scarto per reparto – {negozio}, {_data_it(ieri)}")
    for lato in ("top", "right"):
        ax.spines[lato].set_visible(False)
    fig.tight_layout()
    fig.savefig(percorso, dpi=110)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Funzione principale
# ---------------------------------------------------------------------------

def prepara_briefing(df: pd.DataFrame, negozio: str, oggi: date, percorso_grafico=None) -> dict:
    """Calcola KPI di ieri e anomalie per il negozio. Se indicato, salva il grafico in percorso_grafico.

    Solleva ValueError se non ci sono dati del negozio per ieri.
    """
    ieri = oggi - timedelta(days=1)

    # Serie giornaliera del negozio, indicizzata per data (bastano le ultime settimane)
    righe = df[(df["negozio"] == negozio) & (df["data"].dt.date >= ieri - timedelta(days=21))
               & (df["data"].dt.date <= ieri)].copy()
    righe["giorno"] = righe["data"].dt.date
    serie = righe.set_index("giorno").sort_index()

    if ieri not in serie.index:
        raise ValueError(f"Nessun dato disponibile per il negozio {negozio} il {_data_it(ieri)}.")

    r = serie.loc[ieri]
    tassi = {rep: round(float(_tasso_scarto(serie, rep)[ieri]), 2) for rep in REPARTI}

    kpi = {
        "negozio": negozio,
        "data": ieri.isoformat(),
        "giorno_settimana": GIORNI[ieri.weekday()],
        "vendite": round(float(r["vendite_totali"]), 2),
        "obiettivo": round(float(r["obiettivo_vendite"]), 2),
        "scostamento_pct": round(float((r["vendite_totali"] - r["obiettivo_vendite"]) / r["obiettivo_vendite"] * 100), 2),
        "scontrini": int(r["numero_scontrini"]),
        "scontrino_medio": round(float(r["vendite_totali"] / r["numero_scontrini"]), 2),
        "tasso_scarto": {rep: {"valore": tassi[rep], "soglia": SOGLIE["scarti"][rep]["soglia"]} for rep in REPARTI},
        "referenze_in_rottura": int(r["referenze_in_rottura"]),
        "consegne_in_ritardo": int(r["consegne_in_ritardo"]),
        "tasso_assenza_pct": round(float(r["ore_assenza"] / r["ore_pianificate"] * 100), 2),
    }

    anomalie = (_controlla_scarti(serie, ieri) + _controlla_rotture(serie, ieri)
                + _controlla_consegne(serie, ieri) + _controlla_assenze(serie, ieri))

    if percorso_grafico is not None:
        _disegna_grafico(tassi, ieri, negozio, percorso_grafico)

    controlli = _stato_controlli(serie, ieri, anomalie)
    return {"kpi": kpi, "controlli": controlli, "anomalie": anomalie}
