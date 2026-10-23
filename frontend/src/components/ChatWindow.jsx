// Area della chat: intestazione con scenario e lingua, benvenuto, messaggi, indicatore di attesa e campo di testo.
import { useEffect, useRef } from 'react'
import Message from './Message.jsx'
import TypingIndicator from './TypingIndicator.jsx'
import Composer from './Composer.jsx'
import { SCENARI } from '../config.js'
import { LINGUE, formattaData, useTesti } from '../i18n.js'

export default function ChatWindow({ messaggi, inAttesa, onInvia, onNuovaConversazione, scenario, onScenario, onValuta }) {
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
          <p className="chat__data">{formattaData(scenario.oggi, lingua, { conGiorno: true })}</p>
        </div>
        <div className="chat__azioni">
          {/* Scenario della demo: cambia data di "oggi" e negozio e fa partire una nuova conversazione */}
          <label className="selettore-scenario">
            <span>{t('scenarioEtichetta')}</span>
            <select value={scenario.id} onChange={(e) => onScenario(e.target.value)}>
              {SCENARI.map((s) => (
                <option key={s.id} value={s.id}>{t(`scenario_${s.id}`)}</option>
              ))}
            </select>
          </label>
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
            testo: scenario.nomeUtente ? t('benvenutoTitolo', { nome: scenario.nomeUtente }) : t('benvenutoTitoloSenzaNome'),
            sottotesto: t('benvenutoTesto'),
          }}
        />

        {messaggi.map((messaggio) => (
          <Message key={messaggio.id} messaggio={messaggio} onValuta={onValuta} />
        ))}

        {inAttesa && <TypingIndicator />}
        <div ref={fineMessaggi} />
      </div>

      <Composer onInvia={onInvia} disattivato={inAttesa} />
    </main>
  )
}
