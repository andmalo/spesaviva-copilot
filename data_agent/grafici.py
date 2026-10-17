"""Grafici del data agent disegnati dal codice.

L'agente sceglie i dati del grafico e li mette in un blocco ```json in fondo
alla risposta (la "spec"); questo modulo estrae il blocco, lo valida e lo
disegna sempre con lo stesso stile del grafico del briefing: barre orizzontali,
una sola unità di misura, asse da zero.
"""

import ast
import json
import logging
import math
import re

# Backend "Agg": matplotlib disegna solo su file, senza aprire finestre
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt

# Colori (gli stessi del briefing e del front end)
VERDE = "#1F6B45"        # valori normali
GRIGIO_VERDE = "#A9BBAF"  # termine di confronto
ARANCIONE = "#C2721F"    # barre da evidenziare
GRIGIO_SOGLIA = "#5B625C"

# Unità ammesse e titolo dell'asse dei valori per ciascuna
UNITA = {
    "€": "Euro (€)",
    "%": "Percentuale (%)",
    "scontrini": "Numero di scontrini",
    "referenze": "Numero di referenze",
    "ore": "Ore",
}

# Sinonimi frequenti, ricondotti all'unità ammessa
SINONIMI_UNITA = {"euro": "€", "eur": "€", "percentuale": "%", "percento": "%"}

MAX_VALORI = 12

MAX_CARATTERI_SPEC = 5000  # una spec valida (max 12 valori) è lunga poche centinaia di caratteri

logger = logging.getLogger("data_agent")

