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

## 2026-10-23 – Scenari, avvio unico, eccedenze, trasparenza e valutazioni
- Scenari della demo: tre casi pronti (giornata tranquilla, ondata di
  caldo, fornitore in crisi) in un solo file, backend/scenari.json,
  letto da back end, data agent e front end. Il browser invia solo
  l'id: date e negozi liberi vengono rifiutati (400). Motivo: mostrare
  le anomalie piantate nei dati senza modificare il .env, e senza
  aprire la porta a date o negozi inventati. Il data agent riceve lo
  scenario a ogni richiesta e lavora solo sui dati fino a "ieri".
- Avvio con un solo comando: npm run setup e npm start (avvia.mjs).
  Motivo: quattro terminali erano scomodi e facili da sbagliare. Il
  manuale si reindicizza solo se manca, per non pagare gli embedding
  a ogni setup. Ctrl+C ferma tutti i servizi.
- Eccedenze donate: kg di ieri e dell'ultima settimana completa nel
  briefing, e kg della settimana nel report. Solo chilogrammi, senza
  conversioni non verificabili. Valori controllati a mano nei test.
- "Come l'ho calcolato": il data agent restituisce il codice Python
  eseguito (troncato e filtrato dai segreti), gli strumenti
  deterministici le loro regole, scritte nel codice. Motivo: lo Store
  Manager può controllare da dove viene un numero. Il codice è solo
  testo, il front end non lo esegue mai.
- Valutazioni con i pollici: un voto per risposta in
  backend/feedback.jsonl (escluso da git). Domanda, strumenti e
  risposta li prende il server dalla sua memoria, non dal browser.
  node riepilogo_feedback.js conta i voti per strumento: serve a
  capire quali strumenti funzionano peggio con utenti veri.
- Verifica finale con chiamate reali (briefing negli scenari "caldo"
  e "fornitore"): entrambi corretti. Due limiti emersi:
  - per le consegne in ritardo la ricerca nel manuale non trova
    sezioni sotto la distanza 0,40, quindi il briefing dice che non ci
    sono procedure, anche se il manuale ne ha una;
  - nelle azioni dirette il tetto MAX_CHIAMATE_OPENAI non conta gli
    embedding della ricerca, quindi il contatore del server sottostima
    le chiamate.

## 2026-11-11 – Revisione dei docenti, parte 1: dipendenze e notebook
- Cosa non funzionava: requirements.txt mescolava produzione e
  sviluppo (jupyter, ipykernel, pytest), e il Dockerfile li toglieva
  con un grep: fragile, bastava aggiungere uno strumento per
  ritrovarlo nell'immagine.
- Soluzione: requirements.txt solo con le dipendenze di produzione,
  requirements-dev.txt con -r requirements.txt più gli strumenti di
  sviluppo. Il Dockerfile installa solo requirements.txt, npm run
  setup installa requirements-dev.txt (i test continuano a girare).
- Il notebook di prototipazione è passato da data_agent/ a
  notebooks/: non è codice del servizio. Nel notebook si aggiunge
  data_agent/ al percorso dei moduli, per l'import di pulizia.
  .gitattributes lo segna come documentazione, così GitHub non lo
  conta nelle statistiche dei linguaggi.

## 2026-11-11 – Revisione dei docenti, parte 2: validazione del dataset
- Cosa non funzionava: il data agent accettava qualunque CSV. Senza
  una colonna, o con un negozio NEG09, partiva lo stesso e falliva
  dopo, a metà di una richiesta, oppure dava numeri sbagliati.
- Vincolo: il CSV è sporco di proposito e la pulizia lo sistema,
  quindi la validazione non deve rifiutare lo sporco previsto.
- Soluzione: data_agent/validazione.py, in due momenti.
  - Prima della pulizia (struttura): colonne attese tutte presenti,
    quelle in più solo segnalate nel log, almeno una riga.
  - Dopo la pulizia (valori): date dal 2020 a oggi, negozi solo
    NEG01-NEG06, nessun duplicato data + negozio, vendite, scarti e
    ore non negativi, colonne numeriche di tipo numerico, date
    illeggibili sotto l'1%.
  - Se un controllo fallisce: eccezione DatasetNonValido con il
    controllo, il numero di righe e un esempio. All'avvio il data
    agent si ferma con quel messaggio.
