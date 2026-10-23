// Riquadro del report per l'Area Manager, con lo stile di una mail e il pulsante "Copia".
// Nessun invio automatico: lo Store Manager copia il testo, lo controlla e lo invia lui.
import { useState } from 'react'
import { copiaNegliAppunti } from '../appunti.js'
import { useTesti } from '../i18n.js'

export default function ReportMail({ report }) {
  const { t } = useTesti()
  const [statoCopia, setStatoCopia] = useState('pronto')

  // Si copia la mail completa, oggetto compreso (il report è sempre in italiano)
  async function copia() {
    try {
      await copiaNegliAppunti(`Oggetto: ${report.oggetto}\n\n${report.corpo}`)
      setStatoCopia('copiato')
    } catch {
      setStatoCopia('errore')
    }
    setTimeout(() => setStatoCopia('pronto'), 2500)
  }

  const etichettaPulsante = { pronto: t('copia'), copiato: t('copiato'), errore: t('copiaNonRiuscita') }[statoCopia]

  return (
    <section className="report-mail" aria-labelledby="titolo-report">
      <div className="report-mail__barra">
        <h3 id="titolo-report" className="report-mail__titolo">{t('reportTitolo')}</h3>
        <button type="button" className="report-mail__copia" onClick={copia} aria-live="polite">
          {etichettaPulsante}
        </button>
      </div>
      <dl className="report-mail__intestazione">
        <div>
          <dt>{t('reportA')}</dt>
          <dd>{t('reportDestinatario')}</dd>
        </div>
        <div>
          <dt>{t('reportOggetto')}</dt>
          <dd className="report-mail__oggetto">{report.oggetto}</dd>
        </div>
      </dl>
      <p className="report-mail__corpo" lang="it">{report.corpo}</p>
      <p className="report-mail__nota">{t('reportNota')}</p>
    </section>
  )
}
