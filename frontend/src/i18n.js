// Tutti i testi dell'interfaccia, in italiano e in inglese.
// I componenti non contengono testi scritti: li prendono da qui con useTesti().
import { createContext, useContext } from 'react'

export const LINGUE = ['it', 'en']

const TESTI = {
  it: {
    // Scenario e barra laterale (date, negozio e capo negozio vengono da backend/scenari.json)
    sottotitolo: 'Store Manager Copilot',
    negozioAria: 'Negozio',
    capoNegozioEtichetta: 'Capo negozio',
    datiAggiornatiEtichetta: 'Dati aggiornati al',
    scenarioEtichetta: 'Scenario della demo',
    scenario_tranquilla: 'Giornata tranquilla',
    scenario_caldo: 'Ondata di caldo',
    scenario_fornitore: 'Fornitore in crisi',
    azioniTitolo: 'Azioni',
    azione_briefing: 'Briefing del mattino',
    azione_soglie: 'Controllo soglie della settimana',
    azione_report: "Report per l'Area Manager",
    domandeRapideTitolo: 'Domande rapide',
    domandeRapide: [
      { tipo: 'RAG', testo: 'Cosa faccio se una consegna di freschi arriva fuori temperatura?' },
      { tipo: 'DATI', testo: "Le vendite di questa settimana sono calate: dipende dall'affluenza o dallo scontrino medio?" },
      { tipo: 'DATI', testo: 'Quale reparto ha più scarti in rapporto alle vendite questo mese?' },
      { tipo: 'DATI', testo: 'Come sono i nostri scarti rispetto agli altri negozi?' },
      { tipo: 'FUORI', testo: 'Che tempo farà domani a Lugo?' },
    ],
    tipoDomanda: { RAG: 'RAG', DATI: 'DATI', FUORI: 'FUORI' },

    // Intestazione della chat
    conversazione: 'Conversazione',
    legendaAria: 'Legenda delle fonti',
    legendaManuale: 'Manuale (RAG)',
    legendaDati: 'Dati del negozio',
    nuovaConversazione: 'Nuova conversazione',
    linguaAria: "Lingua dell'interfaccia",

    // Benvenuto, campo di testo, attesa
    benvenutoTitolo: 'Buongiorno {nome}, dimmi pure di cosa hai bisogno.',
    benvenutoTitoloSenzaNome: 'Buongiorno, dimmi pure di cosa hai bisogno.',
    benvenutoTesto:
      'Posso analizzare i dati del negozio o cercare nel manuale operativo SpesaViva. Per partire, prova il briefing del mattino.',
    campoEtichetta: 'La tua domanda',
    campoSegnaposto: 'Scrivi una domanda sul negozio o sulle procedure…',
    inviaAria: 'Invia la domanda',
    attesaBreve: 'Sto ragionando sulla tua domanda…',
    attesaLunga: 'Sto analizzando i dati, può richiedere fino a un minuto…',

    // Messaggi dell'assistente
    strumentiAria: 'Strumenti usati',
    nessunoStrumento: 'Nessuno strumento usato',
    strumento_analizza_dati: 'Dati del negozio',
    strumento_cerca_procedure: 'Manuale operativo',
    strumento_prepara_briefing: 'Briefing',
    strumento_controlla_soglie: 'Soglie del manuale',
    strumentoGenerico: 'Strumento',
    sezioniConsultate: 'Sezioni consultate',
    graficoAnalisi: "Grafico generato dall'analisi dei dati del negozio: {domanda}",
    graficoNumero: "Grafico {n} generato dall'analisi dei dati del negozio",

    // Riconoscimenti
    riconoscimentiTitolo: 'Riconoscimenti',
    bozzaTitolo: 'Bozza del messaggio alla squadra',
    copia: 'Copia',
    copiato: 'Copiato',
    copiaNonRiuscita: 'Copia non riuscita',

    // Report per l'Area Manager
    reportTitolo: "Report per l'Area Manager",
    reportA: 'A',
    reportDestinatario: 'Area Manager',
    reportOggetto: 'Oggetto',
    reportNota: 'Bozza da controllare e completare: non viene inviata in automatico.',

    // Errori
    erroreConnessione: 'Non riesco a contattare il server. Controlla che il servizio sia avviato e riprova tra poco.',
    erroreTimeout: 'La risposta sta impiegando troppo tempo e ho interrotto la richiesta. Riprova tra poco, magari con una domanda più semplice.',
    erroreServer: 'Si è verificato un problema nel preparare la risposta. Riprova tra poco.',
    eccedenzeEtichetta: 'Eccedenze donate',
    comeCalcolato: "Come l'ho calcolato",
    calcoloCodice: 'Codice Python eseguito sui dati del negozio (solo da leggere)',
    calcoloRegole: 'Regole fisse applicate dal codice, senza modello linguistico',
    eccedenzeValore: '{ieri} kg ieri · {settimana} kg nella settimana dal {dal} al {al}',
  },

  en: {
    sottotitolo: 'Store Manager Copilot',
    negozioAria: 'Store',
    capoNegozioEtichetta: 'Store manager',
    datiAggiornatiEtichetta: 'Data updated to',
    scenarioEtichetta: 'Demo scenario',
    scenario_tranquilla: 'Quiet day',
    scenario_caldo: 'Heatwave',
    scenario_fornitore: 'Supplier in trouble',
    azioniTitolo: 'Actions',
    azione_briefing: 'Morning briefing',
    azione_soglie: "This week's threshold check",
    azione_report: 'Report for the Area Manager',
    domandeRapideTitolo: 'Quick questions',
    domandeRapide: [
      { tipo: 'RAG', testo: 'What should I do if a fresh delivery arrives at the wrong temperature?' },
      { tipo: 'DATI', testo: 'Sales dropped this week: is it due to footfall or to the average receipt?' },
      { tipo: 'DATI', testo: 'Which department has the most waste relative to sales this month?' },
      { tipo: 'DATI', testo: 'How does our waste compare with the other stores?' },
      { tipo: 'FUORI', testo: 'What will the weather be like in Lugo tomorrow?' },
    ],
    tipoDomanda: { RAG: 'RAG', DATI: 'DATA', FUORI: 'OTHER' },

    conversazione: 'Conversation',
    legendaAria: 'Source legend',
    legendaManuale: 'Manual (RAG)',
    legendaDati: 'Store data',
    nuovaConversazione: 'New conversation',
    linguaAria: 'Interface language',

    benvenutoTitolo: 'Good morning {nome}, how can I help you?',
    benvenutoTitoloSenzaNome: 'Good morning, how can I help you?',
    benvenutoTesto:
      'I can analyse the store data or search the SpesaViva operations manual. To get started, try the morning briefing.',
    campoEtichetta: 'Your question',
    campoSegnaposto: 'Ask a question about the store or the procedures…',
    inviaAria: 'Send the question',
    attesaBreve: 'Thinking about your question…',
    attesaLunga: 'Analysing the data, this can take up to a minute…',

    strumentiAria: 'Tools used',
    nessunoStrumento: 'No tool used',
    strumento_analizza_dati: 'Store data',
    strumento_cerca_procedure: 'Operations manual',
    strumento_prepara_briefing: 'Briefing',
    strumento_controlla_soglie: 'Manual thresholds',
    strumentoGenerico: 'Tool',
    sezioniConsultate: 'Sections consulted',
    graficoAnalisi: 'Chart generated from the store data analysis: {domanda}',
    graficoNumero: 'Chart {n} generated from the store data analysis',

    riconoscimentiTitolo: 'Recognition',
    bozzaTitolo: 'Draft message to the team',
    copia: 'Copy',
    copiato: 'Copied',
    copiaNonRiuscita: 'Copy failed',

    reportTitolo: 'Report for the Area Manager',
    reportA: 'To',
    reportDestinatario: 'Area Manager',
    reportOggetto: 'Subject',
    reportNota: 'Draft to review and complete: it is not sent automatically. The report is always in Italian.',

    erroreConnessione: 'I cannot reach the server. Check that the service is running and try again shortly.',
    erroreTimeout: 'The answer was taking too long and I stopped the request. Try again shortly, perhaps with a simpler question.',
    erroreServer: 'Something went wrong while preparing the answer. Please try again shortly.',
    // Errori con codice inviati dal back end (in italiano li mostra già il back end)
    errore_troppe_richieste: 'Too many requests in a short time: wait a minute and try again.',
    errore_tetto_giornaliero: "The assistant's daily usage limit has been reached. Please try again tomorrow.",
    errore_messaggio_vuoto: 'The message is empty: please type a question.',
    errore_messaggio_lungo: 'The message is too long: 1000 characters at most.',
    errore_messaggio_non_valido: 'The message must be text.',
    errore_sessione_non_valida: 'Invalid session: start a new conversation.',
    errore_azione_sconosciuta: 'This action is not available.',
    errore_scenario_non_valido: 'Invalid demo scenario: choose one from the menu.',
    eccedenzeEtichetta: 'Surplus food donated',
    comeCalcolato: 'How I calculated it',
    calcoloCodice: 'Python code run on the store data (read only)',
    calcoloRegole: 'Fixed rules applied by the code, without a language model (in Italian)',
    eccedenzeValore: '{ieri} kg yesterday · {settimana} kg in the week {dal} – {al}',
  },
}

