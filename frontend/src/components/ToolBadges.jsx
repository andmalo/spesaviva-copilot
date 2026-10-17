// Badge degli strumenti usati dall'assistente, numerati nell'ordine di chiamata.

// Etichetta e stile per ogni strumento del back end
const STRUMENTI = {
  analizza_dati: { etichetta: 'Dati del negozio', classe: 'badge--dati' },
  cerca_procedure: { etichetta: 'Manuale operativo', classe: 'badge--manuale' },
}

export default function ToolBadges({ strumenti }) {
  if (strumenti.length === 0) {
    return <p className="badge-nessuno">Nessuno strumento usato</p>
  }

  return (
    <ol className="badge-strumenti" aria-label="Strumenti usati">
      {strumenti.map((strumento, i) => {
        const info = STRUMENTI[strumento.nome] ?? { etichetta: 'Strumento', classe: '' }
        return (
          <li key={i} className={`badge ${info.classe}`}>
            <div className="badge__riga">
              <span className="badge__numero">{i + 1}</span>
              <span className="badge__etichetta">{info.etichetta}</span>
              <code className="badge__nome">{strumento.nome}</code>
            </div>
            <em className="badge__domanda">{strumento.domanda}</em>
          </li>
        )
      })}
    </ol>
  )
}
