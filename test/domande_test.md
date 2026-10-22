# Domande di test

| N. | Domanda | Strumento atteso |
|---|---|---|
| 1 | Come devo comportarmi se il sistema di cassa si blocca durante il picco del sabato? | RAG |
| 2 | Qual è la politica per il reso di un prodotto difettoso senza scontrino? | RAG |
| 3 | Quali sono i passaggi obbligatori da verificare prima della chiusura serale? | RAG |
| 4 | Come devo segnalare una discrepanza tra la bolla di accompagnamento e i colli ricevuti? | RAG |
| 5 | Un banco frigo si è guastato: cosa faccio con la merce e chi devo contattare? | RAG |
| 6 | Cosa faccio se una consegna di freschi arriva fuori temperatura? | RAG |
| 7 | Quando e di quanto posso ribassare i prodotti vicini alla scadenza? | RAG |
| 8 | Come funziona la procedura di donazione delle eccedenze alimentari? | RAG |
| 9 | Di quanto siamo sopra o sotto il budget di vendita di questo mese? | DATI |
| 10 | Qual è stato lo scontrino medio di ieri rispetto alla media dell'area? | DATI |
| 11 | Le vendite di questa settimana sono calate: dipende dall'affluenza o dallo scontrino medio? | DATI |
| 12 | Quale reparto ha il rapporto più alto tra scarti e vendite nell'ultimo mese? | DATI |
| 13 | Quanto ci sono costati gli scarti quest'anno rispetto all'anno scorso? | DATI |
| 14 | Come sono i nostri scarti rispetto agli altri negozi dell'area? | DATI |
| 15 | Negli ultimi tre mesi, i giorni con consegne in ritardo coincidono con più rotture di stock? | DATI |
| 16 | Nelle settimane con più ore di assenza del personale, le vendite sono calate? | DATI |
| 17 | Gli scarti di ortofrutta sono aumentati questa settimana: di quanto, e cosa prevede la procedura? | ENTRAMBI |
| 18 | Siamo sotto l'obiettivo settimanale: da cosa dipende e quali azioni prevedono le linee guida? | ENTRAMBI |
| 19 | Le consegne in ritardo sono aumentate: quante sono state nell'ultimo mese e come devo segnalarlo all'Area Manager? | ENTRAMBI |
| 20 | Preparami il briefing di stamattina: com'è andata ieri, cosa c'è di anomalo e cosa devo fare. | ENTRAMBI |

## Risultati

| N. | Strumento usato | Corretto (sì/no) | Note |
|---|---|---|---|
| 1 | cerca_procedure | sì | Procedura e numero assistenza (000 000 401) corretti; omesso il codice cliente SV-NEG01 |
| 2 | cerca_procedure | sì | Completa |
| 3 | cerca_procedure | sì | Completa; tra le sezioni consultate anche "Orari di apertura", non pertinente |
| 4 | cerca_procedure | sì | Corretta; omessi i controlli preliminari della consegna |
| 5 | cerca_procedure | sì | Tecnico e soglie corretti; omessa la gestione dei surgelati; sezione "Assistenza casse" non pertinente tra le consultate |
| 6 | cerca_procedure | sì | Completa |
| 7 | cerca_procedure | sì | Corretta; omessi anticipo alle 16:00 con il caldo e non cumulabilità |
| 8 | cerca_procedure | sì | Corretta; impreciso "non si donano prodotti scaduti" (con TMC superato si possono donare) |
| 9 | analizza_dati | sì | -27.239,54 € (-2,94%), esatto |
| 10 | analizza_dati | sì | 24,36 € contro 25,10 € degli altri negozi, esatto; grafico prodotto |
| 11 | analizza_dati | sì | Corregge la premessa: vendite +1,38%, scontrini -0,73%, scontrino medio +2,13% |
| 12 | analizza_dati | sì | Ortofrutta 5,68%, esatto; grafico prodotto |
| 13 | nessuno | **no** | Numeri inventati (98.765 € e 94.800 €). Veri: gen-ago 2026 96.702 € contro 96.806 € del 2025 (-0,1%) |
| 14 | analizza_dati | **no** | Confronta i kg assoluti invece dei tassi. In %: NEG01 3,55%, in linea; da segnalare NEG05 (panetteria 12,1%) |
| 15 | analizza_dati | sì | Correlazione 0,18, esatta |
| 16 | analizza_dati | **no** | Correlazione positiva dovuta a una settimana parziale (solo il 31 agosto); con settimane complete circa 0 |
| 17 | analizza_dati → cerca_procedure | parziale | Ordine corretto, ma nessun numero ("di quanto"). Scarti in euro +2,53%, tasso da 6,07% a 5,88%: dire "diminuiti" vale solo per il tasso |
| 18 | analizza_dati → cerca_procedure | parziale | -2,06% esatto e "nel manuale non c'è" corretto; ma suggerisce promozioni (conoscenza generale) e spiega lo scostamento dall'obiettivo con il confronto sulla settimana prima |
| 19 | analizza_dati → cerca_procedure | parziale | 4 ritardi ad agosto, esatto; non rileva che la settimana 10-16 agosto ne ha 3 (soglia di segnalazione raggiunta); chiude con una domanda |
| 20 | prepara_briefing | sì | KPI e controlli corretti, nessuna anomalia, riconoscimento panetteria con bozza |

Esito del test del 22 ottobre 2026 (gpt-4.1-mini): 14 corrette, 3 parziali, 3 sbagliate.
