// Badge degli strumenti usati dall'assistente, numerati nell'ordine di chiamata.
import { useTesti } from '../i18n.js'

// Stile per ogni strumento del back end (le etichette sono in i18n.js)
const CLASSI = {
  analizza_dati: 'badge--dati',
  cerca_procedure: 'badge--manuale',
  prepara_briefing: 'badge--dati',
  controlla_soglie: 'badge--dati',
}

export default function ToolBadges({ strumenti }) {
  const { t } = useTesti()
  if (strumenti.length === 0) {
    return <p className="badge-nessuno">{t('nessunoStrumento')}</p>
  }

  return (
    <ol className="badge-strumenti" aria-label={t('strumentiAria')}>
      {strumenti.map((strumento, i) => {
        const conosciuto = Object.hasOwn(CLASSI, strumento.nome)
        return (
          <li key={i} className={`badge ${CLASSI[strumento.nome] ?? ''}`}>
            <div className="badge__riga">
              <span className="badge__numero">{i + 1}</span>
              <span className="badge__etichetta">{conosciuto ? t(`strumento_${strumento.nome}`) : t('strumentoGenerico')}</span>
              <code className="badge__nome">{strumento.nome}</code>
            </div>
            {/* prepara_briefing non riceve una domanda: in quel caso non si mostra nulla */}
            {strumento.domanda && <em className="badge__domanda">{strumento.domanda}</em>}
          </li>
        )
      })}
    </ol>
  )
}
