// Riquadro "Riconoscimenti": miglioramenti calcolati dal briefing e bozza del messaggio alla squadra.
// È separato dalle anomalie e ha un colore diverso (verde chiaro), perché è una buona notizia.
import { useState } from 'react'
import { copiaNegliAppunti } from '../appunti.js'
import { fraseRiconoscimento, useTesti } from '../i18n.js'

export default function Riconoscimenti({ riconoscimenti, bozza }) {
  const { lingua, t } = useTesti()
  // Stato del pulsante: 'pronto', 'copiato' oppure 'errore'
  const [statoCopia, setStatoCopia] = useState('pronto')

  async function copia() {
    try {
      await copiaNegliAppunti(bozza)
      setStatoCopia('copiato')
    } catch {
      setStatoCopia('errore')
    }
    setTimeout(() => setStatoCopia('pronto'), 2500)
  }

  const etichettaPulsante = { pronto: t('copia'), copiato: t('copiato'), errore: t('copiaNonRiuscita') }[statoCopia]

  return (
    <section className="riconoscimenti" aria-labelledby="titolo-riconoscimenti">
      <h3 id="titolo-riconoscimenti" className="riconoscimenti__titolo">{t('riconoscimentiTitolo')}</h3>

      <ul className="riconoscimenti__elenco">
        {riconoscimenti.map((r) => {
          const { reparto, testo } = fraseRiconoscimento(r, lingua)
          return (
            <li key={r.reparto}>
              <strong className="riconoscimenti__reparto">{reparto}</strong>: {testo}
            </li>
          )
        })}
      </ul>

      {bozza && (
        <div className="riconoscimenti__bozza">
          <div className="riconoscimenti__intestazione-bozza">
            <span>{t('bozzaTitolo')}</span>
            <button type="button" className="riconoscimenti__copia" onClick={copia} aria-live="polite">
              {etichettaPulsante}
            </button>
          </div>
          <p className="riconoscimenti__testo-bozza">{bozza}</p>
        </div>
      )}
    </section>
  )
}
