// Componente principale: tiene lo stato della chat e parla con il back end.
import { useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ChatWindow from './components/ChatWindow.jsx'
import { TIMEOUT_RICHIESTA_MS } from './config.js'

// Messaggi d'errore mostrati all'utente: in italiano e senza dettagli tecnici
const ERRORE_CONNESSIONE = 'Non riesco a contattare il server. Controlla che il servizio sia avviato e riprova tra poco.'
const ERRORE_TIMEOUT = 'La risposta sta impiegando troppo tempo e ho interrotto la richiesta. Riprova tra poco, magari con una domanda più semplice.'
const ERRORE_SERVER = 'Si è verificato un problema nel preparare la risposta. Riprova tra poco.'

// Identificativo progressivo dei messaggi, usato come key nelle liste React
let contatoreMessaggi = 0
const nuovoId = () => ++contatoreMessaggi

export default function App() {
  const [messaggi, setMessaggi] = useState([])
  const [inAttesa, setInAttesa] = useState(false)
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())

  // Richiesta in corso, per poterla annullare con "Nuova conversazione"
  const richiestaInCorso = useRef(null)

  const aggiungi = (messaggio) => setMessaggi((precedenti) => [...precedenti, { id: nuovoId(), ...messaggio }])

  async function invia(testo) {
    const domanda = testo.trim()
    if (!domanda || inAttesa) return

    aggiungi({ ruolo: 'utente', testo: domanda })
    setInAttesa(true)

    // AbortController: interrompe la richiesta dopo il timeout o con "Nuova conversazione"
    const controller = new AbortController()
    const stato = { controller, annullata: false }
    richiestaInCorso.current = stato
    const timer = setTimeout(() => controller.abort(), TIMEOUT_RICHIESTA_MS)

    try {
      const risposta = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messaggio: domanda }),
        signal: controller.signal,
      })

      // Il corpo può mancare (per esempio se il proxy non raggiunge il back end)
      let corpo = null
      try {
        corpo = await risposta.json()
      } catch {
        corpo = null
      }

      if (stato.annullata) return

      if (risposta.ok && corpo && typeof corpo.risposta === 'string') {
        aggiungi({ ruolo: 'assistente', dati: corpo })
      } else if (corpo && typeof corpo.errore === 'string') {
        // Il back end restituisce già messaggi fissi in italiano, pensati per l'utente
        aggiungi({ ruolo: 'errore', testo: corpo.errore })
      } else {
        // Nessun corpo leggibile: di solito il proxy non riesce a raggiungere il back end
        aggiungi({ ruolo: 'errore', testo: risposta.status >= 500 ? ERRORE_CONNESSIONE : ERRORE_SERVER })
      }
    } catch (errore) {
      if (stato.annullata) return
      aggiungi({ ruolo: 'errore', testo: errore.name === 'AbortError' ? ERRORE_TIMEOUT : ERRORE_CONNESSIONE })
    } finally {
      clearTimeout(timer)
      // Solo la richiesta ancora attiva può sbloccare l'interfaccia
      if (richiestaInCorso.current === stato) {
        richiestaInCorso.current = null
        setInAttesa(false)
      }
    }
  }

  // Nuova conversazione: annulla la richiesta in corso, svuota la chat e cambia sessione
  function nuovaConversazione() {
    if (richiestaInCorso.current) {
      richiestaInCorso.current.annullata = true
      richiestaInCorso.current.controller.abort()
      richiestaInCorso.current = null
    }
    setMessaggi([])
    setInAttesa(false)
    setSessionId(crypto.randomUUID())
  }

  return (
    <div className="app">
      <Sidebar onDomanda={invia} onNuovaConversazione={nuovaConversazione} inAttesa={inAttesa} />
      <ChatWindow messaggi={messaggi} inAttesa={inAttesa} onInvia={invia} />
    </div>
  )
}