# Blocchi ```json ... ``` nella risposta dell'agente
BLOCCO_JSON = re.compile(r"```json\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def estrai_blocco_grafico(testo: str) -> tuple[str, dict | None, str | None]:
    """Cerca l'ultimo blocco ```json nella risposta e lo toglie SEMPRE dal testo.

    Restituisce (testo senza il blocco, spec letta oppure None, motivo se manca o non si legge).
    La spec letta va poi validata da disegna_grafico.
    """
    blocchi = list(BLOCCO_JSON.finditer(testo))
    if blocchi:
        ultimo = blocchi[-1]
        contenuto = ultimo.group(1)
        testo_pulito = (testo[:ultimo.start()] + testo[ultimo.end():]).strip()
    else:
        # Blocco aperto ma non chiuso (es. risposta troncata): si toglie dall'apertura alla fine
        apertura = testo.lower().rfind("```json")
        if apertura == -1:
            return testo.strip(), None, "nessun blocco json nella risposta"
        contenuto = testo[apertura + len("```json"):]
        testo_pulito = testo[:apertura].strip()

    spec = leggi_spec(contenuto)
    if spec is None:
        # Nel motivo (che finisce solo nel log) anche l'inizio del blocco, per capire cosa non va
        return testo_pulito, None, f"il blocco json non si può leggere: {contenuto.strip()[:200]!r}"
    return testo_pulito, spec, None


def leggi_spec(contenuto: str):
    """Legge il contenuto del blocco: prima come JSON, poi in modo tollerante. None se non si legge."""
    try:
        return json.loads(contenuto)
    except json.JSONDecodeError:
        pass

    # Secondo tentativo con ast.literal_eval, che accetta la sintassi dei dizionari Python:
    # virgolette singole, True/False/None e virgole finali, errori frequenti del modello.
    # MAI eval(): eval esegue qualsiasi codice Python, e il testo arriva da un LLM che può
    # essere manipolato (prompt injection). literal_eval valuta SOLO valori letterali
    # (stringhe, numeri, liste, dizionari, booleani): niente chiamate a funzioni, import o nomi.
    # Il limite di lunghezza evita input enormi o annidati all'eccesso.
    if len(contenuto) > MAX_CARATTERI_SPEC:
        return None
    try:
        return ast.literal_eval(contenuto.strip())
    except (ValueError, SyntaxError, TypeError, MemoryError, RecursionError):
        return None


def _e_numero(valore) -> bool:
    """Vero per int e float finiti (i booleani non contano come numeri)."""
    return isinstance(valore, (int, float)) and not isinstance(valore, bool) and math.isfinite(valore)


def valida_spec(spec) -> tuple[dict | None, str | None]:
    """Controlla la spec prima di disegnare.

    Restituisce (spec normalizzata, None) se è valida, altrimenti (None, motivo in italiano).
    """
    if not isinstance(spec, dict):
        return None, "la spec non è un oggetto JSON"

    titolo = spec.get("titolo")
    if not isinstance(titolo, str) or not titolo.strip():
        return None, "manca il titolo"

    unita = spec.get("unita")
    if isinstance(unita, str):
        unita = SINONIMI_UNITA.get(unita.strip().lower(), unita.strip())
    if unita not in UNITA:
        return None, f"unità non ammessa: {spec.get('unita')!r} (ammesse: {', '.join(UNITA)})"

    etichette = spec.get("etichette")
    valori = spec.get("valori")
    if not isinstance(etichette, list) or not isinstance(valori, list):
        return None, "etichette e valori devono essere liste"
    if len(etichette) != len(valori):
        return None, f"liste di lunghezza diversa ({len(etichette)} etichette, {len(valori)} valori)"
    if not 1 <= len(valori) <= MAX_VALORI:
        return None, f"servono da 1 a {MAX_VALORI} valori (ricevuti {len(valori)})"
    if not all(isinstance(e, str) and e.strip() for e in etichette):
        return None, "ogni etichetta deve essere un testo non vuoto"
    if len(set(etichette)) != len(etichette):
        return None, "ci sono etichette ripetute"
    if not all(_e_numero(v) for v in valori):
        return None, "tutti i valori devono essere numeri finiti"
    if any(v < 0 for v in valori):
        return None, "ci sono valori negativi"
    if unita == "%" and any(v > 100 for v in valori):
        return None, "con unità % nessun valore può superare 100"

    # Liste facoltative: le etichette che non compaiono nel grafico vengono ignorate
    # (servono solo a scegliere il colore delle barre, non rendono il grafico sbagliato)
    elenchi = {}
    for chiave in ("evidenzia", "confronto"):
        elenco = spec.get(chiave) or []
        if isinstance(elenco, str):
            elenco = [elenco]  # una sola etichetta scritta come testo: la si accetta come lista
        if not isinstance(elenco, list):
            # Tipo sbagliato (es. true o un numero): si ignora il campo e il grafico si disegna lo stesso
            logger.warning("Campo '%s' ignorato nel grafico: non è una lista di etichette (%r)", chiave, elenco)
            elenco = []
        elenchi[chiave] = [e for e in elenco if e in etichette]

    soglia = spec.get("soglia")
    if soglia is not None:
        if not _e_numero(soglia) or soglia < 0:
            return None, "la soglia deve essere un numero non negativo"
        if unita == "%" and soglia > 100:
            return None, "con unità % la soglia non può superare 100"

    return {
        "titolo": titolo.strip(),
        "unita": unita,
        "etichette": [e.strip() for e in etichette],
        "valori": [float(v) for v in valori],
        "evidenzia": elenchi["evidenzia"],
        "confronto": elenchi["confronto"],
        "soglia": float(soglia) if soglia is not None else None,
    }, None


def _formatta(valore: float, unita: str) -> str:
    """Valore con l'unità, all'italiana: 25.191,63 €, 7,02%, 1.034 scontrini."""
    if unita in ("€", "%"):
        testo = f"{valore:,.2f}"
    elif valore == int(valore):
        testo = f"{int(valore):,}"
    else:
        testo = f"{valore:,.1f}"
    # Separatori italiani: punto per le migliaia, virgola per i decimali
    testo = testo.replace(",", "X").replace(".", ",").replace("X", ".")
    if unita == "%":
        return f"{testo}%"
    return f"{testo} {unita}"


def disegna_grafico(spec, percorso) -> tuple[bool, str | None]:
    """Valida la spec e, se è valida, salva il grafico in percorso.

    Restituisce (True, None) se il grafico è stato creato, altrimenti (False, motivo).
    """
    spec_valida, motivo = valida_spec(spec)
    if spec_valida is None:
        return False, motivo

    etichette = spec_valida["etichette"]
    valori = spec_valida["valori"]
    unita = spec_valida["unita"]
    soglia = spec_valida["soglia"]

    colori = []
    for etichetta in etichette:
        if etichetta in spec_valida["evidenzia"]:
            colori.append(ARANCIONE)
        elif etichetta in spec_valida["confronto"]:
            colori.append(GRIGIO_VERDE)
        else:
            colori.append(VERDE)

    # Altezza proporzionale al numero di barre
    fig, ax = plt.subplots(figsize=(8, 1.4 + 0.55 * len(valori)))
    posizioni = list(range(len(valori)))
    ax.barh(posizioni, valori, color=colori, height=0.6)

    riferimento = max(valori + ([soglia] if soglia is not None else []))
    massimo = riferimento * 1.3 if riferimento > 0 else 1

    # Etichetta con il valore alla fine di ogni barra
    for y, valore in zip(posizioni, valori):
        ax.text(valore + massimo * 0.01, y, _formatta(valore, unita), va="center", fontsize=10)

    # Linea tratteggiata della soglia, se presente
    if soglia is not None:
        ax.axvline(soglia, color=GRIGIO_SOGLIA, linestyle="--", linewidth=1.4)
        ax.text(soglia, -0.7, f"soglia {_formatta(soglia, unita)}", ha="center", va="bottom",
                fontsize=8, color=GRIGIO_SOGLIA)

    ax.set_yticks(posizioni, etichette)
    # Asse invertito (prima etichetta in alto), con spazio sopra per la scritta della soglia
    ax.set_ylim(len(valori) - 0.4, -0.9 if soglia is not None else -0.6)
    ax.set_xlim(0, massimo)
    ax.set_xlabel(UNITA[unita])
    ax.set_title(spec_valida["titolo"])
    for lato in ("top", "right"):
        ax.spines[lato].set_visible(False)
    fig.tight_layout()
    fig.savefig(percorso, dpi=110)
    plt.close(fig)
    return True, None
