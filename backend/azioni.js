// Azioni dirette (pulsanti della barra laterale): briefing, controllo soglie e report per l'Area Manager.
// Gli strumenti li chiama il codice, in un ordine fisso: l'LLM non sceglie quali usare,
// scrive soltanto il testo finale a partire da dati e procedure già raccolti.
const { STRUMENTI } = require("./strumenti");
const { sezioniPerTitolo } = require("./rag/cerca");
const { separaBozza, separaFonti, togliDomandaFinale, aggiungiFonteUfficiale } = require("./testo_risposte");

const AZIONI = ["briefing", "soglie", "report"];

// Sezioni del manuale recuperate per titolo (non per somiglianza) per il report
const SEZIONE_MODELLO = "Cosa includere e modello di messaggio per l'Area Manager";
const SEZIONI_PROCEDURA = {
  scarti: ["Azioni obbligatorie dopo 3 giorni consecutivi sopra soglia di scarto"],
  // Per il doppio del normale (o 7 giorni) basta la sezione sulla segnalazione: le azioni "dopo 3 giorni"
  // valgono solo se i 3 giorni consecutivi ci sono davvero (in quel caso si aggiungono con "scarti")
  scarti_area_manager: ["Quando scrivere all'Area Manager"],
  rotture: ["Ritardi di consegna e prodotti a scaffale vuoto (rotture di stock)"],
  consegne: ["Consegne in ritardo e segnalazione all'Area Manager"],
  assenze: ["Soglia di allerta assenze e piano di sostituzione"],
};

const MESI = {
  it: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

// Data AAAA-MM-GG in ora locale (mezzogiorno, per non avere problemi con l'ora legale)
const daIso = (iso) => new Date(`${iso}T12:00:00`);
const aIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const piuGiorni = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);

// Ultima settimana completa (lunedì-domenica) prima di oggi
function ultimaSettimanaCompleta(oggiIso) {
  const oggi = daIso(oggiIso);
  const giorniDallaDomenica = oggi.getDay() === 0 ? 7 : oggi.getDay(); // domenica = 0
  const domenica = piuGiorni(oggi, -giorniDallaDomenica);
  return { inizio: aIso(piuGiorni(domenica, -6)), fine: aIso(domenica) };
}

// "dal 24 al 30 agosto 2026" / "24–30 August 2026"
function periodoLeggibile({ inizio, fine }, lingua) {
  const a = daIso(inizio), b = daIso(fine), m = MESI[lingua];
  const stessoMese = a.getMonth() === b.getMonth();
  if (lingua === "en") {
    return stessoMese
      ? `${a.getDate()}–${b.getDate()} ${m[b.getMonth()]} ${b.getFullYear()}`
      : `${a.getDate()} ${m[a.getMonth()]} – ${b.getDate()} ${m[b.getMonth()]} ${b.getFullYear()}`;
  }
  return stessoMese
    ? `dal ${a.getDate()} al ${b.getDate()} ${m[b.getMonth()]} ${b.getFullYear()}`
    : `dal ${a.getDate()} ${m[a.getMonth()]} al ${b.getDate()} ${m[b.getMonth()]} ${b.getFullYear()}`;
}

// Messaggio salvato nella memoria della sessione (e mostrato nei log), con il periodo esplicito:
// così una domanda successiva come "e la settimana prima?" ha il riferimento giusto
function etichettaAzione(azione, periodo, lingua) {
  const p = periodoLeggibile(periodo, lingua);
  const testi = {
    it: {
      briefing: `Briefing del mattino (dati di ieri, ${p.replace(/^dal \d+ al /, "")})`,
      soglie: `Controllo delle soglie del manuale, settimana ${p}`,
      report: `Report per l'Area Manager, settimana ${p}`,
    },
    en: {
      briefing: `Morning briefing (yesterday's data, ${p.replace(/^\d+–/, "")})`,
      soglie: `Manual threshold check, week ${p}`,
      report: `Report for the Area Manager, week ${p}`,
    },
  };
  return testi[lingua][azione];
}

// Risultato vuoto con la stessa forma della risposta di /api/chat
const nuovoEsito = () => ({
  risposta: null, strumenti: [], sezioni_consultate: [], grafici: [], pulizia: null,
  riconoscimenti: [], bozza_riconoscimento: null, report: null, eccedenze_donate: null, token: 0,
});

// Aggiunge le sezioni consultate senza doppioni
function aggiungiFonti(esito, fonti) {
  for (const f of fonti ?? []) {
    if (!esito.sezioni_consultate.some((s) => s.file === f.file && s.sezione === f.sezione)) esito.sezioni_consultate.push(f);
  }
}

