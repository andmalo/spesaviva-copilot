"""Benchmark delle prestazioni della parte pandas del data agent (nessuna chiamata a OpenAI).

Genera dataset di dimensioni crescenti duplicando data/dati_negozi.csv (1×, 10×, 50×, 100×):
ogni copia ha negozi nuovi (copia 2: NEG07-NEG12, copia 3: NEG13-NEG18, ...) e le stesse date,
e resta "sporca" come l'originale (nomi dei negozi incoerenti, tre formati di data, duplicati),
così la pulizia lavora davvero. Per ogni dimensione misura tempo (mediana di N ripetizioni) e picco
di memoria (tracemalloc, in un'esecuzione a parte) di:
(le ripetizioni sono fatte a rotazione su tutte le dimensioni)
caricamento e pulizia, validazione, copia dei dati per una richiesta, briefing, controllo delle soglie,
confronto tra negozi e una tipica analisi pandas (tasso di scarto mensile per reparto).

Scrive docs/benchmark.md (tabelle, sistema, conclusioni) e docs/benchmark.png (grafico).

Uso (dalla cartella principale del progetto, con il .venv attivo):
    python data_agent/benchmark/benchmark.py
    python data_agent/benchmark/benchmark.py --fattori 1,10 --ripetizioni 3   (prova veloce)
"""

import argparse
import gc
import pickle
import platform
import re
import statistics
import subprocess
import sys
import tempfile
import time
import tracemalloc
from datetime import date, datetime
from pathlib import Path

CARTELLA_AGENTE = Path(__file__).resolve().parent.parent
CARTELLA_PROGETTO = CARTELLA_AGENTE.parent
sys.path.insert(0, str(CARTELLA_AGENTE))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import validazione  # noqa: E402
from briefing import confronta_negozi, controlla_soglie, prepara_briefing  # noqa: E402
from pulizia import REPARTI_SCARTI, REPARTI_VENDITE, pulisci_dati  # noqa: E402

PERCORSO_CSV = CARTELLA_PROGETTO / "data" / "dati_negozi.csv"
DOCUMENTO = CARTELLA_PROGETTO / "docs" / "benchmark.md"
GRAFICO = CARTELLA_PROGETTO / "docs" / "benchmark.png"

NEGOZI_PER_COPIA = 6
LIMITE_SECONDI = 1.0
LIMITE_MB = 512  # memoria del piano gratuito di Render

# Scenario "tranquilla" della demo: oggi 1/9/2026, negozio NEG01
OGGI = date(2026, 9, 1)
IERI = date(2026, 8, 31)
NEGOZIO = "NEG01"
SETTIMANA = (date(2026, 8, 24), date(2026, 8, 30))  # ultima settimana completa
MESE = (date(2026, 8, 1), date(2026, 8, 31))        # periodo del confronto tra negozi

OPERAZIONI = [
    ("caricamento", "Caricamento e pulizia"),
    ("validazione", "Validazione"),
    ("copia", "Copia dei dati per una richiesta"),
    ("briefing", "Briefing"),
    ("soglie", "Controllo delle soglie"),
    ("confronto", "Confronto tra negozi"),
    ("analisi", "Tasso di scarto mensile per reparto"),
]

# Palette categoriale di riferimento (skill dataviz), slot in ordine fisso; testi e griglia in toni neutri
COLORI = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"]
SUPERFICIE, TESTO, TESTO_SECONDARIO, GRIGLIA = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

def sposta_negozio(serie: pd.Series, copia: int) -> pd.Series:
    """Rinumera il negozio nel testo originale, mantenendone lo stile ("Negozio 1" -> "Negozio 7")."""
    if copia == 0:
        return serie

    def nuovo(m: re.Match) -> str:
        numero = int(m.group(1)) + NEGOZI_PER_COPIA * copia
        return f"{numero:0{len(m.group(1))}d}{m.group(2)}"

    return serie.astype(str).str.replace(r"(\d+)(\s*)$", nuovo, regex=True)


