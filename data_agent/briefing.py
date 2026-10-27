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

from grafici import ARANCIONE, BLOCCO_GRAFICI, GRIGIO_SOGLIA, VERDE

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
    # Riconoscimento di squadra (regola interna del progetto, non del manuale):
    # tasso di scarto mensile di un reparto almeno il 10% sotto il riferimento
    # per 2 mesi consecutivi; riferimento = tasso dello STESSO mese dell'anno
    # prima, così la stagionalità (es. ortofrutta più alta d'estate) non crea
    # falsi miglioramenti. Con la media dei 6 mesi precedenti comparivano 20
    # falsi riconoscimenti di ortofrutta in autunno-inverno.
    "miglioramento_riduzione_pct": 10.0,
    "miglioramento_mesi_consecutivi": 2,
    "miglioramento_mesi_confronto": 12,  # stesso mese, un anno prima
}

REPARTI = ["ortofrutta", "panetteria", "freschi"]
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
        "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
GIORNI = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]


# ---------------------------------------------------------------------------
# Funzioni di supporto
# ---------------------------------------------------------------------------

def _regole_soglie() -> list[str]:
    """Descrizione delle regole dei controlli, scritta dal codice a partire da SOGLIE."""
    s = SOGLIE
    return [
        "Tasso di scarto di un reparto = scarti del reparto / vendite del reparto × 100, giorno per giorno.",
        *(f"Scarto {r}: soglia {_numero_it(v['soglia'], 1)}%; oltre {_numero_it(v['doppio_normale'], 1)}% = doppio del valore normale."
          for r, v in s["scarti"].items()),
        f"Azioni obbligatorie: scarto sopra soglia per almeno {s['scarti_giorni_azioni']} giorni consecutivi.",
        f"Da comunicare all'Area Manager: scarto oltre il doppio del normale in un giorno, oppure sopra soglia "
        f"per {s['scarti_giorni_area_manager']} giorni consecutivi.",
        f"Rotture di stock: più di {s['rotture_limite']} referenze in rottura per {s['rotture_giorni']} giorni consecutivi.",
        f"Consegne in ritardo: {s['consegne_ritardo_settimana']} o più nella stessa settimana (da lunedì a domenica).",
        f"Assenze: ore di assenza / ore pianificate × 100 oltre il {_numero_it(s['assenze_settimana_pct'], 0)}% nella settimana.",
    ]


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


def _tassi_scarto(righe: pd.DataFrame) -> tuple[dict, float]:
    """Tasso di scarto di un periodo, per reparto e complessivo (rapporto dei totali), in %."""
    tassi = {r: round(float(righe[f"scarti_{r}"].sum() / righe[f"vendite_{r}"].sum() * 100), 2) for r in REPARTI}
    scarti = sum(float(righe[f"scarti_{r}"].sum()) for r in REPARTI)
    vendite = sum(float(righe[f"vendite_{r}"].sum()) for r in REPARTI)
    return tassi, round(scarti / vendite * 100, 2)


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
# Controlli delle soglie, su un periodo qualsiasi
# ---------------------------------------------------------------------------

# Giorni prima del periodo usati per contare le serie di giorni consecutivi
# (lo stesso storico che il briefing ha sempre usato: 21 giorni prima di ieri)
GIORNI_STORICO = 21


def _serie_giornaliera(df: pd.DataFrame, negozio: str, da: date, a: date) -> pd.DataFrame:
    """Righe del negozio dal giorno 'da' al giorno 'a', indicizzate per data."""
    righe = df[(df["negozio"] == negozio) & (df["data"].dt.date >= da) & (df["data"].dt.date <= a)].copy()
    righe["giorno"] = righe["data"].dt.date
    return righe.set_index("giorno").sort_index()


