// Copia di un testo negli appunti, usata dai riquadri "Riconoscimenti" e "Report per l'Area Manager".

/** Copia il testo; se l'API moderna manca o rifiuta, prova il metodo classico. Lancia un errore se non riesce. */
export async function copiaNegliAppunti(testo) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(testo)
      return
    } catch {
      // permesso negato o pagina senza focus: si prova il metodo classico
    }
  }
  const area = document.createElement('textarea')
  area.value = testo
  area.setAttribute('readonly', '')
  area.style.position = 'absolute'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  const riuscito = document.execCommand('copy')
  document.body.removeChild(area)
  if (!riuscito) throw new Error('copia non riuscita')
}