// Tiene solo le sezioni che l'LLM dichiara di aver usato (blocco [FONTI]), come nella chat
function filtraFonti(esito, testo) {
  const { testo: senzaFonti, titoli } = separaFonti(testo);
  if (titoli?.length) {
    const usate = esito.sezioni_consultate.filter((s) => titoli.some((t) => t.toLowerCase() === s.sezione.toLowerCase()));
    if (usate.length) esito.sezioni_consultate = usate;
  }
  return senzaFonti;
}

// Numero all'italiana (7,02) e data per esteso ("29 agosto 2026") a partire da AAAA-MM-GG
const numeroIt = (n, decimali = 2) => n.toFixed(decimali).replace(".", ",");
const dataIt = (iso) => { const d = daIso(iso); return `${d.getDate()} ${MESI.it[d.getMonth()]} ${d.getFullYear()}`; };
const intervalloIt = (dal, al) => (dal === al ? dataIt(dal) : periodoLeggibile({ inizio: dal, fine: al }, "it"));
const maiuscola = (testo) => testo.charAt(0).toUpperCase() + testo.slice(1);

/**
 * Elenco delle soglie superate nel periodo, con valore, soglia, periodo e reparto,
 * a partire dai controlli strutturati di controlla_soglie (tutto calcolato dal codice).
 */
function superamenti(controlli) {
  const elenco = [];
  for (const [reparto, episodi] of Object.entries(controlli.scarti)) {
    for (const e of episodi.filter((x) => x.giorni >= 3)) {
      elenco.push({
        indicatore: `scarto ${reparto} sopra soglia`,
        valore: `${numeroIt(e.tasso_ultimo_giorno)}% l'ultimo giorno, sopra soglia per ${e.giorni} giorni consecutivi`,
        soglia: `${numeroIt(e.soglia, 1)}% per 3 giorni consecutivi${e.giorni >= 7 ? "; da comunicare all'Area Manager dopo 7 giorni" : ""}`,
        periodo: intervalloIt(e.dal, e.al),
        reparto,
      });
    }
  }
  for (const [reparto, giorni] of Object.entries(controlli.scarti_oltre_doppio)) {
    for (const g of giorni) {
      elenco.push({
        indicatore: `scarto ${reparto} oltre il doppio del valore normale`,
        valore: `${numeroIt(g.tasso)}%`,
        soglia: `${numeroIt(g.doppio_normale, 1)}%, doppio del valore normale`,
        periodo: dataIt(g.giorno),
        reparto,
      });
    }
  }
  for (const e of controlli.rotture) {
    elenco.push({
      indicatore: "referenze in rottura",
      valore: `${e.valori.join(", ")} referenze`,
      soglia: "oltre 60 per 2 giorni consecutivi",
      periodo: intervalloIt(e.dal, e.al),
      reparto: null,
    });
  }
  for (const w of controlli.settimane) {
    if (w.consegne_in_ritardo >= 3) {
      elenco.push({ indicatore: "consegne in ritardo", valore: `${w.consegne_in_ritardo} consegne in ritardo`,
        soglia: "3 o più nella stessa settimana", periodo: intervalloIt(w.lunedi, w.fine), reparto: null });
    }
    if (w.tasso_assenze !== null && w.tasso_assenze > 10) {
      elenco.push({ indicatore: "assenze", valore: `${numeroIt(w.tasso_assenze)}% delle ore pianificate`,
        soglia: "oltre il 10% nella settimana", periodo: intervalloIt(w.lunedi, w.fine), reparto: null });
    }
  }
  return elenco;
}

/**
 * Crea le azioni dirette con i servizi forniti dal server.
 * @param {object} servizi
 * @param {(messaggi: Array, segnale: AbortSignal) => Promise<{testo: string, token: number}>} servizi.chiamaModello
 *   una chiamata al modello senza strumenti, con gli stessi tetti e controlli della chat
 * @param {(storico: Array, lingua: string, istruzioni: string) => Array} servizi.componiMessaggi
 *   prompt di sistema + memoria della sessione + lingua + istruzioni dell'azione
 */
