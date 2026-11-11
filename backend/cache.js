// Cache delle risposte della chat: in memoria, LRU, con dimensione massima e scadenza.
//
// Solo domande IDENTICHE dopo la normalizzazione (minuscole, spazi ridotti, punteggiatura finale tolta),
// mai "simili" per significato: una cache semantica con gli embedding può restituire la risposta di
// una domanda diversa ("scarti di ortofrutta" e "scarti di panetteria" sono molto vicine), e per numeri
// e procedure è un errore peggiore di una chiamata in più.
//
// La chiave contiene anche tutto ciò che cambia la risposta: scenario, lingua, versione dei dati
// (impronta sha256 dei dati del data agent), modelli di orchestratore e data agent, versione dei prompt.
const crypto = require("node:crypto");

const sha256 = (testo) => crypto.createHash("sha256").update(testo).digest("hex");

/** Domanda normalizzata: minuscole, spazi multipli ridotti a uno, punteggiatura finale tolta. */
function normalizzaDomanda(domanda) {
  return domanda.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.,;:!?…]+$/u, "");
}

/**
 * Chiave della cache: hash di domanda normalizzata, scenario, lingua, versione dei dati, modelli e prompt.
 * @param {object} parti - { domanda, scenario, lingua, versioneDati, modelloOrchestratore, modelloDataAgent, versionePrompt }
 */
function chiaveCache(parti) {
  return sha256(JSON.stringify([
    normalizzaDomanda(parti.domanda), parti.scenario, parti.lingua, parti.versioneDati,
    parti.modelloOrchestratore, parti.modelloDataAgent, parti.versionePrompt,
  ]));
}

/**
 * Cache LRU: oltre maxVoci si toglie la voce usata meno di recente; dopo ttlMs una voce scade.
 * I valori si copiano in entrata e in uscita: chi li riceve può modificarli senza toccare la cache.
 * @param {object} opzioni
 * @param {number} opzioni.maxVoci
 * @param {number} opzioni.ttlMs
 * @param {() => number} [opzioni.adesso] - orologio in millisecondi (i test lo spostano)
 */
function creaCache({ maxVoci, ttlMs, adesso = Date.now }) {
  const voci = new Map(); // chiave -> { valore, scadenza }; l'ordine della Map è quello dell'ultimo uso

  function leggi(chiave) {
    const voce = voci.get(chiave);
    if (!voce) return undefined;
    voci.delete(chiave);
    if (voce.scadenza <= adesso()) return undefined; // scaduta: si toglie
    voci.set(chiave, voce); // in fondo: usata ora
    return structuredClone(voce.valore);
  }

  function salva(chiave, valore) {
    voci.delete(chiave);
    voci.set(chiave, { valore: structuredClone(valore), scadenza: adesso() + ttlMs });
    while (voci.size > maxVoci) voci.delete(voci.keys().next().value); // la prima è la meno recente
  }

  return { leggi, salva, dimensione: () => voci.size };
}

module.exports = { creaCache, chiaveCache, normalizzaDomanda, sha256 };
