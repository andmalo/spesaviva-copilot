# Diario di bordo

## [data] – [problema]
- Cosa non funzionava:
- Causa:
- Soluzione:

## 2026-09-30 – Il pandas agent ricreava i dati a mano
- Cosa non funzionava: con un prompt minimo l'agente ha sbagliato
  tutte e 4 le domande di test. Invece di usare il DataFrame caricato,
  ha ricreato un df di 5 righe copiando l'anteprima del prompt.
- Causa: il prefisso personalizzato sostituiva le istruzioni di
  default della libreria, che spiegano che i dati sono nella
  variabile df. Mancavano anche il negozio dell'utente, la
  definizione dei periodi e dei KPI.
- Soluzione: da definire con il nuovo prompt del data agent.
- Nota: langchain-experimental è in dismissione (non più manutenuto); la versione 0.4.2 è stata fissata in requirements.txt.
- Il troncamento del codice era causato anche dal limite
  max_tokens=800: il codice scritto dall'agente fa parte della sua
  risposta e veniva tagliato a metà.
- Con gpt-4.1-mini le domande 1, 2 e 3 sono corrette.
- L'agente ha modificato df nonostante la regola di sola lettura
  nel prompt: la protezione andrà imposta nel codice, passando a
  ogni domanda una copia dei dati puliti.

## 2026-09-30 – RAG: indicizzazione e ricerca
- Risultato: 32 chunk (24 manuale, 8 scheda NEG01). Sulle 8 domande
  RAG la sezione giusta è 7 volte al primo posto e 1 volta al
  secondo, mai assente.
- Scelta di k=3: nella domanda sui ribassi tre sezioni hanno distanze
  quasi uguali (0,229-0,258); con k=1 la risposta sarebbe stata
  incompleta.
- Le sezioni pertinenti hanno distanza tra 0,23 e 0,33, quelle fuori
  tema quasi sempre oltre 0,40: possibile soglia per riconoscere le
  domande a cui il manuale non risponde.
- Il client JS di Chroma v3 richiede il pacchetto separato
  @chroma-core/openai per gli embedding OpenAI.

## 2026-10-03 – Orchestratore: primo test
- 5 domande su 5 con il comportamento corretto: RAG, dati, memoria
  della conversazione, domanda ibrida in sequenza (aumento scarti
  confermato: +2,53%), rifiuto delle domande fuori ambito.
- Errore trovato: orchestratore e data agent definivano "questa
  settimana" in modo diverso; risolto dando le stesse definizioni
  di tempo a entrambi.
- Soglia RAG mantenuta a 0,40: il tecnico frigo è stato incluso nella
  domanda 1 anche se non pertinente; abbassarla potrebbe escludere
  sezioni utili, da verificare.
- Smart App Control bloccava pandas 3.0.6: risolto con pandas
  3.0.5 e versioni fissate in requirements.txt.
- Costo del test: circa 16.000 token dell'orchestratore per 5 domande.

## 2026-10-17 – Briefing deterministico e grafici disegnati dal codice
- Problema: l'LLM ignorava le regole del prompt (falsi allarmi nel
  briefing, grafici con unità mescolate).
- Soluzione: i controlli fissi sono passati al codice. Il briefing
  controlla le soglie del manuale in pandas; per i grafici l'agente
  sceglie i dati e il codice li disegna e li valida.
- Risultato del briefing: da 28 a 4 secondi, da 7.650 a 3.124 token,
  nessun falso allarme; trovate le anomalie piantate (ondata di
  caldo di luglio 2025, fornitore in crisi di marzo 2026).
- Grafici: il primo tentativo con un file JSON scritto dall'agente è
  fallito perché il modello saltava il passaggio finale; la soluzione
  è un blocco JSON nella risposta, estratto, validato e disegnato dal
  codice. Lettura tollerante con ast.literal_eval (mai eval, per
  sicurezza).
- Limite noto: con gpt-4.1-mini alcune risposte escono senza grafico,
  soprattutto nei confronti tra due periodi. In quel caso la risposta
  testuale arriva comunque, senza errori. La frequenza verrà misurata
  nel test finale sulle 20 domande.
- Principio: l'LLM decide cosa fare e cosa mostrare, il codice
  esegue i passaggi che devono essere sempre uguali.

## 2026-10-23 – Limiti noti del data agent
- Domande 11 e 15: riformulando la domanda per analizza_dati,
  l'orchestratore perde la premessa o le parole chiave ("calate",
  "più"). Il data agent non può correggere una premessa che non vede.
  Errore identico con gpt-4.1-mini e con gpt-4.1.
- Domanda 14 (scarti rispetto agli altri negozi): gpt-4.1 la risolve
  3 volte su 3, a circa 4,7 volte il costo per domanda. Alternativa più
  economica: uno strumento deterministico di confronto tra negozi.
- Domanda 17 (scarti di ortofrutta e procedura): instabile con
  entrambi i modelli.
- Domanda 18: la sezione giusta del manuale ("Ritardi di consegna e
  prodotti a scaffale vuoto") era tra i risultati, quinta con distanza
  0,378, ma è stata tagliata dal limite k=3.
- Decisione: si resta su gpt-4.1-mini per contenere i costi.

