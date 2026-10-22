// Un messaggio della chat: bolla dell'utente, card dell'assistente, benvenuto o avviso d'errore.
import ReactMarkdown from 'react-markdown'
import ToolBadges from './ToolBadges.jsx'
import Riconoscimenti from './Riconoscimenti.jsx'

// Il markdown scritto dall'LLM non deve far caricare nulla dall'esterno:
// - i link restano semplice testo (niente indirizzo cliccabile);
// - le immagini non vengono caricate: si mostra solo il testo alternativo, se c'è.
// Un'immagine esterna verrebbe scaricata dal browser in automatico e potrebbe far uscire
// dati nell'indirizzo. I grafici del data agent non passano da qui: sono <img> a parte.
const COMPONENTI_MARKDOWN = {
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => (alt ? <span className="immagine-rimossa">[{alt}]</span> : null),
}

// Testo alternativo dei grafici: se c'è un grafico per ogni analisi, uso la domanda dell'analisi
function testoAlternativo(strumenti, grafici, indice) {
  const analisi = strumenti.filter((s) => s.nome === 'analizza_dati')
  if (analisi.length === grafici.length) {
    return `Grafico generato dall'analisi dei dati del negozio: ${analisi[indice].domanda}`
  }
  return `Grafico ${indice + 1} generato dall'analisi dei dati del negozio`
}

function Avatar({ avviso = false }) {
  return (
    <span className={`avatar${avviso ? ' avatar--avviso' : ''}`} aria-hidden="true">
      SV
    </span>
  )
}

export default function Message({ messaggio }) {
  // Messaggio dell'utente: bolla verde a destra
  if (messaggio.ruolo === 'utente') {
    return (
      <div className="messaggio messaggio--utente">
        <p className="bolla">{messaggio.testo}</p>
      </div>
    )
  }

  // Benvenuto iniziale, generato dal front end
  if (messaggio.ruolo === 'benvenuto') {
    return (
      <div className="messaggio messaggio--assistente">
        <Avatar />
        <div className="card">
          <p className="card__titolo">{messaggio.testo}</p>
          <p className="card__sottotesto">{messaggio.sottotesto}</p>
        </div>
      </div>
    )
  }

  // Errore: messaggio dell'assistente con stile di avviso
  if (messaggio.ruolo === 'errore') {
    return (
      <div className="messaggio messaggio--assistente">
        <Avatar avviso />
        <div className="card card--avviso" role="alert">
          <p>{messaggio.testo}</p>
        </div>
      </div>
    )
  }

  // Risposta dell'assistente con strumenti, testo, grafici, sezioni e nota sulla pulizia
  const {
    risposta, strumenti = [], grafici = [], sezioni_consultate = [], pulizia,
    riconoscimenti = [], bozza_riconoscimento: bozza = null,
  } = messaggio.dati

  return (
    <div className="messaggio messaggio--assistente">
      <Avatar />
      <article className="card">
        <ToolBadges strumenti={strumenti} />

        {/* Markdown senza HTML grezzo: eventuali tag HTML nella risposta vengono ignorati */}
        <div className="risposta">
          <ReactMarkdown skipHtml components={COMPONENTI_MARKDOWN}>
            {risposta}
          </ReactMarkdown>
        </div>

        {/* Riconoscimenti del briefing, se presenti: riquadro verde chiaro, separato dalle anomalie */}
        {riconoscimenti.length > 0 && <Riconoscimenti riconoscimenti={riconoscimenti} bozza={bozza} />}

        {grafici.length > 0 && (
          <div className="grafici">
            {grafici.map((url, i) => (
              <img key={url} src={url} alt={testoAlternativo(strumenti, grafici, i)} className="grafico" loading="lazy" />
            ))}
          </div>
        )}

        {sezioni_consultate.length > 0 && (
          <div className="sezioni">
            <h3 className="sezioni__titolo">Sezioni consultate</h3>
            <ul className="sezioni__elenco">
              {sezioni_consultate.map((s) => (
                <li key={`${s.file}|${s.sezione}`} className="etichetta-sezione" title={s.file}>
                  {s.sezione}
                </li>
              ))}
            </ul>
          </div>
        )}

        {pulizia && <p className="nota-pulizia">{pulizia}</p>}
      </article>
    </div>
  )
}