- Due cose emerse dai test:
  - con un testo in una colonna numerica la pulizia andava in errore
    (TypeError) prima della validazione: il controllo dei tipi si fa
    anche prima della pulizia;
  - la pulizia unisce come duplicati le righe con data illeggibile
    dello stesso negozio, quindi la quota di date illeggibili si
    calcola dal report della pulizia sulle righe lette, non sulle
    righe rimaste.

## 2026-11-11 – Revisione dei docenti, parte 3: date dello scenario in un solo punto
- Cosa non funzionava: "ieri", "inizio settimana" e "mese corrente"
  erano calcolati due volte, in backend/scenari.js e in
  data_agent/app.py, e l'ultima settimana completa sia in
  backend/azioni.js sia in briefing.py. Era già successo che
  orchestratore e data agent definissero "questa settimana" in modo
  diverso.
- Soluzione: il calcolo è solo nel data agent, che conosce i dati
  (data_agent/date_scenario.py), ed è esposto con
  GET /scenari/{id}/date. Il back end chiede le date invece di
  calcolarle (backend/date_scenario.js); scenari.js contiene solo
  l'elenco degli scenari ammessi.
- Regola mantenuta, per non cambiare le risposte: ieri = oggi - 1;
  "questa settimana" = gli ultimi 7 giorni fino a ieri (non da lunedì
  a domenica); mese corrente = mese di ieri; ultima settimana
  completa = l'ultima lunedì-domenica entro ieri. Prima di togliere
  il vecchio codice ho confrontato le sue date con quelle nuove nei
  tre scenari: identiche, quindi il prompt di sistema non cambia.
- Le date di uno scenario non cambiano: il back end le chiede una
  volta e le tiene in memoria. Conseguenza: anche le domande sul
  manuale ora richiedono il data agent acceso. Se non risponde, la
  chat restituisce un 503 con un messaggio chiaro
  (data_agent_non_raggiungibile) e alla richiesta successiva si
  riprova.
- Test: date dei tre scenari contro valori scritti a mano (pytest,
  funzione ed endpoint); in test_feedback.js un finto data agent
  verifica che le date si chiedano una sola volta e che senza date la
  chat risponda 503.

## 2026-11-11 – Revisione dei docenti, parte 4: server.js diviso in moduli
- Cosa non funzionava: server.js aveva quasi 700 righe con tutto
  insieme (configurazione, sessioni, limiti, ciclo di function
  calling, rotte), e le rotte /api/chat e /api/azioni/:azione
  ripetevano la stessa struttura.
- Soluzione, solo riorganizzazione: config.js, errori.js,
  sessioni.js, limiti.js, orchestratore.js, app.js (Express) e
  routes/ (chat, azioni, feedback, servizi); server.js fa solo
  l'avvio. La struttura comune di chat e azioni (AbortController,
  validazione, tetto, sessione, id per i pollici, log) è una sola
  funzione, gestisciRichiesta() in routes/comune.js.
- Verifica: test invariati e superati; in più, lo stesso script
  (finto OpenAI, data agent vero) contro il codice di prima e quello
  nuovo: risposte identiche per chat, azioni "soglie" nei tre
  scenari ed errori, e identici anche i messaggi mandati al modello.
