# Mappa del codice

Guida allo studio del progetto: a cosa serve ogni file, le funzioni principali e
il percorso di una richiesta dalla chat alla risposta.

## Architettura in breve

```
Browser (React, porta 5173)
   │  /api/...  (proxy di Vite)
   ▼
Orchestratore Node.js (backend/, porta 3001, solo 127.0.0.1)
   │  LLM con function calling (OpenAI) + regole fisse nel codice
   ├──► ChromaDB (porta 8000): ricerca nel manuale operativo (RAG)
   └──► Data agent FastAPI (data_agent/, porta 8001, solo 127.0.0.1)
          ├─ /analizza  → pandas agent di LangChain (LLM)
          └─ /briefing, /soglie, /confronto → solo pandas, nessun LLM
```

Principio seguito in tutto il progetto: **l'LLM decide cosa fare e scrive il
testo; il codice esegue i passaggi che devono essere sempre uguali** (soglie,
calcoli, grafici, fonti, sicurezza).

---

## Radice

### `avvia.mjs`
Installazione (`npm run setup`) e avvio di tutti i servizi (`npm start`) con un
solo comando, su Windows, macOS e Linux. Avvia i servizi in ordine, aspetta che
ognuno sia pronto e con Ctrl+C li ferma tutti.
- `setup()`, `start()`: i due comandi.
- `avvia()`, `fermaTutti()`: processi figli con prefisso nel log e arresto dell'albero dei processi.
- `attendiPronto()`, `controllaPorteLibere()`, `leggiConfigurazione()` (controlla il `.env` senza stampare la chiave).

### `package.json`, `requirements.txt`, `.env.example`
Script `setup` e `start`; dipendenze Python con versioni fissate (pandas 3.0.5
per Smart App Control); modello del `.env` (porte, modelli, limiti).

---

## backend/ – Orchestratore (Node.js + Express)

### `server.js`
Il cuore dell'orchestratore: rotte HTTP, sessioni in memoria, limiti di
sicurezza e ciclo di function calling con l'LLM.
- Rotte: `POST /api/chat`, `POST /api/azioni/:azione`, `POST /api/feedback`, `GET /api/scenari`, `GET /api/health`.
- `rispondi()`: ciclo di function calling (al massimo 6 chiamate al modello, uno strumento alla volta).
- `creaCompletamento()`: una chiamata a OpenAI con i controlli (annullamento, tetto giornaliero di token, tetto di chiamate) e gli errori tradotti in messaggi fissi.
- `eseguiStrumento()`: valida gli argomenti scelti dal modello, prenota le chiamate, esegue lo strumento e raccoglie fonti, grafici, calcoli.
- `completaRisposta()`: regole fisse sul testo finale (fonti dichiarate, bozza, niente domanda finale, fonte ufficiale in inglese).
- `promptSistema()`, `componiMessaggi()`: prompt per scenario (statico, per la cache di OpenAI) + memoria + lingua.
- `leggiSessione()`, `salvaSessione()`, `leggiScenario()`, `controllaSessione()`: sessioni (max 100, scadenza 1 ora) e validazioni.

### `strumenti.js`
Gli strumenti che l'LLM può chiamare. Ognuno restituisce `testoPerLLM` (l'unica
cosa che torna al modello) e campi per il front end.
- `cerca_procedure()`: ricerca nel manuale (k=3, distanza ≤ 0,40).
- `analizza_dati()`: domanda libera al data agent.
- `prepara_briefing()`, `controlla_soglie()`, `confronta_negozi()`: calcoli deterministici del data agent.
- `chiediAlDataAgent()`: chiamata HTTP comune, con timeout ed errori senza dettagli sensibili.
- `testoBriefing()`: trasforma il briefing in testo compatto con gli esiti già decisi.

### `azioni.js`
Le azioni dirette dei pulsanti (briefing, controllo soglie, report per l'Area
Manager): gli strumenti li chiama il codice in ordine fisso, l'LLM scrive solo il testo.
- `creaAzioni()` → `briefing()`, `soglie()`, `report()`, `eseguiAzione()`.
- `superamenti()`: elenco delle soglie superate, costruito dal codice per il report.
- `ultimaSettimanaCompleta()`, `periodoLeggibile()`.

### `testo_risposte.js`
Regole fisse applicate al testo dell'LLM.
- `separaFonti()` (blocco `[FONTI]`), `separaBozza()` (blocco `[BOZZA]`).
- `togliDomandaFinale()`: toglie le frasi finali che offrono altro.
- `aggiungiFonteUfficiale()`: in inglese aggiunge la fonte (manuale in italiano).

### `scenari.js` + `scenari.json`
I tre scenari della demo (data di "oggi" e negozio), letti anche dal data agent
e dal front end. Il browser invia solo l'id.
- `trovaScenario()`, `dateScenario()` (oggi, ieri, settimana, mese corrente); `daIso()`, `aIso()`, `piuGiorni()`.

