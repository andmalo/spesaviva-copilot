// "Come l'ho calcolato": pulsante che apre un pannello con il codice eseguito dal data agent
// o con le regole fisse degli strumenti deterministici. Il codice è solo testo: React lo mostra
// già "escapato" e il front end non lo esegue mai.
import { useId, useState } from 'react'
import { useTesti } from '../i18n.js'

export default function ComeCalcolato({ calcoli }) {
  const { t } = useTesti()
  const [aperto, setAperto] = useState(false)
  const idPannello = useId()

  return (
    <div className="calcolo">
      <button
        type="button"
        className="pulsante pulsante--secondario pulsante--compatto"
        aria-expanded={aperto}
        aria-controls={idPannello}
        onClick={() => setAperto((a) => !a)}
      >
        {t('comeCalcolato')}
      </button>
      {aperto && (
        <div id={idPannello} className="calcolo__pannello">
          {calcoli.map((c, i) => (
            <section key={i} className="calcolo__voce">
              <h4>
                {t(`strumento_${c.strumento}`)} · {t(c.tipo === 'codice' ? 'calcoloCodice' : 'calcoloRegole')}
              </h4>
              <pre className="calcolo__testo"><code>{c.testo}</code></pre>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
