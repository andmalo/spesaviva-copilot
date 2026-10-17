// Barra laterale: logo, dati del negozio, briefing e domande rapide.
import { CONFIG, DOMANDA_BRIEFING, DOMANDE_RAPIDE } from '../config.js'

// Classe CSS dell'etichetta per ogni tipo di domanda rapida
const CLASSE_TIPO = { RAG: 'etichetta--manuale', DATI: 'etichetta--dati', FUORI: 'etichetta--fuori' }

export default function Sidebar({ onDomanda, inAttesa }) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo__marchio" aria-hidden="true">SV</span>
        <div>
          <div className="logo__nome">SpesaViva</div>
          <div className="logo__sottotitolo">Store Manager Copilot</div>
        </div>
      </div>

      <section className="negozio" aria-label="Negozio">
        <div className="negozio__nome">{CONFIG.negozio}</div>
        <dl className="negozio__dettagli">
          <div>
            <dt>Capo negozio</dt>
            <dd>{CONFIG.capoNegozio}</dd>
          </div>
          <div>
            <dt>Dati aggiornati al</dt>
            <dd className="mono">{CONFIG.dataDati}</dd>
          </div>
        </dl>
      </section>

      <button type="button" className="pulsante pulsante--principale" onClick={() => onDomanda(DOMANDA_BRIEFING)} disabled={inAttesa}>
        Briefing del mattino
      </button>

      <section className="domande-rapide" aria-labelledby="titolo-domande-rapide">
        <h2 id="titolo-domande-rapide" className="sidebar__titolo">Domande rapide</h2>
        <ul>
          {DOMANDE_RAPIDE.map((domanda) => (
            <li key={domanda.testo}>
              <button type="button" className="domanda-rapida" onClick={() => onDomanda(domanda.testo)} disabled={inAttesa}>
                <span className={`etichetta ${CLASSE_TIPO[domanda.tipo]}`}>{domanda.tipo}</span>
                <span>{domanda.testo}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
