"""Pulizia periodica dei grafici: solo i file vecchi, errori nel log senza fermarsi, task che si ferma pulito."""

import asyncio
import logging
import os
import time
from pathlib import Path

import pytest

import pulizia_grafici
from pulizia_grafici import avvia_pulizia, ferma_pulizia, intervallo_da_env, pulisci_grafici_vecchi

ORA = time.time()


def crea_png(cartella: Path, nome: str, ore_fa: float) -> Path:
    file = cartella / nome
    file.write_bytes(b"\x89PNG finto")
    momento = ORA - ore_fa * 3600
    os.utime(file, (momento, momento))
    return file


@pytest.fixture
def cartella(tmp_path):
    crea_png(tmp_path, "grafico_vecchio_1.png", ore_fa=30)
    crea_png(tmp_path, "briefing_vecchio_2.png", ore_fa=25)
    crea_png(tmp_path, "grafico_nuovo.png", ore_fa=1)
    crea_png(tmp_path, "grafico_quasi_24_ore.png", ore_fa=23.9)
    (tmp_path / "note.txt").write_text("non è un grafico")
    return tmp_path


def test_cancella_solo_i_grafici_vecchi(cartella, caplog):
    with caplog.at_level(logging.INFO, logger="data_agent"):
        esito = pulisci_grafici_vecchi(cartella, adesso=ORA)
    assert esito == {"controllati": 4, "cancellati": 2, "errori": 0}
    rimasti = sorted(f.name for f in cartella.iterdir())
    assert rimasti == ["grafico_nuovo.png", "grafico_quasi_24_ore.png", "note.txt"]
    # Una riga di log a fine giro con i conteggi
    fine = [r for r in caplog.records if r.getMessage() == "pulizia dei grafici completata"]
    assert len(fine) == 1 and (fine[0].controllati, fine[0].cancellati, fine[0].errori) == (4, 2, 0)


def test_errore_di_cancellazione_nel_log_e_la_pulizia_continua(cartella, caplog, monkeypatch):
    unlink_vero = Path.unlink

    def unlink_con_errore(self, *args, **kwargs):
        if self.name == "grafico_vecchio_1.png":  # come un file in uso su Windows
            raise PermissionError(13, "Il file è in uso da un altro processo", str(self))
        return unlink_vero(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", unlink_con_errore)
    with caplog.at_level(logging.INFO, logger="data_agent"):
        esito = pulisci_grafici_vecchi(cartella, adesso=ORA)

    assert esito == {"controllati": 4, "cancellati": 1, "errori": 1}
    assert not (cartella / "briefing_vecchio_2.png").exists()  # l'altro file vecchio è stato cancellato lo stesso
    assert (cartella / "grafico_vecchio_1.png").exists()
    avviso = [r for r in caplog.records if r.getMessage() == "grafico non cancellato"]
    assert len(avviso) == 1
    assert avviso[0].file == "grafico_vecchio_1.png"
    assert "PermissionError" in avviso[0].motivo and "in uso" in avviso[0].motivo


def test_intervallo_dal_env(monkeypatch):
    monkeypatch.delenv("PULIZIA_GRAFICI_MINUTI", raising=False)
    assert intervallo_da_env() == 60
    monkeypatch.setenv("PULIZIA_GRAFICI_MINUTI", "15")
    assert intervallo_da_env() == 15
    for sbagliato in ("0", "-5", "un'ora"):
        monkeypatch.setenv("PULIZIA_GRAFICI_MINUTI", sbagliato)
        assert intervallo_da_env() == 60


def test_il_task_gira_periodicamente_e_si_ferma_pulito(tmp_path, monkeypatch, caplog):
    giri = []

    def pulizia_finta(cartella, durata_ore):
        giri.append(cartella)
        if len(giri) == 2:
            raise RuntimeError("errore imprevisto in un giro")  # non deve fermare i giri successivi
        return {"controllati": 0, "cancellati": 0, "errori": 0}

    monkeypatch.setattr(pulizia_grafici, "pulisci_grafici_vecchi", pulizia_finta)

    async def prova():
        task = asyncio.create_task(pulizia_grafici.ciclo_pulizia(tmp_path, intervallo_secondi=0.01))
        while len(giri) < 4:
            await asyncio.sleep(0.01)
        await ferma_pulizia(task)
        return task

    with caplog.at_level(logging.INFO, logger="data_agent"):
        task = asyncio.run(asyncio.wait_for(prova(), timeout=5))
    assert task.done() and task.cancelled()
    assert len(giri) >= 4  # il giro con l'errore non ha fermato i successivi
    messaggi = [r.getMessage() for r in caplog.records]
    assert "pulizia dei grafici non riuscita" in messaggi
    assert "pulizia periodica dei grafici fermata" in messaggi


def test_avvio_con_un_giro_subito(cartella):
    async def prova():
        task = avvia_pulizia(cartella, intervallo_minuti=60)
        for _ in range(200):  # il primo giro parte subito, senza aspettare un'ora
            if not (cartella / "grafico_vecchio_1.png").exists():
                break
            await asyncio.sleep(0.01)
        await ferma_pulizia(task)

    asyncio.run(prova())
    assert not (cartella / "grafico_vecchio_1.png").exists()
    assert (cartella / "grafico_nuovo.png").exists()
