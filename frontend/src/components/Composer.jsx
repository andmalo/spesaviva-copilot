// Campo di testo per scrivere la domanda: invio con Enter o con il pulsante.
import { useState } from 'react'
import { LUNGHEZZA_MASSIMA } from '../config.js'
import { useTesti } from '../i18n.js'

export default function Composer({ onInvia, disattivato }) {
  const { t } = useTesti()
  const [testo, setTesto] = useState('')
  const vuoto = testo.trim() === ''

  function invia() {
    if (vuoto || disattivato) return
    onInvia(testo)
    setTesto('')
  }

  // Enter invia la domanda, Shift+Enter va a capo
  function gestisciTasto(evento) {
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault()
      invia()
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(evento) => {
        evento.preventDefault()
        invia()
      }}
    >
      <label htmlFor="campo-domanda" className="composer__etichetta">
        {t('campoEtichetta')}
      </label>
      <div className="composer__riga">
        <textarea
          id="campo-domanda"
          className="composer__campo"
          rows={2}
          value={testo}
          onChange={(evento) => setTesto(evento.target.value)}
          onKeyDown={gestisciTasto}
          maxLength={LUNGHEZZA_MASSIMA}
          disabled={disattivato}
          placeholder={t('campoSegnaposto')}
          aria-describedby="contatore-caratteri"
        />
        <button type="submit" className="composer__invia" aria-label={t('inviaAria')} disabled={disattivato || vuoto}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p id="contatore-caratteri" className="composer__contatore mono">
        {testo.length}/{LUNGHEZZA_MASSIMA}
      </p>
    </form>
  )
}