def _episodi(condizione: pd.Series, inizio: date, fine: date, min_giorni: int, solo_in_corso: bool) -> list[tuple[date, date, int]]:
    """Serie di giorni consecutivi in cui la condizione è vera, lunghe almeno min_giorni.

    Restituisce (primo giorno, ultimo giorno, numero di giorni) per ogni serie che tocca il periodo.
    Con solo_in_corso conta solo la serie che arriva fino a 'fine' (come fa il briefing per ieri).
    Un giorno senza dati interrompe la serie.
    """
    if solo_in_corso:
        giorni, primo = _giorni_consecutivi(condizione, fine)
        return [(primo, fine, giorni)] if giorni >= min_giorni else []

    episodi = []
    primo, ultimo, lunghezza = None, None, 0
    giorno = condizione.index.min() if len(condizione) else fine
    while giorno <= fine + timedelta(days=1):
        vero = giorno <= fine and giorno in condizione.index and bool(condizione[giorno])
        if vero:
            if lunghezza == 0:
                primo = giorno
            ultimo, lunghezza = giorno, lunghezza + 1
        else:
            if lunghezza >= min_giorni and ultimo >= inizio:
                episodi.append((primo, ultimo, lunghezza))
            lunghezza = 0
        giorno += timedelta(days=1)
    return episodi


def _settimane_del_periodo(inizio: date, fine: date) -> list[tuple[date, date]]:
    """Settimane da lunedì a domenica che toccano il periodo (l'ultima si ferma a 'fine')."""
    settimane = []
    lunedi = inizio - timedelta(days=inizio.weekday())
    while lunedi <= fine:
        settimane.append((lunedi, min(lunedi + timedelta(days=6), fine)))
        lunedi += timedelta(days=7)
    return settimane


def controlla_soglie(df: pd.DataFrame, negozio: str, inizio: date, fine: date, solo_in_corso: bool = False) -> dict:
    """Applica al periodo le stesse regole del briefing (soglie del manuale operativo):
    - scarti: tasso sopra soglia per 3 giorni consecutivi; da comunicare all'Area Manager
      se dura 7 giorni o se un giorno supera il doppio del valore normale;
    - rotture di stock: oltre 60 referenze per 2 giorni consecutivi;
    - consegne in ritardo (3 o più) e assenze (oltre il 10%) per settimana da lunedì a domenica.

    Restituisce i risultati di ogni controllo (anche quando la soglia non è superata).
    Con solo_in_corso si considerano solo le serie che arrivano fino a 'fine' (modalità del briefing).
    """
    da = (fine if solo_in_corso else inizio) - timedelta(days=GIORNI_STORICO)
    serie = _serie_giornaliera(df, negozio, da, fine)

    scarti, doppio = {}, {}
    for reparto in REPARTI:
        soglie = SOGLIE["scarti"][reparto]
        tassi = _tasso_scarto(serie, reparto)
        scarti[reparto] = [
            {"dal": p, "al": u, "giorni": g, "tasso_ultimo_giorno": float(tassi[u]), "soglia": soglie["soglia"]}
            for p, u, g in _episodi(tassi > soglie["soglia"], inizio, fine, 1, solo_in_corso)
        ]
        giorni_doppio = [fine] if solo_in_corso else [g for g in tassi.index if inizio <= g <= fine]
        doppio[reparto] = [
            {"giorno": g, "tasso": float(tassi[g]), "doppio_normale": soglie["doppio_normale"]}
            for g in giorni_doppio if g in tassi.index and tassi[g] > soglie["doppio_normale"]
        ]

    limite = SOGLIE["rotture_limite"]
    rotture = [
        {"dal": p, "al": u, "giorni": g, "valori": serie.loc[p:u, "referenze_in_rottura"].astype(int).tolist()}
        for p, u, g in _episodi(serie["referenze_in_rottura"] > limite, inizio, fine, SOGLIE["rotture_giorni"], solo_in_corso)
    ]

    settimane = []
    for lunedi, ultimo in _settimane_del_periodo(inizio, fine):
        settimana = serie.loc[lunedi:ultimo]
        pianificate = settimana["ore_pianificate"].sum()
        settimane.append({
            "lunedi": lunedi,
            "fine": ultimo,
            "completa": ultimo == lunedi + timedelta(days=6),
            "consegne_in_ritardo": int(settimana["consegne_in_ritardo"].sum()),
            "tasso_assenze": float(settimana["ore_assenza"].sum() / pianificate * 100) if pianificate > 0 else None,
        })

    return {"negozio": negozio, "inizio": inizio, "fine": fine,
            "scarti": scarti, "scarti_oltre_doppio": doppio, "rotture": rotture, "settimane": settimane}