function creaAzioni({ chiamaModello, componiMessaggi }) {
  // Ogni azione riceve lo scenario della demo: la data di "oggi" e il negozio vengono da lì

  async function briefing({ lingua, storico, segnale, scenario }) {
    const ieri = aIso(piuGiorni(daIso(scenario.oggi), -1));
    const esito = nuovoEsito();
    const dati = await STRUMENTI.prepara_briefing(segnale, scenario.id);
    esito.strumenti.push({ nome: "prepara_briefing", domanda: null });
    if (dati.grafico) esito.grafici.push(dati.grafico);
    esito.pulizia = dati.pulizia ?? null;
    esito.riconoscimenti = dati.riconoscimenti ?? [];
    esito.eccedenze_donate = dati.eccedenze ?? null;

    // Una ricerca nel manuale per ogni anomalia, con la sua domanda_procedura (senza doppioni)
    const domande = [...new Set((dati.anomalie ?? []).map((a) => a.domanda_procedura).filter(Boolean))];
    const procedure = [];
    for (const domanda of domande) {
      const r = await STRUMENTI.cerca_procedure(domanda, segnale);
      esito.strumenti.push({ nome: "cerca_procedure", domanda });
      aggiungiFonti(esito, r.fonti);
      procedure.push(r.testoPerLLM);
    }

    const istruzioni =
      "Azione diretta: briefing del mattino. Scrivi il briefing per lo Store Manager usando SOLO i dati " +
      "e le procedure qui sotto, già calcolati dal codice: non aggiungere anomalie, cause o consigli che non ci sono.\n\n" +
      dati.testoPerLLM +
      (procedure.length ? `\n\nProcedure del manuale per le anomalie:\n\n${procedure.join("\n\n---\n\n")}` : "");
    const { testo, token } = await chiamaModello(componiMessaggi(storico, lingua, istruzioni, scenario), segnale);
    esito.token = token;

    let finale = filtraFonti(esito, testo);
    const { testo: senzaBozza, bozza } = separaBozza(finale);
    finale = senzaBozza;
    if (esito.riconoscimenti.length) esito.bozza_riconoscimento = bozza;
    esito.risposta = aggiungiFonteUfficiale(togliDomandaFinale(finale), lingua, esito.sezioni_consultate);
    return { esito, periodo: { inizio: ieri, fine: ieri } };
  }

  async function soglie({ lingua, storico, segnale, scenario }) {
    const esito = nuovoEsito();
    const periodo = ultimaSettimanaCompleta(scenario.oggi);
    const r = await STRUMENTI.controlla_soglie(periodo, segnale, scenario.id);
    esito.strumenti.push({ nome: "controlla_soglie", domanda: `dal ${periodo.inizio} al ${periodo.fine}` });

    const istruzioni =
      `Azione diretta: controllo delle soglie del manuale sulla settimana ${periodoLeggibile(periodo, "it")}. ` +
      "Scrivi un riassunto breve (al massimo 80 parole) dei risultati già calcolati qui sotto: per ogni controllo " +
      "di' se la soglia è stata superata oppure no, con valore e date. Non aggiungere valutazioni proprie, cause o consigli.\n\n" +
      r.testoPerLLM;
    const { testo, token } = await chiamaModello(componiMessaggi(storico, lingua, istruzioni, scenario), segnale);
    esito.token = token;
    esito.risposta = togliDomandaFinale(testo);
    return { esito, periodo };
  }

  async function report({ lingua, storico, segnale, scenario }) {
    const esito = nuovoEsito();
    const periodo = ultimaSettimanaCompleta(scenario.oggi);
    const r = await STRUMENTI.controlla_soglie(periodo, segnale, scenario.id);
    esito.strumenti.push({ nome: "controlla_soglie", domanda: `dal ${periodo.inizio} al ${periodo.fine}` });
    if (!r.dati?.kpi) throw new Error("dati della settimana non disponibili");

    // Soglie superate e sezioni del manuale da allegare: il modello di messaggio e le procedure
    const superate = Object.entries(r.dati.superate).filter(([, si]) => si).map(([tipo]) => tipo);
    const titoli = [...new Set([SEZIONE_MODELLO, ...superate.flatMap((t) => SEZIONI_PROCEDURA[t] ?? [])])];
    const sezioni = await sezioniPerTitolo(titoli);
    esito.strumenti.push({ nome: "cerca_procedure", domanda: `Sezioni recuperate per titolo: ${titoli.join("; ")}` });
    aggiungiFonti(esito, sezioni.map((s) => ({ file: s.metadati.file, sezione: s.metadati.sezione })));
    const procedure = sezioni.filter((s) => s.metadati.sezione !== SEZIONE_MODELLO).map((s) => s.testo);

    const p = periodoLeggibile(periodo, "it");
    const negozio = r.dati.kpi.negozio;
    const elenco = superamenti(r.dati.controlli);
    // Righe dei KPI già calcolate dal data agent (la prima riga è l'intestazione)
    const righeKpi = r.dati.testoKpi.split("\n").slice(1).join("\n");
    const firma = `[Nome e cognome], Capo Negozio ${negozio}`;

    let oggetto, corpo;
    if (elenco.length === 0) {
      // Nessuna soglia superata: report breve, scritto tutto dal codice (nessuna chiamata al modello)
      oggetto = `[${negozio}] – Settimana senza segnalazioni – ${p}`;
      corpo = `Buongiorno,\n\nper il negozio ${negozio} la settimana ${p} si è chiusa senza superamenti ` +
        `delle soglie del manuale operativo.\n\nDati della settimana:\n${righeKpi}\n\n${firma}`;
    } else {
      // L'LLM scrive SOLO le azioni previste dal manuale per le soglie superate, in italiano
      const istruzioni =
        "Azione diretta: report per l'Area Manager. Scrivi in italiano SOLO un elenco puntato con le azioni " +
        "previste dal manuale per ciascuna soglia superata qui sotto, usando esclusivamente i testi del manuale " +
        "forniti. Riporta solo le azioni che si applicano alle soglie superate elencate, non quelle previste per " +
        "altri casi. Non scrivere saluti, introduzioni, cause, richieste, valutazioni, fonti o altre parti del messaggio. " +
        "Al massimo 120 parole.\n\n" +
        `Soglie superate:\n${elenco.map((s) => `- ${s.indicatore}: ${s.valore} (soglia ${s.soglia}), ${s.periodo}`).join("\n")}\n\n` +
        `Testi del manuale:\n\n${procedure.join("\n\n---\n\n")}`;
      const { testo, token } = await chiamaModello(componiMessaggi([], "it", istruzioni, scenario), segnale);
      esito.token = token;
      // Le fonti non vanno dentro la mail: si tolgono eventuali righe "Fonte ufficiale" scritte dal modello
      const azioniManuale = separaFonti(testo).testo
        .split("\n")
        .filter((riga) => !/^\W*(fonte ufficiale|official source)/i.test(riga.trim()))
        .join("\n")
        .trim() || "[da completare]";

      // Ossatura secondo il modello del manuale: un blocco per ogni soglia superata
      oggetto = elenco.length === 1
        ? `[${negozio}] – ${maiuscola(elenco[0].indicatore)} – ${elenco[0].periodo}`
        : `[${negozio}] – ${elenco.length} soglie superate – ${p}`;
      const blocchi = elenco.map((s) =>
        `segnalo per il negozio ${negozio} il superamento della soglia di ${s.indicatore}:\n` +
        `- valore rilevato: ${s.valore} (soglia ${s.soglia})\n` +
        `- periodo: ${s.periodo}\n` +
        `- reparto/fornitore: ${s.reparto ?? "[da completare]"}`
      );
      corpo = `Buongiorno,\n\n${blocchi.join("\n\n")}\n\n` +
        `Dati della settimana ${p}:\n${righeKpi}\n\n` +
        `Azioni previste dal manuale:\n${azioniManuale}\n\n` +
        "Causa probabile: [da completare].\n\n" +
        "Azioni già fatte: [da completare].\n\n" +
        "Chiedo: [da completare].\n\n" +
        firma;
    }
    esito.report = { oggetto, corpo };
    esito.risposta = lingua === "en"
      ? `Here is the draft report for the Area Manager for the week of ${periodoLeggibile(periodo, "en")}, in Italian as required. Review and complete it before sending: nothing is sent automatically.`
      : `Ecco la bozza del report per l'Area Manager, settimana ${p}. Controllala e completala prima di inviarla: non viene inviato nulla in automatico.`;
    return { esito, periodo };
  }

  const funzioni = { briefing, soglie, report };

  /**
   * Esegue un'azione diretta.
   * @returns {Promise<{esito: object, richiesta: string, rispostaPerMemoria: string}>}
   */
  async function eseguiAzione(azione, { lingua, storico, segnale, scenario }) {
    const { esito, periodo } = await funzioni[azione]({ lingua, storico, segnale, scenario });
    const richiesta = etichettaAzione(azione, periodo, lingua);
    // In memoria va anche il testo del report, così si possono fare domande successive
    const rispostaPerMemoria = esito.report ? `Oggetto: ${esito.report.oggetto}\n\n${esito.report.corpo}` : esito.risposta;
    return { esito, richiesta, rispostaPerMemoria };
  }

  return { eseguiAzione };
}

module.exports = { AZIONI, creaAzioni, ultimaSettimanaCompleta, periodoLeggibile, superamenti };