def genera_dataset(grezzo: pd.DataFrame, fattore: int) -> pd.DataFrame:
    copie = []
    for copia in range(fattore):
        parte = grezzo.copy()
        parte["negozio"] = sposta_negozio(parte["negozio"], copia)
        copie.append(parte)
    return pd.concat(copie, ignore_index=True)


# ---------------------------------------------------------------------------
# Operazioni misurate
# ---------------------------------------------------------------------------

def copia_per_richiesta(dati: bytes, fino_a: date) -> pd.DataFrame:
    """Come nuova_copia_dati() in app.py: copia nuova dai bytes, tagliata a "ieri" dello scenario."""
    df = pickle.loads(dati)
    df = df[df["data"].dt.date <= fino_a].copy()
    parziale = df["settimana"].notna() & ((df["settimana"] + pd.Timedelta(days=6)).dt.date > fino_a)
    df.loc[parziale, "settimana"] = pd.NaT
    return df.reset_index(drop=True)


def tasso_scarto_mensile(df: pd.DataFrame) -> pd.DataFrame:
    """Tipica analisi pandas: tasso di scarto mensile per reparto (scarti / vendite × 100), tutti i negozi."""
    mese = df["data"].dt.to_period("M")
    somme = df.groupby(mese)[REPARTI_SCARTI + REPARTI_VENDITE].sum()
    return pd.DataFrame({
        s.removeprefix("scarti_"): somme[s] / somme[v] * 100 for s, v in zip(REPARTI_SCARTI, REPARTI_VENDITE)
    })


def un_tempo(funzione) -> float:
    gc.collect()
    inizio = time.perf_counter()
    funzione()
    return time.perf_counter() - inizio


def picco_memoria(funzione) -> float:
    """Picco di memoria in MB con tracemalloc (in un'esecuzione a parte: tracemalloc rallenta)."""
    gc.collect()
    tracemalloc.start()
    funzione()
    _, picco = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return picco / 1024 ** 2


def prepara_dimensione(grezzo: pd.DataFrame, fattore: int, cartella: Path) -> dict:
    """Dataset di una dimensione e le funzioni da misurare (già pronte, sulla copia per una richiesta)."""
    dataset = genera_dataset(grezzo, fattore)
    percorso = cartella / f"dati_{fattore}x.csv"
    dataset.to_csv(percorso, index=False)
    righe = len(dataset)
    del dataset

    df, report = pulisci_dati(pd.read_csv(percorso))
    grezzo_letto = pd.read_csv(percorso)
    dati = pickle.dumps(df)
    copia = copia_per_richiesta(dati, IERI)
    negozi_ammessi = {f"NEG{n:02d}" for n in range(1, NEGOZI_PER_COPIA * fattore + 1)}
    grafico = cartella / f"briefing_{fattore}x.png"

    def valida():
        # Stessi controlli della validazione, con l'elenco dei negozi esteso a quelli generati
        validazione.NEGOZI_AMMESSI = negozi_ammessi
        validazione.controlla_struttura(grezzo_letto)
        validazione.controlla_valori(df, report, len(grezzo_letto), oggi=date(2026, 11, 13))

    return {
        "fattore": fattore, "righe_csv": righe, "righe_pulite": len(df), "negozi": df["negozio"].nunique(),
        "mb_dataframe": df.memory_usage(deep=True).sum() / 1024 ** 2, "mb_pickle": len(dati) / 1024 ** 2,
        "funzioni": {
            "caricamento": lambda: pulisci_dati(pd.read_csv(percorso)),
            "validazione": valida,
            "copia": lambda: copia_per_richiesta(dati, IERI),
            "briefing": lambda: prepara_briefing(copia, NEGOZIO, OGGI, grafico),
            "soglie": lambda: controlla_soglie(copia, NEGOZIO, *SETTIMANA),
            "confronto": lambda: confronta_negozi(copia, NEGOZIO, *MESE),
            "analisi": lambda: tasso_scarto_mensile(copia),
        },
    }