def testo_soglie(esito: dict) -> str:
    """Testo compatto dei controlli, per l'LLM: per ogni controllo valore, soglia, periodo ed esito."""
    s, righe = SOGLIE, [f"Controllo delle soglie del manuale, negozio {esito['negozio']}, "
                         f"{_periodo_it(esito['inizio'], esito['fine'])}:"]
    for reparto in REPARTI:
        soglia = _numero_it(s["scarti"][reparto]["soglia"], 1)
        lunghi = [e for e in esito["scarti"][reparto] if e["giorni"] >= s["scarti_giorni_azioni"]]
        if lunghi:
            for e in lunghi:
                am = " Da comunicare all'Area Manager (7 giorni o più)." if e["giorni"] >= s["scarti_giorni_area_manager"] else ""
                righe.append(f"- Scarto {reparto}: SOGLIA SUPERATA, sopra il {soglia}% per {e['giorni']} giorni "
                             f"consecutivi ({_periodo_it(e['dal'], e['al'])}; soglia: 3 giorni).{am}")
        else:
            righe.append(f"- Scarto {reparto}: soglia del {soglia}% mai superata per 3 giorni consecutivi.")
        for d in esito["scarti_oltre_doppio"][reparto]:
            righe.append(f"- Scarto {reparto}: {_numero_it(d['tasso'])}% il {_data_it(d['giorno'])}, oltre il "
                         f"{_numero_it(d['doppio_normale'], 1)}% (che è il doppio del valore normale): da comunicare all'Area Manager.")
    if esito["rotture"]:
        for e in esito["rotture"]:
            righe.append(f"- Referenze in rottura: SOGLIA SUPERATA, oltre {s['rotture_limite']} per {e['giorni']} giorni "
                         f"consecutivi ({_periodo_it(e['dal'], e['al'])}; valori {', '.join(map(str, e['valori']))}).")
    else:
        righe.append(f"- Referenze in rottura: mai oltre {s['rotture_limite']} per 2 giorni consecutivi.")
    for w in esito["settimane"]:
        nome = f"settimana {_periodo_it(w['lunedi'], w['fine'])}" + ("" if w["completa"] else " (non completa)")
        c = w["consegne_in_ritardo"]
        esito_c = "SOGLIA RAGGIUNTA" if c >= s["consegne_ritardo_settimana"] else "sotto soglia"
        testo = f"- {nome}: {c} consegne in ritardo (soglia 3 o più: {esito_c})"
        if w["tasso_assenze"] is not None:
            esito_a = "SOGLIA SUPERATA" if w["tasso_assenze"] > s["assenze_settimana_pct"] else "sotto soglia"
            testo += f"; assenze {_numero_it(w['tasso_assenze'])}% delle ore pianificate (soglia 10%: {esito_a})"
        righe.append(testo + ".")
    return "\n".join(righe)


def soglie_superate(esito: dict) -> dict:
    """Quali soglie del manuale risultano superate nel periodo (vero/falso per tipo di controllo)."""
    s = SOGLIE
    return {
        "scarti": any(e["giorni"] >= s["scarti_giorni_azioni"] for ep in esito["scarti"].values() for e in ep),
        "scarti_area_manager": any(e["giorni"] >= s["scarti_giorni_area_manager"] for ep in esito["scarti"].values() for e in ep)
                               or any(esito["scarti_oltre_doppio"].values()),
        "rotture": bool(esito["rotture"]),
        "consegne": any(w["consegne_in_ritardo"] >= s["consegne_ritardo_settimana"] for w in esito["settimane"]),
        "assenze": any(w["tasso_assenze"] is not None and w["tasso_assenze"] > s["assenze_settimana_pct"]
                       for w in esito["settimane"]),
    }


