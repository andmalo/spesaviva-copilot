# Esperimento: modello del data agent (gpt-4.1-mini contro gpt-4.1)

Data: 23 ottobre 2026.

**Cosa cambia:** solo il modello del data agent, impostato con la variabile
`DATA_AGENT_MODEL`.

**Cosa resta identico:** orchestratore (gpt-4.1-mini), prompt, codice e k=3
del RAG.

**Come:** domande 11, 14, 15 e 17 di `test/domande_test.md`, 3 volte per
modello. Ogni esecuzione è in una sessione nuova, con 7 secondi di pausa per il
limite di frequenza. Chiamate reali a OpenAI: 132 (limite 150).

## Risultati

| Domanda | gpt-4.1-mini | gpt-4.1 |
|---|---|---|
| 11 – Vendite calate: affluenza o scontrino? | 0/3 | 0/2 (1 errore di connessione) |
| 14 – Scarti rispetto agli altri negozi | 0/3 (3 parziali) | **3/3** |
| 15 – Ritardi e rotture di stock | 0/3 (3 parziali) | 0/3 (3 parziali) |
| 17 – Scarti ortofrutta e procedura | 0/3 (3 parziali) | 1/2 (1 sbagliata; 1 bloccata dal tetto giornaliero) |
| **Totale corrette** | **0/12** (9 parziali, 3 sbagliate) | **4/10** (3 parziali, 3 sbagliate, 2 non valutabili) |
| Token medi per domanda | 12.223 (data agent 7.228) | 14.456 (data agent 9.468) |
| Costo medio per domanda | circa 0,0039 $ | circa 0,0184 $ (circa 4,7 volte) |

**Prezzi** per milione di token (input / input dalla cache / output), dalla
pagina ufficiale <https://developers.openai.com/api/docs/pricing>, consultata
il 23 ottobre 2026:
- gpt-4.1-mini: 0,40 / 0,10 / 1,60 $;
- gpt-4.1: 2,00 / 0,50 / 8,00 $.

**Come è calcolato il costo:**
- per il data agent si usano i token esatti di input, cache e output, misurati
  a ogni analisi;
- per l'orchestratore, che è uguale nei due casi (circa 0,0015 $), è una stima:
  300 token di output per esecuzione e il 60% dell'input dalla cache.

## Dettaglio delle esecuzioni

**Criteri di giudizio:**
- **11:** corretta solo se corregge la premessa, cioè le vendite sono salite
  dell'1,38%, con scontrini -0,73% e scontrino medio +2,13%.
- **14:** corretta se confronta i tassi con numeri giusti (NEG01 3,55% contro
  una media degli altri del 3,71%, oppure i tassi per reparto).
- **15:** corretta solo se risponde a "*più* rotture" (correlazione 0,18,
  oppure in media 46,7 referenze in rottura nei giorni con ritardi contro 41,8).
- **17:** corretta se riporta sia gli euro (+32,73 €, +2,53%) sia il tasso
  (dal 6,07% al 5,88%), dà la procedura corretta e non afferma che la soglia
  non sia mai stata superata. In realtà lo è stata il 30 e il 31 agosto, ma non
  per 3 giorni.

| Domanda | Giro | gpt-4.1-mini | gpt-4.1 |
|---|---|---|---|
| 11 | 1 | No: "la diminuzione delle vendite… dovuta all'affluenza" (accetta la premessa) | No: "le vendite sono calate leggermente… non dipende dall'affluenza, ma da altri fattori" |
| 11 | 2 | No: "nella settimana 25-31 agosto non risultano dati" (falso) | Non valutabile: errore 503 di connessione con OpenAI |
| 11 | 3 | No: accetta la premessa | No: "la diminuzione… dipende dallo scontrino medio, che è aumentato" (contraddittorio) |
| 14 | 1 | Parziale: tassi per reparto di NEG01 giusti, ma freschi "nella media" (è il più alto) | Sì: 3,55% contro 3,71% |
| 14 | 2 | Parziale: scarti / vendite **totali** (1,53%), non il KPI definito; conclusione corretta | Sì: 3,55% contro 3,71% |
| 14 | 3 | Parziale: come il giro 2, segnala NEG05 | Sì: 3,55% contro 3,71%, segnala NEG05 |
| 15 | 1 | Parziale: "coincidono esattamente" (ogni giorno ha almeno una referenza esaurita): non risponde a "più rotture" | Parziale: stessa lettura, "solo il 12% dei giorni con rotture coincide con ritardi" |
| 15 | 2 | Parziale: come sopra | Parziale: come sopra |
| 15 | 3 | Parziale: come sopra | Parziale: come sopra |
| 17 | 1 | Parziale: numeri giusti, ma "non si è superata la soglia del 7%" | No: nessun numero, e "doppio della soglia (oltre 14%)" è sbagliato (il doppio del normale è il 10%); 2 analisi, 45.520 token |
| 17 | 2 | Parziale: come il giro 1 | Sì: +32,73 € e tasso -0,19 punti, procedura corretta |
| 17 | 3 | Parziale: niente euro né tassi, "resta sotto la soglia" | Non valutabile: tetto giornaliero di 300.000 token raggiunto |

## Osservazioni

1. **Domanda 14: il modello conta.** gpt-4.1 usa il KPI giusto (tasso per
   reparto aggregato) in tutti e 3 i giri. gpt-4.1-mini ogni volta in modo
   diverso, e mai del tutto corretto.
2. **Domande 11 e 15: il modello del data agent non conta, perché l'errore
   nasce prima, nell'orchestratore.** Nella 11 l'orchestratore toglie la
   premessa dalla domanda passata ad `analizza_dati` ("analisi delle vendite…
   con focus su affluenza e scontrino medio"), quindi il data agent non può
   correggerla. Nella 15 cade la parola "più" ("verifica se coincidono"), e
   la risposta diventa banale. Lo stesso errore compare con entrambi i modelli.
3. **Domanda 17:** gpt-4.1 dà una sola risposta completa su due. In un giro
   ha fatto due analisi (10 chiamate, 45.520 token) e ha comunque perso i
   numeri.
4. **Costo:** con gpt-4.1 il costo del data agent passa da circa 0,0023 $ a
   circa 0,0168 $ per domanda, e il totale da circa 0,0039 $ a circa
   0,0184 $. In termini assoluti resta basso: circa 1,84 $ ogni 100 domande
   sui dati.
5. **Limite del test:** 3 ripetizioni per domanda sono poche. Le differenze
   sono nette solo nella 14 (0/3 contro 3/3).