- Unica differenza: le righe di log di richiesta annullata o non
  riuscita ora hanno lo stesso formato per chat e azioni (nome
  dell'errore e chiamate OpenAI totali in entrambe). I log si rifanno
  comunque nella parte 5.

## 2026-11-11 – Revisione dei docenti, parte 5: log strutturato
- Cosa non funzionava: righe di testo libere (console.log e print),
  diverse in ogni punto, e nessun modo di seguire una richiesta dal
  back end al data agent.
- Soluzione:
  - back end con pino (backend/log.js), data agent con logging e un
    formattatore proprio (data_agent/registro.py); niente più print;
  - ogni richiesta ha un requestId (UUID) creato dal back end e
    passato al data agent in X-Request-Id; il data agent accetta
    solo UUID, altrimenti ne crea uno nuovo (niente testo libero nei
    log);
  - una riga "richiesta completata" per richiesta: requestId, rotta,
    scenario, strumenti, durata_ms, esito (ok, errore con codice,
    annullata), token in ingresso e in uscita, cache (sempre false
    fino alla parte 7);
  - LOG_LEVEL e LOG_FORMAT nel .env; formato leggibile in locale e
    JSON in produzione.
- Scelte:
  - formato leggibile scritto a mano invece di pino-pretty, che è
    uno strumento di sviluppo e non c'è nell'immagine Docker;
  - il filtro dei segreti si applica alla riga intera già scritta,
    quindi copre anche i campi e le tracce degli errori;
  - /api/health, /api/scenari e i grafici loggano a livello debug:
    il controllo di Render li chiama di continuo;
  - il log di accesso di uvicorn è spento, sostituito dalla riga di
    fine richiesta del data agent, che ha il requestId;
  - per contare i token in ingresso e in uscita anche delle analisi,
    /analizza restituisce token_ingresso e token_uscita; il back end
    li usa solo per il log, il front end non li riceve.
- Restano fuori dai log strutturati: gli script da riga di comando
  (avvia.mjs, indicizza.js, riepilogo_feedback.js, i test), che
  stampano per chi li lancia, e l'avviso di deprecazione di
  langchain-experimental, che Python scrive su stderr durante
  l'import, prima che i log siano configurati.
- Verifica: risposte del back end identiche a prima con lo stesso
  script della parte 4; test nuovi per formato, filtro dei segreti,
  livello, requestId (test_log.js, test_registro.py e le righe JSON
  controllate in test_feedback.js).

## 2026-11-11 – Revisione dei docenti, parte 6: limiti di spesa che sopravvivono ai riavvii
- Cosa non funzionava: il contatore dei token del giorno stava in
  memoria. Su Render gratuito il servizio si spegne dopo 15 minuti
  senza visite e il contatore ripartiva da zero: il tetto giornaliero
  si poteva superare più volte al giorno. Un file non basta, perché
  sui servizi gratuiti il disco si azzera a ogni spegnimento.
- Soluzione: in limiti.js un archivio con due implementazioni e la
  stessa interfaccia (leggi, aggiungi): Redis se c'è REDIS_URL (su
  Render il Key Value gratuito, aggiunto al render.yaml), un file JSON
  se manca (in locale). Il resto del codice non sa quale è attiva.
  - Redis: chiave token:AAAA-MM-GG, INCRBY (atomico anche con più
    istanze) e scadenza di 48 ore.
  - Il giorno si calcola sempre con il fuso Europe/Rome: Render usa
    UTC, e senza fuso il tetto si sarebbe azzerato all'1 di notte (o
    alle 2 con l'ora legale).
  - Se Redis non risponde (timeout di 2 secondi, nessuna coda di
    comandi quando la connessione manca) le nuove richieste si
    rifiutano con 503 e un messaggio chiaro, e il rifiuto va nel log.
    Anche un file del contatore rovinato fa rifiutare le richieste,
    invece di ripartire da zero.
  - I token di una chiamata già fatta, se il salvataggio non riesce,
    restano in sospeso e si salvano alla chiamata successiva; si
    prelevano prima di salvarli, così due chiamate contemporanee non
    li contano due volte (errore trovato rileggendo la prima versione,
    ora coperto da un test).
- Limiti noti, scritti nel README: il Key Value gratuito non salva
  su disco e perde i dati se si riavvia (raro); sessioni e limite di
  richieste al minuto restano in memoria; la protezione principale
  resta il limite di spesa nella dashboard di OpenAI.