def kpi_periodo(df: pd.DataFrame, negozio: str, inizio: date, fine: date) -> dict:
    """KPI del negozio nel periodo, tutti calcolati dal codice (rapporti dei totali)."""
    righe = df[(df["negozio"] == negozio) & (df["data"].dt.date >= inizio) & (df["data"].dt.date <= fine)]
    if righe.empty:
        raise ValueError(f"Nessun dato per il negozio {negozio} {_periodo_it(inizio, fine)}.")
    vendite, obiettivo = float(righe["vendite_totali"].sum()), float(righe["obiettivo_vendite"].sum())
    scontrini = float(righe["numero_scontrini"].sum())
    return {
        "negozio": negozio,
        "inizio": inizio,
        "fine": fine,
        "giorni_con_dati": int(righe["data"].dt.date.nunique()),
        "vendite": round(vendite, 2),
        "obiettivo": round(obiettivo, 2),
        "scostamento_pct": round((vendite - obiettivo) / obiettivo * 100, 2),
        "scontrini": int(scontrini),
        "scontrino_medio": round(vendite / scontrini, 2),
        "tasso_scarto": _tassi_scarto(righe)[0],
        "eccedenze_donate_kg": round(float(righe["eccedenze_donate_kg"].sum()), 1),
    }


def ultima_settimana_completa(ieri: date) -> tuple[date, date]:
    """Ultima settimana completa (lunedì-domenica) che finisce entro ieri."""
    domenica = ieri if ieri.weekday() == 6 else ieri - timedelta(days=ieri.weekday() + 1)
    return domenica - timedelta(days=6), domenica


def eccedenze_donate(df: pd.DataFrame, negozio: str, ieri: date) -> dict:
    """Chilogrammi di eccedenze donate ieri e nell'ultima settimana completa (solo kg, nessuna conversione)."""
    righe = df[df["negozio"] == negozio]
    giorni = righe["data"].dt.date
    dal, al = ultima_settimana_completa(ieri)
    settimana = righe[(giorni >= dal) & (giorni <= al)]
    return {
        "ieri": round(float(righe.loc[giorni == ieri, "eccedenze_donate_kg"].sum()), 1),
        "settimana": round(float(settimana["eccedenze_donate_kg"].sum()), 1),
        "settimana_dal": dal.isoformat(),
        "settimana_al": al.isoformat(),
        "giorni_con_dati": int(settimana["data"].dt.date.nunique()),
    }


def testo_kpi(kpi: dict) -> str:
    """Testo compatto dei KPI del periodo, per l'LLM."""
    scarti = ", ".join(f"{r} {_numero_it(v)}% (soglia {_numero_it(SOGLIE['scarti'][r]['soglia'], 1)}%)"
                       for r, v in kpi["tasso_scarto"].items())
    # Separatori italiani: punto per le migliaia, virgola per i decimali
    euro = lambda n: f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " €"
    intero = lambda n: f"{n:,}".replace(",", ".")
    righe = [
        f"KPI del negozio {kpi['negozio']}, {_periodo_it(kpi['inizio'], kpi['fine'])} ({kpi['giorni_con_dati']} giorni con dati):",
        f"- vendite {euro(kpi['vendite'])} contro un obiettivo di {euro(kpi['obiettivo'])} "
        f"(scostamento {_numero_it(kpi['scostamento_pct'])}%)",
        f"- scontrini {intero(kpi['scontrini'])}, scontrino medio {euro(kpi['scontrino_medio'])}",
        f"- tasso di scarto per reparto: {scarti}",
        f"- eccedenze donate: {_numero_it(kpi['eccedenze_donate_kg'], 1)} kg",
    ]
    return "\n".join(righe)


