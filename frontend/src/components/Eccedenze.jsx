// Riga delle eccedenze donate nel briefing: solo chilogrammi, già calcolati dal data agent.
import { formattaData, formattaNumero, useTesti } from '../i18n.js'

export default function Eccedenze({ eccedenze }) {
  const { lingua, t } = useTesti()
  const kg = (n) => formattaNumero(n, lingua, 1)

  return (
    <p className="eccedenze">
      {/* Cuore: icona delle donazioni, diversa da quella degli scarti */}
      <svg className="eccedenze__icona" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3.4.6 1.2.6 1.6 0C12.8 6.1 14.2 5 16.2 5 19.6 5 21.7 8.4 20.2 11.8 18 16.4 12 21 12 21z"
        />
      </svg>
      <span className="eccedenze__etichetta">{t('eccedenzeEtichetta')}</span>
      <span>
        {t('eccedenzeValore', {
          ieri: kg(eccedenze.ieri),
          settimana: kg(eccedenze.settimana),
          dal: formattaData(eccedenze.settimana_dal, lingua, { conAnno: false }),
          al: formattaData(eccedenze.settimana_al, lingua),
        })}
      </span>
    </p>
  )
}
