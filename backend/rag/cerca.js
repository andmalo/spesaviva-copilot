// Ricerca semantica nelle procedure indicizzate in ChromaDB.
const { NOME_COLLEZIONE, creaClient, creaFunzioneEmbedding } = require("./config");

// Collezione aperta una sola volta e riusata nelle ricerche successive
let collezioneAperta = null;

async function apriCollezione() {
  if (!collezioneAperta) {
    const client = creaClient();
    // La domanda va trasformata in embedding con lo stesso modello usato per indicizzare
    collezioneAperta = await client.getCollection({
      name: NOME_COLLEZIONE,
      embeddingFunction: creaFunzioneEmbedding(),
    });
  }
  return collezioneAperta;
}

/**
 * Restituisce i k chunk più simili alla domanda.
 * @param {string} domanda - testo della domanda dell'utente
 * @param {number} k - numero di chunk da restituire
 * @returns {Promise<Array<{testo: string, metadati: object, distanza: number}>>}
 *   dal più simile al meno simile; la distanza è quella del coseno (più bassa = più simile)
 */
async function cercaProcedure(domanda, k = 3) {
  const collezione = await apriCollezione();
  const risultati = await collezione.query({
    queryTexts: [domanda],
    nResults: k,
    include: ["documents", "metadatas", "distances"],
  });

  // Chroma restituisce una lista per ogni domanda: qui ce n'è una sola (indice 0)
  return risultati.documents[0].map((testo, i) => ({
    testo,
    metadati: risultati.metadatas[0][i],
    distanza: risultati.distances[0][i],
  }));
}

/**
 * Recupera le sezioni con questi titoli esatti, filtrando sui metadati (non per somiglianza):
 * serve quando si sa già quale sezione del manuale usare, come il modello di messaggio.
 * Non calcola embedding, quindi non fa chiamate a OpenAI.
 * @param {string[]} titoli - titoli delle sezioni ("##" del manuale)
 * @returns {Promise<Array<{testo: string, metadati: object}>>} nello stesso ordine dei titoli
 */
async function sezioniPerTitolo(titoli) {
  if (titoli.length === 0) return [];
  const collezione = await apriCollezione();
  const risultati = await collezione.get({
    where: { sezione: { $in: titoli } },
    include: ["documents", "metadatas"],
  });
  const sezioni = risultati.documents.map((testo, i) => ({ testo, metadati: risultati.metadatas[i] }));
  return titoli.map((t) => sezioni.find((s) => s.metadati.sezione === t)).filter(Boolean);
}

module.exports = { cercaProcedure, sezioniPerTitolo };