def _anomalie_del_briefing(esito: dict, ieri: date) -> list[dict]:
    """Anomalie del briefing, con le stesse frasi di sempre, a partire dai controlli di controlla_soglie."""
    anomalie = []
    for reparto in REPARTI:
        soglie = SOGLIE["scarti"][reparto]
        serie_in_corso = esito["scarti"][reparto]           # al massimo una, quella che arriva a ieri
        giorni = serie_in_corso[0]["giorni"] if serie_in_corso else 0
        primo = serie_in_corso[0]["dal"] if serie_in_corso else None
        oltre = esito["scarti_oltre_doppio"][reparto]
        tasso_ieri = serie_in_corso[0]["tasso_ultimo_giorno"] if serie_in_corso else (oltre[0]["tasso"] if oltre else None)

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
        oltre_doppio = bool(oltre)
        sette_giorni = giorni >= SOGLIE["scarti_giorni_area_manager"]
        if oltre_doppio or sette_giorni:
            motivi = []
            if oltre_doppio:
                motivi.append(f"ieri {_numero_it(tasso_ieri)}%, oltre il {_numero_it(soglie['doppio_normale'], 1)}% "
                              f"(che è il doppio del valore normale)")
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

    limite = SOGLIE["rotture_limite"]
    for e in esito["rotture"]:
        valori = e["valori"]
        anomalie.append({
            "tipo": "rotture_di_stock",
            "reparto": None,
            "valore": f"{' e '.join(str(v) for v in valori[-2:])} referenze negli ultimi 2 giorni (sopra 60 da {e['giorni']} giorni)",
            "soglia": f"oltre {limite} referenze per {SOGLIE['rotture_giorni']} giorni consecutivi",
            "periodo": _periodo_it(e["dal"], ieri),
            "testo": f"Referenze in rottura oltre {limite} per {e['giorni']} giorni consecutivi (ieri {valori[-1]}).",
            "domanda_procedura": "Cosa fare se le referenze in rottura superano 60 per 2 giorni consecutivi",
            "area_manager": False,
        })

    # Settimane nell'ordine del briefing: prima quella in corso, poi la precedente
    lunedi_in_corso = ieri - timedelta(days=ieri.weekday())
    settimane = sorted(esito["settimane"], key=lambda w: w["lunedi"] != lunedi_in_corso)
    nomi = {w["lunedi"]: ("settimana in corso" if w["lunedi"] == lunedi_in_corso else "settimana precedente") for w in settimane}

    for w in settimane:
        totale, nome = w["consegne_in_ritardo"], nomi[w["lunedi"]]
        if totale >= SOGLIE["consegne_ritardo_settimana"]:
            anomalie.append({
                "tipo": "consegne_in_ritardo",
                "reparto": None,
                "valore": f"{totale} consegne in ritardo",
                "soglia": f"{SOGLIE['consegne_ritardo_settimana']} o più nella stessa settimana",
                "periodo": f"{nome}, {_periodo_it(w['lunedi'], w['fine'])}",
                "testo": f"{totale} consegne in ritardo nella {nome} ({_periodo_it(w['lunedi'], w['fine'])}).",
                "domanda_procedura": "Cosa fare se ci sono 3 o più consegne in ritardo nella stessa settimana",
                "area_manager": False,
            })
    for w in settimane:
        tasso, nome = w["tasso_assenze"], nomi[w["lunedi"]]
        if tasso is not None and tasso > SOGLIE["assenze_settimana_pct"]:
            anomalie.append({
                "tipo": "assenze",
                "reparto": None,
                "valore": f"{_numero_it(tasso)}% delle ore pianificate",
                "soglia": f"oltre il {_numero_it(SOGLIE['assenze_settimana_pct'], 0)}% nella settimana",
                "periodo": f"{nome}, {_periodo_it(w['lunedi'], w['fine'])}",
                "testo": f"Assenze al {_numero_it(tasso)}% delle ore pianificate nella {nome} ({_periodo_it(w['lunedi'], w['fine'])}).",
                "domanda_procedura": "Cosa fare se le assenze superano il 10% delle ore pianificate nella settimana",
                "area_manager": False,
            })
    return anomalie


# ---------------------------------------------------------------------------
# Riconoscimenti: miglioramenti duraturi del tasso di scarto
# ---------------------------------------------------------------------------

def _mese_it(periodo: pd.Period) -> str:
    """Mese per esteso, es. 'agosto 2026'."""
    return f"{MESI[periodo.month - 1]} {periodo.year}"


def _a_mese(nome_mese: str) -> str:
    """Preposizione davanti al mese: "ad agosto", "ad aprile", ma "a luglio"."""
    return f"ad {nome_mese}" if nome_mese[0] in "aeiou" else f"a {nome_mese}"


def ultimo_mese_completo(ieri: date) -> pd.Period:
    """L'ultimo mese che finisce entro ieri (se ieri è l'ultimo giorno del mese, è il mese di ieri)."""
    mese_di_ieri = pd.Period(ieri, freq="M")
    return mese_di_ieri if ieri == mese_di_ieri.end_time.date() else mese_di_ieri - 1