// Nomi dei reparti e dei mesi, per tradurre i dati che arrivano dal back end in italiano
const REPARTI_EN = { ortofrutta: 'Fruit and vegetables', panetteria: 'Bakery', freschi: 'Fresh food' }
const MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const MESI_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Restituisce la funzione t(chiave, valori) per la lingua: sostituisce i segnaposto {nome}. */
export function creaTraduttore(lingua) {
  return (chiave, valori = {}) => {
    const testo = TESTI[lingua][chiave] ?? TESTI.it[chiave] ?? chiave
    if (typeof testo !== 'string') return testo // liste e oggetti (es. domande rapide)
    return testo.replace(/\{(\w+)\}/g, (_, nome) => valori[nome] ?? `{${nome}}`)
  }
}

/** Vero se esiste un testo per questa chiave (serve per gli errori con codice). */
export function haTesto(lingua, chiave) {
  return Object.hasOwn(TESTI[lingua], chiave)
}

/**
 * Data AAAA-MM-GG nella lingua scelta: "Martedì 1 settembre 2026" / "Tuesday 1 September 2026".
 * @param {number} spostamento - giorni da aggiungere (-1 = il giorno prima)
 * @param {boolean} conGiorno - se mostrare il giorno della settimana
 * @param {boolean} conAnno - se mostrare l'anno
 */
