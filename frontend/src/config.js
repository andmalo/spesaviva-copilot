// Dati fissi dello scenario mostrati nell'interfaccia.
// Non contiene chiavi né indirizzi dei servizi: il front end parla solo con /api (proxy di Vite).
export const CONFIG = {
  nomeUtente: 'Marco',
  negozio: 'NEG01 · Lugo',
  capoNegozio: 'Marco Bertoni',
  dataDati: '31 agosto 2026',
  dataOggi: 'Martedì 1 settembre 2026',
}

// Lunghezza massima di un messaggio, uguale al limite del back end
export const LUNGHEZZA_MASSIMA = 1000

// Tempo massimo di attesa della risposta (il data agent può impiegare fino a 2 minuti)
export const TIMEOUT_RICHIESTA_MS = 150_000

// Testo inviato dal pulsante "Briefing del mattino"
export const DOMANDA_BRIEFING =
  "Preparami il briefing di stamattina: com'è andata ieri, cosa c'è di anomalo e cosa devo fare."

// Domande rapide della barra laterale, con il tipo mostrato nell'etichetta
export const DOMANDE_RAPIDE = [
  { tipo: 'RAG', testo: 'Cosa faccio se una consegna di freschi arriva fuori temperatura?' },
  {
    tipo: 'DATI',
    testo: "Le vendite di questa settimana sono calate: dipende dall'affluenza o dallo scontrino medio?",
  },
  { tipo: 'DATI', testo: 'Quale reparto ha più scarti in rapporto alle vendite questo mese?' },
  { tipo: 'DATI', testo: 'Come sono i nostri scarti rispetto agli altri negozi?' },
  { tipo: 'FUORI', testo: 'Che tempo farà domani a Lugo?' },
]