def _totali_mensili(df: pd.DataFrame, negozio: str) -> pd.DataFrame:
    """Vendite e scarti per reparto, sommati per mese, per un negozio."""
    righe = df[df["negozio"] == negozio]
    colonne = [f"{tipo}_{r}" for r in REPARTI for tipo in ("vendite", "scarti")]
    return righe.groupby(righe["data"].dt.to_period("M"))[colonne].sum()


def controlla_miglioramenti(df: pd.DataFrame, negozio: str, ultimo_mese: pd.Period) -> list[dict]:
    """Riconoscimenti per i reparti il cui tasso di scarto mensile è almeno il 10% sotto il
    riferimento nei 2 mesi consecutivi che terminano con ultimo_mese. Solo pandas, nessun LLM.

    Tasso mensile = scarti del mese / vendite del mese dello stesso reparto (rapporto dei totali).
    Riferimento di ogni mese = tasso dello stesso mese dell'anno prima (confronto destagionalizzato).
    """
    n_mesi = SOGLIE["miglioramento_mesi_consecutivi"]
    distanza = SOGLIE["miglioramento_mesi_confronto"]
    riduzione = SOGLIE["miglioramento_riduzione_pct"]

    mesi = [ultimo_mese - i for i in range(n_mesi - 1, -1, -1)]   # es. luglio, agosto 2026
    mesi_rif = [m - distanza for m in mesi]                        # es. luglio, agosto 2025
    totali = _totali_mensili(df, negozio)
    if any(m not in totali.index for m in mesi + mesi_rif):
        return []  # dati insufficienti (serve un anno di storico): nessun riconoscimento

    riconoscimenti = []
    for reparto in REPARTI:
        vendite = totali[f"vendite_{reparto}"]
        scarti = totali[f"scarti_{reparto}"]
        tassi = scarti / vendite * 100
        tassi_mesi = [float(tassi[m]) for m in mesi]
        riferimenti = [float(tassi[m]) for m in mesi_rif]
        variazioni = [(v - r) / r * 100 for v, r in zip(tassi_mesi, riferimenti)]
        if not all(v <= -riduzione for v in variazioni):
            continue

        # Euro risparmiati: scarti che ci sarebbero stati al tasso dell'anno prima, meno quelli reali
        risparmio = sum((r - v) / 100 * float(vendite[m]) for v, r, m in zip(tassi_mesi, riferimenti, mesi))
        # Riferimento e variazione complessivi dei due mesi (rapporto dei totali)
        riferimento = float(scarti[mesi_rif].sum() / vendite[mesi_rif].sum() * 100)
        tasso_periodo = float(scarti[mesi].sum() / vendite[mesi].sum() * 100)
        variazione_periodo = (tasso_periodo - riferimento) / riferimento * 100
        nomi_mesi = [_mese_it(m) for m in mesi]
        nomi_rif = [_mese_it(m) for m in mesi_rif]
        riconoscimenti.append({
            "reparto": reparto,
            "mesi": nomi_mesi,
            "tassi": [round(v, 2) for v in tassi_mesi],
            "riferimenti": [round(r, 2) for r in riferimenti],
            "riferimento": round(riferimento, 2),
            "periodo_riferimento": f"{nomi_rif[0]} e {nomi_rif[1]}",
            "variazioni_pct": [round(v, 1) for v in variazioni],
            "variazione_pct": round(variazione_periodo, 1),
            "euro_risparmiati": round(risparmio, 2),
            "testo": (f"Scarto di {reparto} al {_numero_it(tassi_mesi[0])}% {_a_mese(nomi_mesi[0])} e al "
                      f"{_numero_it(tassi_mesi[1])}% {_a_mese(nomi_mesi[1])}, contro il {_numero_it(riferimento)}% "
                      f"degli stessi mesi dell'anno prima ({nomi_rif[0]} e {nomi_rif[1]}, "
                      f"{_numero_it(variazione_periodo, 1)}%): circa {_numero_it(risparmio, 0)} € di scarti in meno."),
        })
    return riconoscimenti


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
    # pyplot non è thread-safe: un grafico alla volta (le richieste girano in thread diversi)
    with BLOCCO_GRAFICI:
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
    serie = _serie_giornaliera(df, negozio, ieri - timedelta(days=GIORNI_STORICO), ieri)
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
        "eccedenze_donate_kg": eccedenze_donate(df, negozio, ieri),
    }

    # Controlli delle soglie: le stesse regole di controlla_soglie, sulle serie che arrivano fino a ieri.
    # Settimane controllate: quella in corso e, se ieri era lunedì, anche la precedente completa.
    inizio_controlli = ieri - timedelta(days=7) if ieri.weekday() == 0 else ieri
    anomalie = _anomalie_del_briefing(controlla_soglie(df, negozio, inizio_controlli, ieri, solo_in_corso=True), ieri)

    if percorso_grafico is not None:
        _disegna_grafico(tassi, ieri, negozio, percorso_grafico)

    controlli = _stato_controlli(serie, ieri, anomalie)
    # Riconoscimenti: sull'ultimo mese completo, separati dalle anomalie
    riconoscimenti = controlla_miglioramenti(df, negozio, ultimo_mese_completo(ieri))
    return {"kpi": kpi, "controlli": controlli, "anomalie": anomalie, "riconoscimenti": riconoscimenti}


