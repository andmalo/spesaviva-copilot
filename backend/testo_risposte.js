// Funzioni che ripuliscono il testo delle risposte dell'LLM prima di mandarlo al front end.
// Usate sia dalla chat (server.js) sia dalle azioni dirette (azioni.js).

// Toglie dalla risposta la bozza del messaggio di riconoscimento, scritta tra [BOZZA] e [/BOZZA].
// Restituisce { testo, bozza }: la bozza va nel riquadro "Riconoscimenti" del front end.
function separaBozza(testo) {
  const trovata = testo.match(/\[BOZZA\]([\s\S]*?)(?:\[\/BOZZA\]|$)/i);
  if (!trovata) return { testo, bozza: null };
  const bozza = trovata[1].trim();
  const resto = (testo.slice(0, trovata.index) + testo.slice(trovata.index + trovata[0].length)).trim();
  return { testo: resto, bozza: bozza || null };
}

// Toglie dalla risposta l'elenco delle sezioni usate, scritto tra [FONTI] e [/FONTI].
// Restituisce { testo, titoli }: titoli è null se il blocco manca.
function separaFonti(testo) {
  const trovata = testo.match(/\[FONTI\]([\s\S]*?)(?:\[\/FONTI\]|$)/i);
  if (!trovata) return { testo, titoli: null };
  const titoli = trovata[1].split(/[;\n]/).map((t) => t.replace(/^[-*•\s"]+|["\s.]+$/g, "").trim()).filter(Boolean);
  const resto = (testo.slice(0, trovata.index) + testo.slice(trovata.index + trovata[0].length)).trim();
  return { testo: resto, titoli };
}

// Toglie l'ultima frase se offre altro: "Vuoi che…?", "Posso…?", "Se vuoi, posso…",
// "Ti posso aiutare… se vuoi." Le domande di chiarimento vere restano: di solito non iniziano così,
// e una frase normale che inizia con "Posso" senza essere un'offerta non viene toccata.
const INIZI_OFFERTA = /^(vuoi|desideri|preferisci|posso|potrei|ti posso|ti serve|ti interessa|hai bisogno|serve altro|fammi sapere)\b/i;
const INIZI_SE_VUOI = /^se (lo )?(vuoi|desideri|preferisci|ti serve|ti interessa)\b/i;
// Le stesse offerte in inglese, per le risposte in quella lingua
const OFFERTE_INGLESE = /^(would you like|do you want|shall i|should i|let me know|if you (want|like|wish|need)|i can also|feel free)\b/i;
function eOfferta(frase) {
  if (frase.endsWith("?") && INIZI_OFFERTA.test(frase)) return true;
  if (INIZI_SE_VUOI.test(frase)) return true;
  if (OFFERTE_INGLESE.test(frase)) return true;
  return /^(ti posso|posso|potrei)\b/i.test(frase) && /\bse (lo )?(vuoi|desideri|preferisci)\b/i.test(frase);
}
function togliDomandaFinale(testo) {
  // Si lavora sull'ultimo paragrafo, così elenchi e a capo restano intatti
  const paragrafi = testo.trim().split(/\n/);
  const frasi = paragrafi[paragrafi.length - 1].split(/(?<=[.!?])\s+/);
  const ultima = frasi[frasi.length - 1].trim();
  if (!eOfferta(ultima)) return testo.trim();
  frasi.pop();
  if (frasi.length > 0) paragrafi[paragrafi.length - 1] = frasi.join(" ");
  else paragrafi.pop(); // l'offerta era un paragrafo a sé
  return paragrafi.join("\n").trim() || testo.trim();
}

// Riga "fonte ufficiale" in fondo alle risposte in inglese che usano il manuale: la scrive il codice,
// con i titoli delle sezioni usate, così non dipende dal modello. Un'eventuale riga simile scritta
// dal modello si toglie, per non averla due volte.
function aggiungiFonteUfficiale(testo, lingua, sezioni) {
  if (lingua !== "en" || !sezioni?.length) return testo;
  const senzaRighe = testo
    .split("\n")
    .filter((riga) => !/^\W*(official source|fonte ufficiale)/i.test(riga.trim()))
    .join("\n")
    .trim();
  const titoli = sezioni.map((s) => `"${s.sezione}"`).join(", ");
  const parola = sezioni.length > 1 ? "sections" : "section";
  return `${senzaRighe}\n\nOfficial source: SpesaViva operations manual in Italian, ${parola} ${titoli}.`;
}

module.exports = { separaBozza, separaFonti, togliDomandaFinale, aggiungiFonteUfficiale };
