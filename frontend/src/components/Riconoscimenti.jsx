// Riquadro "Riconoscimenti": miglioramenti calcolati dal briefing e bozza del messaggio alla squadra.
// È separato dalle anomalie e ha un colore diverso (verde chiaro), perché è una buona notizia.
import { useState } from 'react'

// Numeri all'italiana: percentuali con 2 decimali (4,90%), variazioni con 1 (-21,6%), euro interi
const percentuale = (n, decimali = 2) =>
  `${n.toLocaleString('it-IT', { minimumFractionDigits: decimali, maximumFractionDigits: decimali })}%`
const euro = (n) => `${Math.round(n).toLocaleString('it-IT')} €`
// "ad agosto", "ad aprile", ma "a luglio"
const aMese = (mese) => (/^[aeiou]/i.test(mese) ? `ad ${mese}` : `a ${mese}`)

// Copia il testo negli appunti; se l'API moderna manca o rifiuta, prova il metodo classico
async function copiaNegliAppunti(testo) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(testo)
      return
    } catch {
      // permesso negato o pagina senza focus: si prova il metodo classico
    }
  }
  const area = document.createElement('textarea')
  area.value = testo
  area.setAttribute('readonly', '')
  area.style.position = 'absolute'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  const riuscito = document.execCommand('copy')
  document.body.removeChild(area)
  if (!riuscito) throw new Error('copia non riuscita')
}

export default function Riconoscimenti({ riconoscimenti, bozza }) {
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

  const etichettaPulsante = { pronto: 'Copia', copiato: 'Copiato', errore: 'Copia non riuscita' }[statoCopia]

  return (
    <section className="riconoscimenti" aria-labelledby="titolo-riconoscimenti">
      <h3 id="titolo-riconoscimenti" className="riconoscimenti__titolo">Riconoscimenti</h3>

      <ul className="riconoscimenti__elenco">
        {riconoscimenti.map((r) => (
          <li key={r.reparto}>
            <strong className="riconoscimenti__reparto">{r.reparto}</strong>: scarto al{' '}
            {r.tassi.map((t, i) => `${percentuale(t)} ${aMese(r.mesi[i])}`).join(' e al ')}, contro il{' '}
            {percentuale(r.riferimento)} degli stessi mesi dell'anno prima
            {r.periodo_riferimento ? ` (${r.periodo_riferimento})` : ''}, cioè {percentuale(r.variazione_pct, 1)}: circa{' '}
            {euro(r.euro_risparmiati)} di scarti in meno.
          </li>
        ))}
      </ul>

      {bozza && (
        <div className="riconoscimenti__bozza">
          <div className="riconoscimenti__intestazione-bozza">
            <span>Bozza del messaggio alla squadra</span>
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