# ---------------------------------------------------------------------------
# Regole mostrate in "Come l'ho calcolato" (fisse, scritte qui nel codice: nessun LLM)
# ---------------------------------------------------------------------------

REGOLE_SOGLIE = "\n".join([
    "Calcolo deterministico con pandas, senza modello linguistico, sui dati puliti del negozio nel periodo richiesto.",
    *("- " + r for r in _regole_soglie()),
    "KPI del periodo: vendite e obiettivo sommati; scostamento = (vendite - obiettivo) / obiettivo × 100; "
    "scontrino medio = vendite / scontrini; eccedenze donate = somma dei kg.",
])

REGOLE_BRIEFING = "\n".join([
    "Calcolo deterministico con pandas, senza modello linguistico, sui dati di ieri e delle settimane precedenti.",
    "KPI di ieri: scostamento = (vendite - obiettivo) / obiettivo × 100; scontrino medio = vendite / scontrini; "
    "tasso di assenza = ore di assenza / ore pianificate × 100.",
    *("- " + r for r in _regole_soglie()),
    "Le anomalie si segnalano solo se la serie arriva fino a ieri; le settimane controllate sono quella in corso "
    "e, se ieri era lunedì, anche quella precedente.",
    "Eccedenze donate: kg di ieri e somma dei kg dell'ultima settimana completa (da lunedì a domenica).",
    f"Riconoscimenti: tasso di scarto mensile di un reparto almeno il "
    f"{_numero_it(SOGLIE['miglioramento_riduzione_pct'], 0)}% sotto lo stesso mese dell'anno prima, "
    f"per {SOGLIE['miglioramento_mesi_consecutivi']} mesi completi consecutivi.",
])


# ---------------------------------------------------------------------------
# Confronto tra negozi: tassi di scarto (rapporti, mai valori assoluti)
# ---------------------------------------------------------------------------