- Verifica: test_limiti.js (riavvio simulato su file e su un finto
  Redis, 23:30 UTC del 31 ottobre = 1 novembre a Roma, Redis che non
  risponde, server vero con Redis irraggiungibile) e una prova a mano
  con un Redis vero in Docker: contatore conservato dopo il riavvio,
  scadenza 172.800 secondi, rifiuto in pochi millisecondi con Redis
  fermo.
- Deploy: dopo il push e il Sync del Blueprint, Render ha creato il Key
  Value; nei log online "archivio_contatore": "redis" e "archivio del
  contatore dei token collegato", anche dopo un risveglio del servizio.

## 2026-11-11 – Revisione dei docenti, parte 7: cache delle risposte
- Problema: la stessa domanda (per esempio quella del pulsante "domande
  rapide") costava ogni volta una o più chiamate a OpenAI.
- Soluzione: backend/cache.js, cache LRU in memoria (CACHE_MAX_VOCI,
  CACHE_TTL_MINUTI). La chiave è l'hash di domanda normalizzata,
  scenario, lingua, versione dei dati, modelli di orchestratore e data
  agent, versione dei prompt. La versione dei dati e il modello del
  data agent li dà il data agent (GET /versione): l'impronta sha256 dei
  dati puliti, la stessa del controllo di integrità.
- Scelta: solo domande identiche, nessuna cache semantica con gli
  embedding. "Scarti di ortofrutta" e "scarti di panetteria" sono molto
  vicine per significato: restituire la risposta dell'altra domanda,
  con numeri e procedure, è un errore peggiore di una chiamata in più.
- Regole:
  - solo all'inizio di una conversazione (con la memoria la stessa
    domanda può voler dire altro);
  - non si salvano risposte con errori (anche di uno strumento),
    bloccate dal filtro dei segreti o con numeri senza strumenti usati;
  - dalla cache: 0 token, non conta nel tetto e si ottiene anche a
    tetto raggiunto, ma conta nel limite di richieste al minuto; nel
    log cache: true;
  - solo la chat: le azioni dei pulsanti restano senza cache;
  - scadenza al massimo 24 ore, perché i grafici citati nelle
    risposte si cancellano dopo 24 ore.
- Verifica: test_cache.js (31 verifiche), più /versione nei test del
  data agent; risposte invariate con lo script di confronto.

## 2026-11-11 – Revisione dei docenti, parte 8: pulizia periodica dei grafici
- Cosa non funzionava: i PNG più vecchi di 24 ore si cancellavano solo
  all'avvio del data agent. In locale, con il servizio acceso per
  giorni, la cartella charts cresceva senza limite; gli errori di
  cancellazione si ignoravano in silenzio (except OSError: pass).
- Soluzione: data_agent/pulizia_grafici.py, con un task asyncio nel
  ciclo di vita di FastAPI: un giro subito e poi uno ogni
  PULIZIA_GRAFICI_MINUTI (predefinito 60). La cancellazione gira in
  un thread, per non bloccare le richieste.
  - Ogni errore di cancellazione (per esempio un file in uso su
    Windows) va nel log con nome del file e motivo; il giro continua
    con gli altri file e il servizio non si ferma. Anche un errore
    imprevisto in un giro non ferma i giri successivi.
  - A fine giro una riga: file controllati, cancellati, errori.
  - Alla chiusura del servizio il task si annulla e si aspetta che
    sia davvero finito, prima di liberare lo stato.
- Emerso durante la verifica: una libreria scrive con il logger
  "httpx2", che non era tra quelli silenziati nella parte 5: ogni
  chiamata HTTP finiva nel log a livello info. Aggiunto all'elenco.
