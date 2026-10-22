"""Test dei grafici disegnati dal codice: validazione della spec ed estrazione del blocco json."""

from grafici import disegna_grafico, estrai_blocco_grafico, valida_spec

SPEC_VALIDA = {
    "titolo": "Tasso di scarto per reparto, agosto 2026",
    "unita": "%",
    "etichette": ["Panetteria", "Ortofrutta", "Freschi"],
    "valori": [5.97, 5.68, 2.45],
    "evidenzia": ["Panetteria"],
}


def test_spec_valida_disegna_il_grafico(tmp_path):
    percorso = tmp_path / "grafico.png"
    creato, motivo = disegna_grafico(SPEC_VALIDA, percorso)
    assert creato is True
    assert motivo is None
    assert percorso.exists() and percorso.stat().st_size > 0


def test_percentuale_oltre_100_rifiutata(tmp_path):
    percorso = tmp_path / "grafico.png"
    spec = {**SPEC_VALIDA, "etichette": ["25-31 agosto", "18-24 agosto"], "valori": [264, 267], "evidenzia": []}
    creato, motivo = disegna_grafico(spec, percorso)
    assert creato is False
    assert "100" in motivo
    assert not percorso.exists()


def test_liste_di_lunghezza_diversa_rifiutate(tmp_path):
    percorso = tmp_path / "grafico.png"
    spec = {"titolo": "Vendite", "unita": "€", "etichette": ["A", "B", "C"], "valori": [1.0, 2.0]}
    creato, motivo = disegna_grafico(spec, percorso)
    assert creato is False
    assert "lunghezza diversa" in motivo
    assert not percorso.exists()


def test_blocco_con_codice_python_rifiutato_e_non_eseguito(tmp_path):
    # Se il blocco venisse eseguito, creerebbe questo file: non deve succedere
    sentinella = tmp_path / "eseguito.txt"
    codice = f"__import__('builtins').open(r'{sentinella}', 'w').write('x')"
    testo, spec, motivo = estrai_blocco_grafico(f"Risposta.\n\n```json\n{codice}\n```")
    assert spec is None
    assert "non si può leggere" in motivo
    assert testo == "Risposta."  # il blocco viene tolto comunque dal testo
    assert not sentinella.exists()


def test_lettura_tollerante(tmp_path):
    # Virgolette singole, True al posto di true e virgola finale: accettati con ast.literal_eval
    blocchi = [
        "{'titolo': 'T', 'unita': '%', 'etichette': ['A'], 'valori': [1.5]}",
        '{"titolo": "T", "unita": "%", "etichette": ["A"], "valori": [1.5], "confronto": True}',
        '{"titolo": "T", "unita": "%", "etichette": ["A"], "valori": [1.5],}',
    ]
    for blocco in blocchi:
        testo, spec, motivo = estrai_blocco_grafico(f"Testo.\n```json\n{blocco}\n```")
        assert testo == "Testo."
        assert spec is not None, motivo
        spec_valida, errore = valida_spec(spec)
        assert spec_valida is not None, errore


def test_risposta_senza_blocco():
    testo, spec, motivo = estrai_blocco_grafico("Solo testo, nessun grafico.")
    assert testo == "Solo testo, nessun grafico."
    assert spec is None
    assert motivo == "nessun blocco json nella risposta"
