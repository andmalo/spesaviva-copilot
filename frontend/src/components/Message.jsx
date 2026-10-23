// Un messaggio della chat: bolla dell'utente, card dell'assistente, benvenuto o avviso d'errore.
import ReactMarkdown from 'react-markdown'
import ToolBadges from './ToolBadges.jsx'
import Riconoscimenti from './Riconoscimenti.jsx'
import ReportMail from './ReportMail.jsx'
import Eccedenze from './Eccedenze.jsx'
import ComeCalcolato from './ComeCalcolato.jsx'
import Valutazione from './Valutazione.jsx'
import { useTesti } from '../i18n.js'

// Il markdown scritto dall'LLM non deve far caricare nulla dall'esterno:
// - i link restano semplice testo (niente indirizzo cliccabile);
// - le immagini non vengono caricate: si mostra solo il testo alternativo, se c'è.
// Un'immagine esterna verrebbe scaricata dal browser in automatico e potrebbe far uscire
// dati nell'indirizzo. I grafici del data agent non passano da qui: sono <img> a parte.
const COMPONENTI_MARKDOWN = {
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => (alt ? <span className="immagine-rimossa">[{alt}]</span> : null),
}

function Avatar({ avviso = false }) {
  return (
    <span className={`avatar${avviso ? ' avatar--avviso' : ''}`} aria-hidden="true">
      SV
    </span>
  )
}

export default function Message({ messaggio, onValuta }) {
  const { t } = useTesti()

  // Testo alternativo dei grafici: se c'è un grafico per ogni analisi, uso la domanda dell'analisi
  function testoAlternativo(strumenti, grafici, indice) {
    const analisi = strumenti.filter((s) => s.nome === 'analizza_dati')
    if (analisi.length === grafici.length) return t('graficoAnalisi', { domanda: analisi[indice].domanda })
    return t('graficoNumero', { n: indice + 1 })
  }

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

  // Risposta dell'assistente con strumenti, testo, report, riconoscimenti, grafici, sezioni e pulizia
  const {
    risposta, strumenti = [], grafici = [], sezioni_consultate = [], pulizia,
    riconoscimenti = [], bozza_riconoscimento: bozza = null, report = null, eccedenze_donate: eccedenze = null,
    calcoli = [], id_messaggio: idMessaggio = null,
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

        {/* Report per l'Area Manager: riquadro in stile mail, sempre in italiano */}
        {report && <ReportMail report={report} />}

        {/* Eccedenze donate del briefing: chilogrammi di ieri e dell'ultima settimana completa */}
        {eccedenze && <Eccedenze eccedenze={eccedenze} />}

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
            <h3 className="sezioni__titolo">{t('sezioniConsultate')}</h3>
            <ul className="sezioni__elenco">
              {sezioni_consultate.map((s) => (
                <li key={`${s.file}|${s.sezione}`} className="etichetta-sezione" title={s.file}>
                  {s.sezione}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* "Come l'ho calcolato": pannello richiudibile con codice o regole (solo testo) */}
        {calcoli.length > 0 && <ComeCalcolato calcoli={calcoli} />}

        {pulizia && <p className="nota-pulizia">{pulizia}</p>}

        {/* Pollici per valutare la risposta (solo se il back end le ha dato un id) */}
        {idMessaggio && onValuta && <Valutazione idMessaggio={idMessaggio} onValuta={onValuta} />}
      </article>
    </div>
  )
}