### `feedback.js` + `riepilogo_feedback.js`
Valutazione delle risposte con i pollici. Il server ricorda ogni risposta con un
id: domanda, strumenti e risposta salvati vengono dal server, non dal browser.
- `creaFeedback()` → `ricordaRisposta()`, `registraVoto()` (validazione, max 5 voti per risposta, una riga in `feedback.jsonl`).
- `riepilogo_feedback.js`: voti positivi e negativi per strumento (conta l'ultimo voto di ogni risposta).

### `prompts/sistema.txt`, `prompts/strumenti.json`
Prompt di sistema dell'orchestratore e definizioni degli strumenti per il
function calling. Calibrati con i test: non si modificano senza ripetere i test.

### `rag/`
- `config.js`: client ChromaDB e funzione di embedding (text-embedding-3-small).
- `indicizza.js`: divide il manuale in un chunk per sezione `##` e lo indicizza (`dividiInChunk()`, `main()`).
- `cerca.js`: `cercaProcedure()` (ricerca per somiglianza) e `sezioniPerTitolo()` (recupero per titolo, usato dal report).

### Test del back end
- `test_scenari.js`: briefing, soglie e confronto per ogni scenario; scenari non validi rifiutati (nessuna chiamata a OpenAI).
- `test_feedback.js`: valutazioni con il server vero e un finto OpenAI locale.
- `test_orchestratore.js`, `rag/test_ricerca.js`: con chiamate reali, da usare solo quando serve.

---

## data_agent/ – Servizio Python (FastAPI)

### `app.py`
Servizio FastAPI: configurazione sicura, copia dei dati per ogni richiesta,
pandas agent e endpoint.
- Endpoint: `/analizza`, `/briefing`, `/soglie`, `/confronto`, `/health`, `/charts` (grafici).
- `esegui_analisi()`: crea il pandas agent (max 5 passi, timeout, nessun retry), filtra la risposta, estrae codice e grafico.
- `nuova_copia_dati()`: copia nuova da bytes con controllo sha256, tagliata a "ieri" dello scenario.
- `contiene_dati_riservati()`, `codice_eseguito()`: filtro dei segreti e codice per "Come l'ho calcolato".
- La chiave OpenAI non va mai in `os.environ` (letta con `dotenv_values`).

### `briefing.py`
Tutti i calcoli deterministici, solo pandas: soglie del manuale, briefing,
riconoscimenti, eccedenze, confronto tra negozi e le regole mostrate all'utente.
- `SOGLIE`: le soglie copiate dal manuale operativo.
- `prepara_briefing()`: KPI di ieri, anomalie, stato dei controlli, riconoscimenti, grafico.
- `controlla_soglie()`, `testo_soglie()`, `soglie_superate()`: controlli su un periodo qualsiasi.
- `controlla_miglioramenti()`: riconoscimenti (−10% rispetto allo stesso mese dell'anno prima, 2 mesi di fila).
- `confronta_negozi()`, `testo_confronto()`: tassi di scarto confrontati tra negozi (solo rapporti).
- `kpi_periodo()`, `eccedenze_donate()`, `REGOLE_BRIEFING` / `REGOLE_SOGLIE` / `REGOLE_CONFRONTO`.

### `grafici.py`
Grafici disegnati dal codice: l'agente scrive solo una "spec" JSON in fondo
alla risposta.
- `estrai_blocco_grafico()`, `leggi_spec()` (JSON, poi `ast.literal_eval`, mai `eval`).
- `valida_spec()`: unità ammesse, valori finiti, max 12 barre.
- `disegna_grafico()`: barre orizzontali, sempre lo stesso stile, un grafico alla volta (lock).

### `pulizia.py`
Pulizia del CSV in memoria (il file non si modifica): date in tre formati, nomi
dei negozi, duplicati, valori impossibili e anomali, colonna `settimana`.
- `pulisci_dati()`, `riepilogo_pulizia()`.

### `prompt_data_agent.txt`, `prototipo_data_agent.ipynb`, `tests/`
Prompt del pandas agent (calibrato con i test); notebook della fase di
prototipazione; test pytest (pulizia, briefing, soglie, confronto, grafici, sicurezza).

---

## frontend/ – Interfaccia (React + Vite)

- `App.jsx`: stato della chat, lingua e scenario; `richiedi()` invia al back end con timeout e annullamento; `inviaValutazione()`.
- `i18n.js`: tutti i testi in italiano e in inglese, `useTesti()`, formattazione di date e numeri.
- `config.js`: costanti (lunghezza massima, timeout, azioni, scenari da `backend/scenari.json`).
- `components/`:
  - `Sidebar.jsx` (negozio, azioni, domande rapide), `ChatWindow.jsx` (intestazione, scenario, lingua, messaggi), `Composer.jsx` (campo di testo);
  - `Message.jsx` (una risposta: markdown senza link né immagini esterne, badge, grafici, sezioni);
  - `ToolBadges.jsx`, `Eccedenze.jsx`, `Riconoscimenti.jsx`, `ReportMail.jsx`, `ComeCalcolato.jsx`, `Valutazione.jsx`, `TypingIndicator.jsx`.
- `appunti.js`: copia negli appunti (pulsanti Copia).
- `vite.config.js`: proxy `/api` verso il back end; accesso al solo file `scenari.json` fuori da `frontend/`.

## data/

- `genera_dataset.py`: genera `dati_negozi.csv` (seed fisso) con stagionalità, anomalie di business da scoprire (ondata di caldo, fornitore in crisi, negozio sprecone, settimana influenzale, miglioramento della panetteria) e errori da pulire.
- `documenti/manuale_operativo.md`, `documenti/scheda_negozio_NEG01.md`: le fonti del RAG.

---

## Percorso di una richiesta

### 1. Briefing del mattino (pulsante)

1. `Sidebar.jsx` → `App.eseguiAzione("briefing")` → `POST /api/azioni/briefing` con sessione, lingua e id dello scenario.
2. `server.js`: limite di frequenza, validazione di scenario e sessione, tetto giornaliero → `azioni.eseguiAzione()`.
3. `azioni.briefing()` → `strumenti.prepara_briefing()` → `POST /briefing` del data agent.
4. `app.briefing()` → `briefing.prepara_briefing()` su una copia dei dati fino a ieri: KPI, `controlla_soglie()` sulle serie che arrivano a ieri, anomalie, `_stato_controlli()`, riconoscimenti, eccedenze, grafico. Nessun LLM.
5. Per ogni anomalia `cerca_procedure()` con la sua `domanda_procedura` (ChromaDB).
6. **Una sola** chiamata al modello (`chiamaModello()`) con dati e procedure già pronti: scrive il testo.
7. Regole fisse: fonti dichiarate, bozza del riconoscimento, niente domanda finale, fonte ufficiale in inglese.
8. Il server salva la memoria della sessione, assegna l'`id_messaggio` per i pollici e risponde; `Message.jsx` mostra testo, eccedenze, riconoscimenti, grafico, sezioni e "Come l'ho calcolato".

### 2. Domanda sui dati ("Quale reparto ha più scarti in rapporto alle vendite questo mese?")

1. `Composer.jsx` → `App.invia()` → `POST /api/chat`.
2. `server.rispondi()`: il modello riceve prompt, memoria e domanda e sceglie `analizza_dati` con una domanda completa e autonoma.
3. `eseguiStrumento()` prenota 5 chiamate (caso peggiore) → `strumenti.analizza_dati()` → `POST /analizza`.
4. `app.esegui_analisi()`: copia dei dati fino a ieri, prompt con data e negozio dello scenario, pandas agent (codice Python eseguito sui dati, max 5 passi).
5. Filtro dei segreti sulla risposta; il codice eseguito va in "Come l'ho calcolato"; il blocco JSON del grafico viene validato e disegnato dal codice.
6. Il testo torna al modello, che scrive la risposta finale. Se avesse dato numeri senza strumenti, il codice l'avrebbe scartata e obbligato a usarne uno.
7. Per i confronti tra negozi il modello usa invece `confronta_negozi` (calcolo fisso con pandas).

### 3. Domanda sul manuale ("Cosa faccio se una consegna di freschi arriva fuori temperatura?")

1. `POST /api/chat` → `rispondi()`: il modello sceglie `cerca_procedure` (domanda sempre in italiano, perché il manuale è in italiano).
2. `strumenti.cerca_procedure()` → `rag/cerca.cercaProcedure()`: embedding della domanda e ricerca in ChromaDB; si tengono le sezioni con distanza ≤ 0,40.
3. Il modello riceve i testi delle sezioni e l'istruzione di elencare quelle usate tra `[FONTI]` e `[/FONTI]`.
4. `completaRisposta()`: si mostrano solo le sezioni dichiarate **e** davvero trovate (il modello non può inventarne); in inglese il codice aggiunge la fonte ufficiale.

---

## Domande che un docente potrebbe fare

1. Perché alcune funzioni (briefing, soglie, confronto tra negozi) sono calcolate solo con pandas e non dal pandas agent?
2. Come impedisce il data agent che il codice generato dall'LLM legga la chiave OpenAI o alteri i dati delle richieste successive?
3. Che cosa succede se il modello risponde con dei numeri senza aver chiamato nessuno strumento?
4. Perché il front end invia solo l'id dello scenario e non la data e il negozio?
5. Come si evita che le sezioni del manuale mostrate all'utente siano inventate dal modello?
6. Quali limiti di costo e di frequenza ci sono, dove sono applicati e che cosa non coprono?
7. Perché i grafici non li disegna direttamente l'agente, e perché `ast.literal_eval` invece di `eval`?
8. Come funziona il ciclo di function calling e perché `parallel_tool_calls` è disattivato?
9. Come avete misurato la qualità delle risposte e che cosa avete deciso dopo l'esperimento sui modelli?
10. Quali sono i limiti noti del sistema e come li affrontereste con più tempo?