def misura_tutto(dimensioni: list[dict], ripetizioni: int) -> list[dict]:
    """Ripetizioni A ROTAZIONE: ripetizione 1 di tutte le dimensioni, poi la 2, e così via.
    Su un portatile la velocità della CPU cambia nel tempo (alimentazione, temperatura): a rotazione
    un cambiamento colpisce tutte le dimensioni allo stesso modo invece di falsarne una sola."""
    tempi = {(d["fattore"], c): [] for d in dimensioni for c, _ in OPERAZIONI}
    for giro in range(1, ripetizioni + 1):
        print(f"Ripetizione {giro} di {ripetizioni}", flush=True)
        for d in dimensioni:
            for chiave, _ in OPERAZIONI:
                tempi[(d["fattore"], chiave)].append(un_tempo(d["funzioni"][chiave]))
    print("Memoria (tracemalloc)", flush=True)
    risultati = []
    for d in dimensioni:
        r = {k: v for k, v in d.items() if k != "funzioni"}
        r["operazioni"] = {}
        for chiave, nome in OPERAZIONI:
            serie = tempi[(d["fattore"], chiave)]
            r["operazioni"][chiave] = {"secondi": statistics.median(serie), "min": min(serie), "max": max(serie),
                                       "mb": picco_memoria(d["funzioni"][chiave])}
            print(f"  {d['fattore']:>3}× {nome:<38} {r['operazioni'][chiave]['secondi']:8.3f} s  "
                  f"{r['operazioni'][chiave]['mb']:9.1f} MB", flush=True)
        risultati.append(r)
    return risultati


# ---------------------------------------------------------------------------
# Sistema
# ---------------------------------------------------------------------------

def info_sistema() -> dict:
    info = {"python": platform.python_version(), "pandas": pd.__version__, "numpy": np.__version__,
            "sistema": platform.platform(), "pc": None, "cpu": platform.processor() or None, "ram": None}
    if platform.system() == "Windows":
        comando = ("$c=Get-CimInstance Win32_ComputerSystem; $p=Get-CimInstance Win32_Processor | Select-Object -First 1; "
                   "Write-Output ($c.Manufacturer + ' ' + $c.Model); Write-Output $p.Name; "
                   "Write-Output ([math]::Round($c.TotalPhysicalMemory/1GB))")
        try:
            uscita = subprocess.run(["powershell", "-NoProfile", "-Command", comando], capture_output=True,
                                    text=True, timeout=30).stdout.strip().splitlines()
            info["pc"], info["cpu"], info["ram"] = uscita[0].strip(), uscita[1].strip(), f"{uscita[2].strip()} GB"
        except (OSError, IndexError, subprocess.SubprocessError):
            pass
    elif Path("/proc/cpuinfo").exists():
        nomi = [r.split(":", 1)[1].strip() for r in Path("/proc/cpuinfo").read_text().splitlines() if r.startswith("model name")]
        info["cpu"] = nomi[0] if nomi else info["cpu"]
    return info


# ---------------------------------------------------------------------------
# Documento e grafico
# ---------------------------------------------------------------------------

