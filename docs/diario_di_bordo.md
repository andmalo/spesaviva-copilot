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
