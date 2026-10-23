// Componente principale: tiene lo stato della chat, la lingua e lo scenario scelti e parla con il back end.
import { useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ChatWindow from './components/ChatWindow.jsx'
import { CHIAVE_LINGUA, SCENARI, TIMEOUT_RICHIESTA_MS } from './config.js'
import { LINGUE, LinguaContext, creaTraduttore, haTesto } from './i18n.js'

// Identificativo progressivo dei messaggi, usato come key nelle liste React
let contatoreMessaggi = 0
const nuovoId = () => ++contatoreMessaggi

// Lingua ricordata nel browser. localStorage può non essere disponibile
// (navigazione privata, dati bloccati): in quel caso si parte dall'italiano.
function linguaSalvata() {
  try {
    const valore = localStorage.getItem(CHIAVE_LINGUA)
    return LINGUE.includes(valore) ? valore : 'it'
  } catch {
    return 'it'
  }
}

export default function App() {
  const [messaggi, setMessaggi] = useState([])
  const [inAttesa, setInAttesa] = useState(false)
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
  const [lingua, setLinguaStato] = useState(linguaSalvata)
  // Scenario della demo: all'avvio il primo della lista (lo stesso predefinito del back end)
  const [scenario, setScenario] = useState(SCENARI[0])

  // Lingua e traduzioni condivise con tutti i componenti
  const contestoLingua = useMemo(() => {
    const setLingua = (nuova) => {
      setLinguaStato(nuova)
      try {
        localStorage.setItem(CHIAVE_LINGUA, nuova)
      } catch {
        // il browser non permette di salvare: la scelta vale solo per questa visita
      }
    }
    return { lingua, setLingua, t: creaTraduttore(lingua) }
  }, [lingua])
  const { t } = contestoLingua

  // Richiesta in corso, per poterla annullare con "Nuova conversazione"
  const richiestaInCorso = useRef(null)

  const aggiungi = (messaggio) => setMessaggi((precedenti) => [...precedenti, { id: nuovoId(), ...messaggio }])

  // Messaggio d'errore da mostrare: in italiano quello del back end (già pensato per l'utente),
  // in inglese la traduzione del suo codice oppure un messaggio generico
  function testoErrore(corpo, stato) {
    if (corpo && typeof corpo.errore === 'string') {
      if (lingua === 'it') return corpo.errore
      if (corpo.codice && haTesto(lingua, `errore_${corpo.codice}`)) return t(`errore_${corpo.codice}`)
      return t('erroreServer')
    }
    // Nessun corpo leggibile: di solito il proxy non riesce a raggiungere il back end
    return stato >= 500 ? t('erroreConnessione') : t('erroreServer')
  }

  /**
   * Invia una richiesta al back end e aggiunge alla chat la bolla dell'utente e la risposta.
   * @param {string} percorso - "/api/chat" oppure "/api/azioni/<azione>"
   * @param {object} corpo - dati della richiesta (sessionId, lingua e scenario si aggiungono qui)
   * @param {string} testoUtente - testo della bolla dell'utente
   */
  async function richiedi(percorso, corpo, testoUtente) {
    if (inAttesa) return
    aggiungi({ ruolo: 'utente', testo: testoUtente })
    setInAttesa(true)

    // AbortController: interrompe la richiesta dopo il timeout o con "Nuova conversazione"
    const controller = new AbortController()
    const stato = { controller, annullata: false }
    richiestaInCorso.current = stato
    const timer = setTimeout(() => controller.abort(), TIMEOUT_RICHIESTA_MS)

    try {
      const risposta = await fetch(percorso, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...corpo, sessionId, lingua, scenario: scenario.id }),
        signal: controller.signal,
      })

      let dati = null
      try {
        dati = await risposta.json()
      } catch {
        dati = null
      }
      if (stato.annullata) return

      if (risposta.ok && dati && typeof dati.risposta === 'string') {
        aggiungi({ ruolo: 'assistente', dati })
      } else {
        aggiungi({ ruolo: 'errore', testo: testoErrore(dati, risposta.status) })
      }
    } catch (errore) {
      if (stato.annullata) return
      aggiungi({ ruolo: 'errore', testo: errore.name === 'AbortError' ? t('erroreTimeout') : t('erroreConnessione') })
    } finally {
      clearTimeout(timer)
      // Solo la richiesta ancora attiva può sbloccare l'interfaccia
      if (richiestaInCorso.current === stato) {
        richiestaInCorso.current = null
        setInAttesa(false)
      }
    }
  }

  // Domanda scritta o domanda rapida: passa dalla chat (l'orchestratore sceglie gli strumenti)
  function invia(testo) {
    const domanda = testo.trim()
    if (domanda) richiedi('/api/chat', { messaggio: domanda }, domanda)
  }

  // Pulsanti della barra laterale: azioni dirette, gli strumenti li chiama il codice
  function eseguiAzione(azione) {
    richiedi(`/api/azioni/${azione}`, {}, t(`azione_${azione}`))
  }

  // Valutazione di una risposta (pollici): restituisce true se il back end l'ha registrata
  async function inviaValutazione(idMessaggio, voto, commento) {
    try {
      const risposta = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, idMessaggio, voto, ...(commento && { commento }) }),
        signal: AbortSignal.timeout(15_000),
      })
      return risposta.ok
    } catch {
      return false
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

  // Cambio di scenario: nuova sessione e chat vuota (benvenuto e dati del negozio si aggiornano da soli)
  function cambiaScenario(id) {
    const nuovo = SCENARI.find((s) => s.id === id)
    if (!nuovo || nuovo.id === scenario.id) return
    nuovaConversazione()
    setScenario(nuovo)
  }

  return (
    <LinguaContext.Provider value={contestoLingua}>
      <div className="app">
        <Sidebar onDomanda={invia} onAzione={eseguiAzione} inAttesa={inAttesa} scenario={scenario} />
        <ChatWindow
          messaggi={messaggi}
          inAttesa={inAttesa}
          onInvia={invia}
          onNuovaConversazione={nuovaConversazione}
          scenario={scenario}
          onScenario={cambiaScenario}
          onValuta={inviaValutazione}
        />
      </div>
    </LinguaContext.Provider>
  )
}
