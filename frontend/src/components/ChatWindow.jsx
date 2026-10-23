// Area della chat: intestazione con lingua, benvenuto, messaggi, indicatore di attesa e campo di testo.
import { useEffect, useRef } from 'react'
import Message from './Message.jsx'
import TypingIndicator from './TypingIndicator.jsx'
import Composer from './Composer.jsx'
import { LINGUE, useTesti } from '../i18n.js'

export default function ChatWindow({ messaggi, inAttesa, onInvia, onNuovaConversazione }) {
  const { lingua, setLingua, t } = useTesti()
  const fineMessaggi = useRef(null)

  // Scorrimento automatico all'ultimo messaggio (o all'indicatore di attesa)
  useEffect(() => {
    fineMessaggi.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messaggi, inAttesa])

  return (
    <main className="chat">
      <header className="chat__intestazione">
        <div>
          <h1 className="chat__titolo">{t('conversazione')}</h1>
          <p className="chat__data">{t('dataOggi')}</p>
        </div>
        <div className="chat__azioni">
          <ul className="legenda" aria-label={t('legendaAria')}>
            <li><span className="badge-legenda badge-legenda--manuale">{t('legendaManuale')}</span></li>
            <li><span className="badge-legenda badge-legenda--dati">{t('legendaDati')}</span></li>
          </ul>
          {/* Selettore della lingua: IT / EN */}
          <div className="selettore-lingua" role="group" aria-label={t('linguaAria')}>
            {LINGUE.map((codice) => (
              <button
                key={codice}
                type="button"
                className={`selettore-lingua__voce${codice === lingua ? ' selettore-lingua__voce--attiva' : ''}`}
                aria-pressed={codice === lingua}
                onClick={() => setLingua(codice)}
              >
                {codice.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className="pulsante pulsante--secondario pulsante--compatto" onClick={onNuovaConversazione}>
            {t('nuovaConversazione')}
          </button>
        </div>
      </header>

      <div className="chat__messaggi" aria-live="polite">
        {/* Benvenuto generato dal front end: non viene inviato al back end */}
        <Message
          messaggio={{
            ruolo: 'benvenuto',
            testo: t('benvenutoTitolo', { nome: t('nomeUtente') }),
            sottotesto: t('benvenutoTesto'),
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