export function formattaData(iso, lingua, { spostamento = 0, conGiorno = false, conAnno = true } = {}) {
  const [anno, mese, giorno] = iso.split('-').map(Number)
  // Mezzogiorno in ora locale: nessun problema con l'ora legale
  const data = new Date(anno, mese - 1, giorno + spostamento, 12)
  const testo = data.toLocaleDateString(lingua === 'en' ? 'en-GB' : 'it-IT', {
    ...(conGiorno && { weekday: 'long' }), day: 'numeric', month: 'long', ...(conAnno && { year: 'numeric' }),
  })
  return testo.charAt(0).toUpperCase() + testo.slice(1)
}

/** Numero con il formato della lingua: 4,90% in italiano, 4.90% in inglese. */
export function formattaNumero(n, lingua, decimali = 2) {
  return n.toLocaleString(lingua === 'en' ? 'en-GB' : 'it-IT', { minimumFractionDigits: decimali, maximumFractionDigits: decimali })
}

/** Traduce i nomi dei mesi italiani dentro un testo ("luglio 2025 e agosto 2025" -> "July 2025 and August 2025"). */
export function traduciMesi(testo, lingua) {
  if (lingua !== 'en') return testo
  return MESI_IT.reduce((t, m, i) => t.replace(new RegExp(`\\b${m}\\b`, 'g'), MESI_EN[i]), testo).replace(/ e /g, ' and ')
}

/** Frase del riconoscimento di un reparto, nella lingua scelta. */
export function fraseRiconoscimento(r, lingua) {
  const p = (n, d) => `${formattaNumero(n, lingua, d)}%`
  const euro = `${Math.round(r.euro_risparmiati).toLocaleString(lingua === 'en' ? 'en-GB' : 'it-IT')} €`
  if (lingua === 'en') {
    const tassi = r.tassi.map((t, i) => `${p(t)} in ${traduciMesi(r.mesi[i], 'en')}`).join(' and ')
    return {
      reparto: REPARTI_EN[r.reparto] ?? r.reparto,
      testo: `waste rate ${tassi}, compared with ${p(r.riferimento)} in the same months of the previous year ` +
        `(${traduciMesi(r.periodo_riferimento ?? '', 'en')}), i.e. ${p(r.variazione_pct, 1)}: about ${euro} less waste.`,
    }
  }
  const aMese = (m) => (/^[aeiou]/i.test(m) ? `ad ${m}` : `a ${m}`) // "ad agosto", "a luglio"
  const tassi = r.tassi.map((t, i) => `${p(t)} ${aMese(r.mesi[i])}`).join(' e al ')
  return {
    reparto: r.reparto,
    testo: `scarto al ${tassi}, contro il ${p(r.riferimento)} degli stessi mesi dell'anno prima` +
      `${r.periodo_riferimento ? ` (${r.periodo_riferimento})` : ''}, cioè ${p(r.variazione_pct, 1)}: circa ${euro} di scarti in meno.`,
  }
}

// Lingua corrente e funzione di traduzione, condivise da tutti i componenti
export const LinguaContext = createContext({ lingua: 'it', setLingua: () => {}, t: creaTraduttore('it') })

/** Hook per leggere lingua, setLingua e t() nei componenti. */
export function useTesti() {
  return useContext(LinguaContext)
}