- Verifica: test_pulizia_grafici.py (file finti vecchi e nuovi, errore
  di cancellazione simulato, task periodico che si ferma pulito, giro
  subito all'avvio) e una prova del ciclo di vita vero del servizio.

## 2026-11-13 – Revisione dei docenti, parte 9: benchmark delle prestazioni
- Obiettivo: sapere fino a che dimensione dei dati pandas basta, con
  numeri misurati e non stimati. Risultati in docs/benchmark.md.
- Script: data_agent/benchmark/benchmark.py. Dataset 1×, 10×, 50×,
  100× (da 4.375 a 437.500 righe) duplicando il CSV con negozi nuovi
  (NEG07, NEG08, ...) e le stesse date: con le date spostate la
  validazione (2020-oggi) avrebbe rifiutato i dati. Le copie restano
  sporche come l'originale, così la pulizia lavora davvero.
- Misure: mediana di 5 ripetizioni (con minimo e massimo) e picco con
  tracemalloc di caricamento e pulizia, validazione, copia dei dati
  per una richiesta, briefing, soglie, confronto, tasso di scarto
  mensile. Ho aggiunto la copia per richiesta, che il prompt non
  elencava, perché nel servizio ogni richiesta la fa prima
  dell'operazione: il costo vero di una richiesta è la somma.
- Problema nelle misure: nelle prime esecuzioni, fatte una dimensione
  dopo l'altra, i tempi cambiavano molto (caricamento a 100×: 11,3 s
  nella prima esecuzione, 6,3 s nella seconda) e in una esecuzione le
  operazioni a 100× risultavano più veloci che a 50×. Il minimo e il
  massimo del briefing a 100× (0,40-1,63 s) mostravano che il portatile
  aveva cambiato velocità a metà misura. Soluzione: preparare tutte le
  dimensioni e fare le ripetizioni a rotazione (ripetizione 1 di tutte
  le dimensioni, poi la 2, ...), così un cambiamento colpisce tutte le
  dimensioni allo stesso modo. Dopo, i tempi crescono in modo regolare
  e minimo e massimo sono vicini alla mediana.
- Conclusioni (dai numeri, uguali in tutte le esecuzioni): fino a 10×
  ogni richiesta resta sotto 1 s; da 50× briefing e confronto tra
  negozi superano 1 s; la memoria resta sotto 512 MB fino a 100× (266
  MB durante una richiesta, senza contare il processo stesso). Quindi
  DuckDB o SQLite avrebbero senso da circa 50 volte i dati attuali,
  da verificare con lo stesso benchmark. I tempi sono del portatile:
  sul piano gratuito di Render (0,1 CPU) non sono misurati.

## 2026-11-14 – Verifica finale da un clone pulito
- Metodo: git clone in una cartella nuova, .env copiato da .env.example
  con chiave e modelli, poi solo i comandi del README.
- Problema 1, il back end non partiva: il filtro dei segreti dei log
  (parte 5) trattava come riservata ogni variabile con "TOKEN" nel
  nome, quindi anche TETTO_TOKEN_GIORNALIERO=300000 di .env.example. Il
  numero diventava [riservato] senza virgolette dentro la riga JSON, il
  formattatore leggibile andava in errore e fermava il back end. Nel
  progetto di sviluppo non si vedeva perché il suo .env non ha quella
  riga, e i test usavano tetti più corti di 6 cifre.
  - Correzione: riservati solo i nomi che finiscono per KEY, TOKEN,
    SECRET o PASSWORD (più REDIS_URL), mai i valori fatti solo di cifre;
    il formattatore scrive com'è una riga non JSON invece di fermare il
    servizio. Nel data agent le variabili di cache e
    MAX_CHIAMATE_OPENAI sono pubbliche e i numeri non sono mai
    riservati (prima un valore come CACHE_MAX_VOCI=1000000 avrebbe
    bloccato le risposte con quel numero).
  - Test: test_log.js con TETTO_TOKEN_GIORNALIERO=300000 (senza la
    correzione fallisce con lo stesso errore del clone) e un test in
    test_registro.py.
- Problema 2, solo su Windows: con il clone in una cartella dal
  percorso lungo, pip non riusciva a installare Jupyter (file oltre i
  260 caratteri). Nel README: tenere il progetto in un percorso corto
  o abilitare i percorsi lunghi di Windows.
