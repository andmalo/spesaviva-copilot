"""Date di riferimento di uno scenario della demo: l'unico punto in cui si calcolano.

Il back end le chiede al data agent (GET /scenari/{id}/date) invece di calcolarle:
così orchestratore e data agent usano sempre le stesse date.

Regole (a partire da "oggi" dello scenario, in backend/scenari.json):
- ieri: oggi meno 1 giorno (i dati arrivano fino a ieri);
- inizio settimana: ieri meno 6 giorni ("questa settimana" = gli ultimi 7 giorni, ieri compreso);
- mese corrente: il mese di ieri, completo se ieri è l'ultimo giorno del mese;
- ultima settimana completa: l'ultima settimana lunedì-domenica che finisce entro ieri.
"""

from datetime import date, timedelta

from briefing import GIORNI, MESI, ultima_settimana_completa


def date_scenario(scenario: dict) -> tuple[date, date]:
    """(oggi, ieri) dello scenario."""
    oggi = date.fromisoformat(scenario["oggi"])
    return oggi, oggi - timedelta(days=1)


def data_estesa(giorno: date) -> str:
    """Data per esteso con il giorno della settimana, es. 'martedì 1 settembre 2026'."""
    return f"{GIORNI[giorno.weekday()]} {giorno.day} {MESI[giorno.month - 1]} {giorno.year}"


def descrivi_mese(ieri: date) -> str:
    """Il mese di "ieri": completo se ieri è l'ultimo giorno del mese, altrimenti in corso."""
    mese = f"{MESI[ieri.month - 1]} {ieri.year}"
    if (ieri + timedelta(days=1)).month != ieri.month:
        return f"{mese}, l'ultimo mese completo nei dati"
    return f"{mese}, il mese in corso (dati dal 1 al {ieri.day} {mese})"


def date_riferimento(scenario: dict) -> dict:
    """Tutte le date di riferimento dello scenario, in AAAA-MM-GG e per esteso in italiano."""
    oggi, ieri = date_scenario(scenario)
    inizio_settimana = ieri - timedelta(days=6)
    dal, al = ultima_settimana_completa(ieri)
    return {
        "oggi": oggi.isoformat(),
        "ieri": ieri.isoformat(),
        "inizio_settimana": inizio_settimana.isoformat(),
        "mese_corrente": descrivi_mese(ieri),
        "ultima_settimana_completa": {"inizio": dal.isoformat(), "fine": al.isoformat()},
        "oggi_esteso": data_estesa(oggi),
        "ieri_esteso": data_estesa(ieri),
        "inizio_settimana_esteso": data_estesa(inizio_settimana),
    }
