// Costanti tecniche del front end. I testi dell'interfaccia sono in i18n.js.
// Non contiene chiavi né indirizzi dei servizi: il front end parla solo con /api (proxy di Vite).

// Lunghezza massima di un messaggio, uguale al limite del back end
export const LUNGHEZZA_MASSIMA = 1000

// Tempo massimo di attesa della risposta (il data agent può impiegare fino a 2 minuti)
export const TIMEOUT_RICHIESTA_MS = 150_000

// Azioni dirette della barra laterale (POST /api/azioni/:azione)
export const AZIONI = ['briefing', 'soglie', 'report']

// Scenari della demo: lo stesso file letto dal back end e dal data agent.
// Al back end si invia solo l'id dello scenario, mai date o negozi.
export { default as SCENARI } from '../../backend/scenari.json'

// Chiave usata per ricordare la lingua scelta nel browser
export const CHIAVE_LINGUA = 'spesaviva-lingua'
