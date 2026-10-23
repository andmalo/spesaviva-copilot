// Valutazione di una risposta: pollice su (inviato subito) o pollice giù (con commento facoltativo).
// Dopo l'invio compare "Grazie" e i pulsanti restano disattivati.
import { useId, useState } from 'react'
import { useTesti } from '../i18n.js'

const MAX_COMMENTO = 300 // uguale al limite del back end

function Pollice({ giu = false }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"
      style={giu ? { transform: 'rotate(180deg)' } : undefined}>
      <path fill="currentColor"
        d="M2 21h3V9H2v12zm19-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L12.2 1 6.6 6.6C6.2 7 6 7.5 6 8v11a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-2z" />
    </svg>
  )
}

/**
 * @param {string} idMessaggio - id della risposta assegnato dal back end
 * @param {(id: string, voto: 'su'|'giu', commento: string) => Promise<boolean>} onValuta
 */
export default function Valutazione({ idMessaggio, onValuta }) {
  const { t } = useTesti()
  // iniziale -> (giu: commento) -> invio -> grazie; in caso di errore si torna indietro con un avviso
  const [stato, setStato] = useState('iniziale')
  const [voto, setVoto] = useState(null)
  const [commento, setCommento] = useState('')
  const [errore, setErrore] = useState(false)
  const idCampo = useId()

  async function invia(v, testo = '') {
    setVoto(v)
    setStato('invio')
    setErrore(false)
    const ok = await onValuta(idMessaggio, v, testo.trim())
    if (ok) {
      setStato('grazie')
    } else {
      setErrore(true)
      setStato(v === 'giu' ? 'commento' : 'iniziale')
    }
  }

  const bloccato = stato === 'invio' || stato === 'grazie'

  return (
    <div className="valutazione">
      <div className="valutazione__pulsanti">
        <button
          type="button"
          className={`valutazione__pollice${voto === 'su' ? ' valutazione__pollice--scelto' : ''}`}
          aria-label={t('valutaUtile')}
          aria-pressed={voto === 'su'}
          disabled={bloccato || stato === 'commento'}
          onClick={() => invia('su')}
        >
          <Pollice />
        </button>
        <button
          type="button"
          className={`valutazione__pollice${voto === 'giu' ? ' valutazione__pollice--scelto' : ''}`}
          aria-label={t('valutaNonUtile')}
          aria-pressed={voto === 'giu'}
          disabled={bloccato || stato === 'commento'}
          onClick={() => { setVoto('giu'); setStato('commento') }}
        >
          <Pollice giu />
        </button>
        {stato === 'grazie' && <span className="valutazione__grazie" role="status">{t('valutazioneGrazie')}</span>}
      </div>

      {stato === 'commento' && (
        <form className="valutazione__commento" onSubmit={(e) => { e.preventDefault(); invia('giu', commento) }}>
          <label htmlFor={idCampo}>{t('valutazioneCommento')}</label>
          <textarea
            id={idCampo}
            rows={2}
            maxLength={MAX_COMMENTO}
            value={commento}
            onChange={(e) => setCommento(e.target.value)}
          />
          <button type="submit" className="pulsante pulsante--secondario pulsante--compatto">{t('valutazioneInvia')}</button>
        </form>
      )}

      {errore && <p className="valutazione__errore" role="alert">{t('valutazioneErrore')}</p>}
    </div>
  )
}