def disegna_grafico(risultati: list[dict]) -> None:
    righe = [r["righe_csv"] for r in risultati]
    figura, assi = plt.subplots(1, 2, figsize=(12, 4.8), facecolor=SUPERFICIE)
    pannelli = [("secondi", "Tempo (mediana, secondi)", LIMITE_SECONDI, "1 s"),
                ("mb", "Picco di memoria (MB, tracemalloc)", LIMITE_MB, "512 MB (Render gratuito)")]
    for asse, (campo, titolo, limite, etichetta) in zip(assi, pannelli):
        asse.set_facecolor(SUPERFICIE)
        for (chiave, nome), colore in zip(OPERAZIONI, COLORI):
            valori = [r["operazioni"][chiave][campo] for r in risultati]
            asse.plot(righe, valori, color=colore, linewidth=2, marker="o", markersize=6,
                      markeredgecolor=SUPERFICIE, markeredgewidth=1.5, label=nome)
        asse.axhline(limite, color=TESTO_SECONDARIO, linewidth=1, linestyle="--")
        asse.text(righe[0], limite * 1.12, etichetta, color=TESTO_SECONDARIO, fontsize=9)
        asse.set_xscale("log")
        asse.set_yscale("log")
        asse.set_xticks(righe, [f"{r:,}".replace(",", ".") + f"\n({f['fattore']}×)" for r, f in zip(righe, risultati)])
        asse.minorticks_off()
        # Numeri normali sull'asse verticale (0,01 · 0,1 · 1 · 10), non potenze di 10
        asse.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: numero(v, 2 if v < 0.1 else 1 if v < 1 else 0)))
        asse.set_title(titolo, color=TESTO, fontsize=11, loc="left")
        asse.set_xlabel("Righe del CSV", color=TESTO_SECONDARIO, fontsize=9)
        asse.tick_params(colors=TESTO_SECONDARIO, labelsize=8)
        asse.grid(True, color=GRIGLIA, linewidth=0.8)
        for lato in ("top", "right"):
            asse.spines[lato].set_visible(False)
        for lato in ("left", "bottom"):
            asse.spines[lato].set_color(GRIGLIA)
    gestori, nomi = assi[0].get_legend_handles_labels()
    figura.legend(gestori, nomi, loc="lower center", ncol=4, frameon=False, fontsize=9, labelcolor=TESTO)
    figura.suptitle("Benchmark della parte pandas del data agent (scala logaritmica)", color=TESTO, fontsize=12,
                    x=0.01, ha="left")
    figura.tight_layout(rect=(0, 0.12, 1, 0.95))
    figura.savefig(GRAFICO, dpi=130, facecolor=SUPERFICIE)
    plt.close(figura)


def numero(valore: float, decimali: int = 0) -> str:
    return f"{valore:,.{decimali}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def tabella(risultati: list[dict], campo: str, decimali: int, unita: str) -> list[str]:
    testa = "| Operazione | " + " | ".join(f"{r['fattore']}× ({numero(r['righe_csv'])} righe)" for r in risultati) + " |"
    righe = [testa, "|---|" + "---:|" * len(risultati)]
    for chiave, nome in OPERAZIONI:
        valori = " | ".join(
            f"{numero(r['operazioni'][chiave][campo], decimali)} {unita}"
            + (f" ({numero(r['operazioni'][chiave]['min'], decimali)}–{numero(r['operazioni'][chiave]['max'], decimali)})"
               if campo == "secondi" else "")
            for r in risultati)
        righe.append(f"| {nome} | {valori} |")
    return righe


def prima_dimensione_oltre(risultati: list[dict], chiave: str, campo: str, limite: float) -> dict | None:
    return next((r for r in risultati if r["operazioni"][chiave][campo] > limite), None)


# Operazioni fatte a ogni richiesta (dopo la copia dei dati) e una sola volta all'avvio del data agent
PER_RICHIESTA = [("briefing", "briefing"), ("soglie", "controllo delle soglie"),
                 ("confronto", "confronto tra negozi"), ("analisi", "tasso di scarto mensile")]
ALL_AVVIO = ["caricamento", "validazione"]


def per_richiesta(r: dict, chiave: str) -> tuple[float, float]:
    """Costo di una richiesta come nel servizio: copia dei dati + operazione (secondi, MB).
    Per la memoria si sommano i picchi: la copia resta in memoria mentre l'operazione lavora."""
    copia, operazione = r["operazioni"]["copia"], r["operazioni"][chiave]
    return copia["secondi"] + operazione["secondi"], copia["mb"] + operazione["mb"]


