// Barra laterale: logo, dati del negozio, pulsanti delle azioni dirette e domande rapide.
import { AZIONI } from '../config.js'
import { formattaData, useTesti } from '../i18n.js'

// Classe CSS dell'etichetta per ogni tipo di domanda rapida
const CLASSE_TIPO = { RAG: 'etichetta--manuale', DATI: 'etichetta--dati', FUORI: 'etichetta--fuori' }

export default function Sidebar({ onDomanda, onAzione, inAttesa, scenario }) {
  const { lingua, t } = useTesti()
  const tipi = t('tipoDomanda')

  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo__marchio" aria-hidden="true">SV</span>
        <div>
          <div className="logo__nome">SpesaViva</div>
          <div className="logo__sottotitolo">{t('sottotitolo')}</div>
        </div>
      </div>

      <section className="negozio" aria-label={t('negozioAria')}>
        <div className="negozio__nome">{scenario.luogo ? `${scenario.negozio} · ${scenario.luogo}` : scenario.negozio}</div>
        <dl className="negozio__dettagli">
          <div>
            <dt>{t('capoNegozioEtichetta')}</dt>
            <dd>{scenario.capoNegozio}</dd>
          </div>
          <div>
            <dt>{t('datiAggiornatiEtichetta')}</dt>
            {/* I dati arrivano fino al giorno prima di "oggi" */}
            <dd className="mono">{formattaData(scenario.oggi, lingua, { spostamento: -1 })}</dd>
          </div>
        </dl>
      </section>

      {/* Azioni dirette: gli strumenti li chiama il codice, senza passare dalla scelta dell'LLM */}
      <section className="azioni" aria-labelledby="titolo-azioni">
        <h2 id="titolo-azioni" className="sidebar__titolo">{t('azioniTitolo')}</h2>
        {AZIONI.map((azione, i) => (
          <button
            key={azione}
            type="button"
            className={`pulsante ${i === 0 ? 'pulsante--principale' : 'pulsante--azione'}`}
            onClick={() => onAzione(azione)}
            disabled={inAttesa}
          >
            {t(`azione_${azione}`)}
          </button>
        ))}
      </section>

      {/* Domande rapide: passano dalla chat, come una domanda scritta */}
      <section className="domande-rapide" aria-labelledby="titolo-domande-rapide">
        <h2 id="titolo-domande-rapide" className="sidebar__titolo">{t('domandeRapideTitolo')}</h2>
        <ul>
          {t('domandeRapide').map((domanda) => (
            <li key={domanda.testo}>
              <button type="button" className="domanda-rapida" onClick={() => onDomanda(domanda.testo)} disabled={inAttesa}>
                <span className={`etichetta ${CLASSE_TIPO[domanda.tipo]}`}>{tipi[domanda.tipo]}</span>
                <span>{domanda.testo}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
