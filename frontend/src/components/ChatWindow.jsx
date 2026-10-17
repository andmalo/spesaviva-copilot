// Area della chat: intestazione, benvenuto, messaggi, indicatore di attesa e campo di testo.
import { useEffect, useRef } from 'react'
import Message from './Message.jsx'
import TypingIndicator from './TypingIndicator.jsx'
import Composer from './Composer.jsx'
import { CONFIG } from '../config.js'

export default function ChatWindow({ messaggi, inAttesa, onInvia, onNuovaConversazione }) {
  const fineMessaggi = useRef(null)

  // Scorrimento automatico all'ultimo messaggio (o all'indicatore di attesa)
  useEffect(() => {
    fineMessaggi.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messaggi, inAttesa])

  return (
    <main className="chat">
      <header className="chat__intestazione">
        <div>
          <h1 className="chat__titolo">Conversazione</h1>
          <p className="chat__data">{CONFIG.dataOggi}</p>
        </div>
        <div className="chat__azioni">
          <ul className="legenda" aria-label="Legenda delle fonti">
            <li><span className="badge-legenda badge-legenda--manuale">Manuale (RAG)</span></li>
            <li><span className="badge-legenda badge-legenda--dati">Dati del negozio</span></li>
          </ul>
          <button type="button" className="pulsante pulsante--secondario pulsante--compatto" onClick={onNuovaConversazione}>
            Nuova conversazione
          </button>
        </div>
      </header>

      <div className="chat__messaggi" aria-live="polite">
        {/* Benvenuto generato dal front end: non viene inviato al back end */}
        <Message
          messaggio={{
            ruolo: 'benvenuto',
            testo: `Buongiorno ${CONFIG.nomeUtente}, dimmi pure di cosa hai bisogno.`,
            sottotesto:
              'Posso analizzare i dati del negozio o cercare nel manuale operativo SpesaViva. Per partire, prova il briefing del mattino.',
          }}
        />

        {messaggi.map((messaggio) => (
          <Message key={messaggio.id} messaggio={messaggio} />
        ))}

        {inAttesa && <TypingIndicator />}
        <div ref={fineMessaggi} />
      </div>

      <Composer onInvia={onInvia} disattivato={inAttesa} />
    </main>
  )
}