def tabella_per_richiesta(risultati: list[dict]) -> list[str]:
    righe = ["| Richiesta (copia + operazione) | " + " | ".join(f"{r['fattore']}×" for r in risultati) + " |",
             "|---|" + "---:|" * len(risultati)]
    for chiave, nome in PER_RICHIESTA:
        celle = []
        for r in risultati:
            secondi, mb = per_richiesta(r, chiave)
            celle.append(f"{numero(secondi, 2)} s · {numero(mb)} MB")
        righe.append(f"| {nome.capitalize()} | {' | '.join(celle)} |")
    avvio = " | ".join(f"{numero(sum(r['operazioni'][c]['secondi'] for c in ALL_AVVIO), 2)} s · "
                       f"{numero(max(r['operazioni'][c]['mb'] for c in ALL_AVVIO))} MB" for r in risultati)
    righe.append(f"| *All'avvio: caricamento, pulizia e validazione* | {avvio} |")
    return righe


def conclusioni(risultati: list[dict]) -> list[str]:
    """Solo ciò che esce dai numeri misurati: soglie superate (o no), dove, e cosa cresce."""
    ultimo = risultati[-1]
    testo = [
        f"Soglie: **{numero(LIMITE_SECONDI)} secondo** per una richiesta (un'attesa dell'utente) e **{LIMITE_MB} MB** "
        "di memoria (il limite del piano gratuito di Render). Una richiesta costa la copia dei dati più l'operazione, "
        "come nel servizio; caricamento, pulizia e validazione si fanno una volta sola all'avvio e non sono un'attesa "
        "dell'utente, quindi si valutano a parte.",
        "",
        "**Tempo per richiesta.**",
    ]
    oltre = []
    for chiave, nome in PER_RICHIESTA:
        prima = next((r for r in risultati if per_richiesta(r, chiave)[0] > LIMITE_SECONDI), None)
        if prima:
            indice = risultati.index(prima)
            prima_sotto = risultati[indice - 1] if indice else None
            tra = f"tra {prima_sotto['fattore']}× e {prima['fattore']}×" if prima_sotto else f"già a {prima['fattore']}×"
            oltre.append(prima)
            testo.append(f"- **{nome.capitalize()}**: supera 1 s {tra} ({numero(per_richiesta(prima, chiave)[0], 2)} s "
                         f"a {prima['fattore']}×, {numero(prima['righe_csv'])} righe).")
        else:
            testo.append(f"- **{nome.capitalize()}**: sotto 1 s fino a {ultimo['fattore']}× "
                         f"({numero(per_richiesta(ultimo, chiave)[0], 2)} s).")
    b1, b2 = risultati[0]["operazioni"]["briefing"]["secondi"], risultati[min(1, len(risultati) - 1)]["operazioni"]["briefing"]["secondi"]
    testo.append(f"- Il briefing ha un costo quasi fisso: {numero(b1, 2)} s a {risultati[0]['fattore']}× e "
                 f"{numero(b2, 2)} s a {risultati[min(1, len(risultati) - 1)]['fattore']}× (nel briefing c'è anche il "
                 "disegno del grafico); cresce con i dati solo dopo.")
    copia_1, copia_n = risultati[0]["operazioni"]["copia"]["secondi"], ultimo["operazioni"]["copia"]["secondi"]
    testo.append(f"- La copia dei dati per ogni richiesta cresce con le righe: da {numero(copia_1, 3)} s a "
                 f"{numero(copia_n, 2)} s ({numero(copia_n / copia_1)} volte, per {ultimo['fattore']} volte le righe).")

    testo += ["", "**All'avvio.**"]
    avvio = [(r, sum(r["operazioni"][c]["secondi"] for c in ALL_AVVIO)) for r in risultati]
    testo.append("- Caricamento, pulizia e validazione: " + ", ".join(
        f"{numero(s, 2 if s < 1 else 1)} s a {r['fattore']}×" for r, s in avvio) + ". Il servizio è pronto solo dopo.")

    testo += ["", "**Memoria.**"]
    picco_avvio = max(ultimo["operazioni"][c]["mb"] for c in ALL_AVVIO)
    picco_richiesta = max(per_richiesta(ultimo, c)[1] for c, _ in PER_RICHIESTA)
    residente = ultimo["mb_pickle"]
    testo.append(f"- A {ultimo['fattore']}× il picco più alto è all'avvio ({numero(picco_avvio)} MB, caricamento e pulizia). "
                 f"Durante una richiesta: dati puliti sempre in memoria in bytes ({numero(residente)} MB) più copia e "
                 f"operazione (fino a {numero(picco_richiesta)} MB), cioè {numero(residente + picco_richiesta)} MB.")
    memoria_oltre = residente + picco_richiesta > LIMITE_MB or picco_avvio > LIMITE_MB
    testo.append(f"- Nessuna di queste misure supera {LIMITE_MB} MB fino a {ultimo['fattore']}×." if not memoria_oltre else
                 f"- A {ultimo['fattore']}× si supera {LIMITE_MB} MB.")
    testo.append("- Queste cifre non comprendono la memoria già occupata dal processo (Python, pandas, LangChain, "
                 "matplotlib), che qui non è misurata: il margine reale sotto i 512 MB è quindi minore.")

    testo += ["", "**Quando passare a DuckDB o SQLite.**"]
    if oltre:
        prima = min(oltre, key=lambda r: r["righe_csv"])
        indice = risultati.index(prima)
        ultima_ok = risultati[indice - 1] if indice else None
        if ultima_ok:
            testo.append(f"- Fino a {ultima_ok['fattore']}× ({numero(ultima_ok['righe_csv'])} righe) ogni richiesta resta "
                         "sotto 1 s e la memoria sotto 512 MB: con questi numeri pandas basta e cambiare non serve.")
        testo.append(f"- Da {prima['fattore']}× ({numero(prima['righe_csv'])} righe) alcune richieste superano 1 s "
                     "(vedi sopra): è la dimensione da cui avrebbe senso valutare un database come DuckDB o SQLite, "
                     "che a ogni richiesta leggerebbe solo le righe del periodo e del negozio invece di copiare tutti i "
                     "dati. Quanto si guadagni davvero non è misurato qui: andrebbe verificato con lo stesso benchmark.")
    else:
        testo.append(f"- Fino a {ultimo['fattore']}× ({numero(ultimo['righe_csv'])} righe) ogni richiesta resta sotto 1 s: "
                     "con questi numeri pandas basta e cambiare non serve.")
    if memoria_oltre:
        testo.append(f"- Anche la memoria supera {LIMITE_MB} MB: un motore su disco eviterebbe di tenere tutto in memoria.")
    testo += ["", "Limiti di queste misure: i tempi sono del PC indicato sopra; il piano gratuito di Render ha 0,1 CPU "
              "e qui non è misurato. Su un portatile i tempi cambiano anche tra un'esecuzione e l'altra (frequenza "
              "della CPU, alimentazione, altri programmi): contano l'ordine di grandezza e le soglie, non il millesimo "
              "di secondo. tracemalloc conta la memoria allocata da Python e numpy durante l'operazione."]
    return testo