def confronta_negozi(df: pd.DataFrame, negozio: str, inizio: date, fine: date) -> dict:
    """Confronta i tassi di scarto del negozio con quelli degli altri negozi nel periodo.

    I negozi hanno dimensioni diverse: si confrontano solo rapporti (scarti / vendite dello
    stesso reparto), mai euro o kg assoluti. "Altri negozi" = rapporto dei totali di tutti
    gli altri, non la media dei loro tassi. Solleva ValueError se mancano dati.
    """
    righe = df[(df["data"].dt.date >= inizio) & (df["data"].dt.date <= fine)]
    if righe[righe["negozio"] == negozio].empty:
        raise ValueError(f"Nessun dato per il negozio {negozio} {_periodo_it(inizio, fine)}.")
    altri = righe[righe["negozio"] != negozio]
    if altri.empty:
        raise ValueError(f"Nessun dato degli altri negozi {_periodo_it(inizio, fine)}.")

    negozi = []
    for nome, gruppo in righe.groupby("negozio"):
        tassi, totale = _tassi_scarto(gruppo)
        negozi.append({"negozio": nome, "tassi": tassi, "totale": totale,
                       "giorni_con_dati": int(gruppo["data"].dt.date.nunique())})
    negozi.sort(key=lambda n: n["totale"])  # dal tasso più basso al più alto
    tassi_altri, totale_altri = _tassi_scarto(altri)
    posizione = next(i for i, n in enumerate(negozi, start=1) if n["negozio"] == negozio)

    # Reparti con il tasso medio del periodo sopra la soglia del manuale (che è giornaliera):
    # non è un'anomalia secondo il manuale, ma un valore fuori scala da guardare
    sopra_soglia = [
        {"negozio": n["negozio"], "reparto": r, "tasso": n["tassi"][r], "soglia": SOGLIE["scarti"][r]["soglia"]}
        for n in negozi for r in REPARTI if n["tassi"][r] > SOGLIE["scarti"][r]["soglia"]
    ]
    return {
        "negozio": negozio, "inizio": inizio, "fine": fine,
        "negozi": negozi,
        "altri_negozi": {"tassi": tassi_altri, "totale": totale_altri, "numero": len(negozi) - 1},
        "posizione": posizione,
        "sopra_soglia": sopra_soglia,
    }


def testo_confronto(c: dict) -> str:
    """Testo compatto del confronto, per l'LLM (numeri già calcolati, da riportare così come sono)."""
    p = lambda v: f"{_numero_it(v)}%"
    mio = next(n for n in c["negozi"] if n["negozio"] == c["negozio"])
    altri = c["altri_negozi"]
    righe = [
        f"Confronto dei tassi di scarto (scarti / vendite dello stesso reparto), {_periodo_it(c['inizio'], c['fine'])}:",
        f"- {c['negozio']}: complessivo {p(mio['totale'])}; "
        + ", ".join(f"{r} {p(v)}" for r, v in mio["tassi"].items()),
        f"- altri {altri['numero']} negozi insieme: complessivo {p(altri['totale'])}; "
        + ", ".join(f"{r} {p(v)}" for r, v in altri["tassi"].items()),
        f"- differenza del complessivo: {_numero_it(mio['totale'] - altri['totale'])} punti percentuali "
        f"({'più basso' if mio['totale'] < altri['totale'] else 'più alto' if mio['totale'] > altri['totale'] else 'uguale'} degli altri negozi)",
        f"- posizione di {c['negozio']}: {c['posizione']}° su {len(c['negozi'])} (1° = tasso complessivo più basso)",
        "Tutti i negozi, dal tasso complessivo più basso al più alto:",
        *(f"  {i}. {n['negozio']} {p(n['totale'])} (" + ", ".join(f"{r} {p(v)}" for r, v in n["tassi"].items()) + ")"
          for i, n in enumerate(c["negozi"], start=1)),
    ]
    if c["sopra_soglia"]:
        righe.append("Reparti con il tasso medio del periodo sopra la soglia giornaliera del manuale "
                     "(valore fuori scala, non un'anomalia del manuale):")
        righe += [f"  - {s['negozio']} {s['reparto']} {p(s['tasso'])} (soglia {_numero_it(s['soglia'], 1)}%)"
                  for s in c["sopra_soglia"]]
    return "\n".join(righe)


REGOLE_CONFRONTO = "\n".join([
    "Calcolo deterministico con pandas, senza modello linguistico, su tutti i negozi nel periodo richiesto.",
    "- Tasso di scarto di un reparto = scarti del reparto / vendite del reparto × 100, sommando i giorni del periodo.",
    "- Tasso complessivo = scarti dei tre reparti / vendite dei tre reparti × 100.",
    "- Altri negozi = rapporto dei totali di tutti gli altri negozi insieme (non la media dei loro tassi).",
    "- Si confrontano solo rapporti, mai euro o kg: i negozi hanno dimensioni diverse.",
    "- Posizione: negozi ordinati dal tasso complessivo più basso al più alto.",
    "- Reparti segnalati: tasso medio del periodo sopra la soglia giornaliera del manuale.",
])
