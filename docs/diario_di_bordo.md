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
