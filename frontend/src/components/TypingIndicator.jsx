// Indicatore di attesa: tre puntini animati e una scritta che cambia dopo 8 secondi.
import { useEffect, useState } from 'react'

const SECONDI_PRIMA_DEL_CAMBIO = 8

export default function TypingIndicator() {
  const [attesaLunga, setAttesaLunga] = useState(false)

  // Dopo 8 secondi probabilmente è in corso un'analisi dei dati, che richiede più tempo
  useEffect(() => {
    const timer = setTimeout(() => setAttesaLunga(true), SECONDI_PRIMA_DEL_CAMBIO * 1000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="messaggio messaggio--assistente">
      <span className="avatar" aria-hidden="true">SV</span>
      <div className="card card--attesa" role="status">
        <span className="puntini" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>
          {attesaLunga ? 'Sto analizzando i dati, può richiedere fino a un minuto…' : 'Sto ragionando sulla tua domanda…'}
        </span>
      </div>
    </div>
  )
}