def scrivi_documento(risultati: list[dict], sistema: dict, ripetizioni: int, durata: float) -> None:
    righe = [
        "# Benchmark delle prestazioni (parte pandas del data agent)",
        "",
        f"Generato da `data_agent/benchmark/benchmark.py` il {datetime.now():%d/%m/%Y alle %H:%M}, "
        f"in {numero(durata / 60, 1)} minuti. Nessuna chiamata a OpenAI: si misura solo la parte pandas.",
        "",
        "## Come sono fatti i dataset",
        "",
        "`data/dati_negozi.csv` duplicato 1, 10, 50 e 100 volte. Ogni copia ha negozi nuovi (copia 2: NEG07–NEG12, "
        "copia 3: NEG13–NEG18, ...) e le stesse date, e resta sporca come l'originale (nomi dei negozi incoerenti, "
        "tre formati di data, duplicati), così la pulizia lavora davvero. La validazione usa gli stessi controlli "
        "del data agent, con l'elenco dei negozi ammessi esteso a quelli generati.",
        "",
        f"Tempo: mediana di {ripetizioni} ripetizioni, fatte a rotazione su tutte le dimensioni (così un cambio di "
        "velocità della CPU durante la misura colpisce tutte le dimensioni allo stesso modo). Memoria: picco misurato con `tracemalloc` in un'esecuzione a parte "
        "(la memoria allocata durante l'operazione). Le operazioni dopo la copia lavorano sulla copia per la richiesta, "
        "come nel servizio, con lo scenario \"tranquilla\" (oggi 1/9/2026, NEG01; soglie sulla settimana 24–30 agosto, "
        "confronto su agosto 2026).",
        "",
        "| Dimensione | Righe del CSV | Righe dopo la pulizia | Negozi | DataFrame pulito | Dati in bytes (pickle) |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for r in risultati:
        righe.append(f"| {r['fattore']}× | {numero(r['righe_csv'])} | {numero(r['righe_pulite'])} | {r['negozi']} | "
                     f"{numero(r['mb_dataframe'], 1)} MB | {numero(r['mb_pickle'], 1)} MB |")
    righe += ["", "## Sistema", "",
              f"- PC: {sistema['pc'] or 'non rilevato'}",
              f"- Processore: {sistema['cpu'] or 'non rilevato'}",
              f"- Memoria: {sistema['ram'] or 'non rilevata'}",
              f"- Sistema operativo: {sistema['sistema']}",
              f"- Python {sistema['python']}, pandas {sistema['pandas']}, numpy {sistema['numpy']}",
              "", "## Tempo (mediana)", ""]
    righe += ["Mediana delle ripetizioni; tra parentesi il minimo e il massimo.", ""]
    righe += tabella(risultati, "secondi", 3, "s")
    righe += ["", "## Picco di memoria (tracemalloc)", ""]
    righe += tabella(risultati, "mb", 1, "MB")
    righe += ["", "## Per richiesta (copia dei dati + operazione)", ""]
    righe += tabella_per_richiesta(risultati)
    righe += ["", "## Grafico", "", "![Tempo e picco di memoria per operazione e dimensione](benchmark.png)", "",
              "Le linee tratteggiate sono le soglie di 1 secondo e 512 MB. Scala logaritmica su entrambi gli assi: "
              "una retta con pendenza 1 vuol dire tempo (o memoria) proporzionale alle righe.", "",
              "## Quando cambiare tecnologia", ""]
    righe += conclusioni(risultati)
    DOCUMENTO.write_text("\n".join(righe) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark della parte pandas del data agent")
    parser.add_argument("--fattori", default="1,10,50,100", help="moltiplicatori del dataset, separati da virgola")
    parser.add_argument("--ripetizioni", type=int, default=5)
    argomenti = parser.parse_args()
    fattori = [int(f) for f in argomenti.fattori.split(",")]

    inizio = time.perf_counter()
    grezzo = pd.read_csv(PERCORSO_CSV)
    sistema = info_sistema()
    print(f"Python {sistema['python']}, pandas {sistema['pandas']} | {sistema['cpu']}")
    with tempfile.TemporaryDirectory() as cartella:
        dimensioni = []
        for fattore in fattori:
            print(f"Preparazione del dataset {fattore}×", flush=True)
            dimensioni.append(prepara_dimensione(grezzo, fattore, Path(cartella)))
        risultati = misura_tutto(dimensioni, argomenti.ripetizioni)
    disegna_grafico(risultati)
    scrivi_documento(risultati, sistema, argomenti.ripetizioni, time.perf_counter() - inizio)
    print(f"Scritti {DOCUMENTO.relative_to(CARTELLA_PROGETTO)} e {GRAFICO.relative_to(CARTELLA_PROGETTO)}")


if __name__ == "__main__":
    main()
