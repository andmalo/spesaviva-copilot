// Valutazione di una risposta: pollice su (inviato subito) o pollice giù (con commento facoltativo).
// Dopo l'invio compare "Grazie"; il voto si può cambiare cliccando l'altro pollice.
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
  const [voto, setVoto] = useState(null)          // ultimo voto registrato dal back end
  const [commentoAperto, setCommentoAperto] = useState(false)
  const [commento, setCommento] = useState('')
  const [inInvio, setInInvio] = useState(false)
  const [grazie, setGrazie] = useState(false)
  const [errore, setErrore] = useState(false)
  const idCampo = useId()

  async function invia(v, testo = '') {
    setInInvio(true)
    setErrore(false)
    const ok = await onValuta(idMessaggio, v, testo.trim())
    setInInvio(false)
    if (ok) {
      setVoto(v)
      setCommentoAperto(false)
      setGrazie(true)
    } else {
      setErrore(true)
    }
  }

  function cliccaSu() {
    setCommentoAperto(false)
    if (voto !== 'su') invia('su') // stesso voto di prima: non serve reinviarlo
  }

  function cliccaGiu() {
    // Il pollice giù chiede prima il commento (facoltativo); il voto parte con "Invia"
    setGrazie(false)
    setCommentoAperto(true)
  }

  // Pollice evidenziato: quello registrato, oppure il giù mentre si scrive il commento
  const scelto = commentoAperto ? 'giu' : voto

  return (
    <div className="valutazione">
      <div className="valutazione__pulsanti">
        <button
          type="button"
          className={`valutazione__pollice${scelto === 'su' ? ' valutazione__pollice--su' : ''}`}
          aria-label={t('valutaUtile')}
          aria-pressed={scelto === 'su'}
          disabled={inInvio}
          onClick={cliccaSu}
        >
          <Pollice />
        </button>
        <button
          type="button"
          className={`valutazione__pollice${scelto === 'giu' ? ' valutazione__pollice--giu' : ''}`}
          aria-label={t('valutaNonUtile')}
          aria-pressed={scelto === 'giu'}
          disabled={inInvio || commentoAperto}
          onClick={cliccaGiu}
        >
          <Pollice giu />
        </button>
        {grazie && !commentoAperto && <span className="valutazione__grazie" role="status">{t('valutazioneGrazie')}</span>}
      </div>

      {commentoAperto && (
        <form className="valutazione__commento" onSubmit={(e) => { e.preventDefault(); invia('giu', commento) }}>
          <label htmlFor={idCampo}>{t('valutazioneCommento')}</label>
          <textarea
            id={idCampo}
            rows={2}
            maxLength={MAX_COMMENTO}
            value={commento}
            onChange={(e) => setCommento(e.target.value)}
          />
          <button type="submit" className="pulsante pulsante--secondario pulsante--compatto" disabled={inInvio}>
            {t('valutazioneInvia')}
          </button>
        </form>
      )}

      {errore && <p className="valutazione__errore" role="alert">{t('valutazioneErrore')}</p>}
    </div>
  )
}
