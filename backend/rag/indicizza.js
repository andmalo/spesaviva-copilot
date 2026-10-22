// Indicizza i documenti Markdown di data/documenti/ nella collezione ChromaDB.
// A ogni esecuzione la collezione viene ricreata da zero, così non si creano doppioni.
//
// Uso (dalla cartella backend): node rag/indicizza.js
const fs = require("node:fs");
const path = require("node:path");
const { NOME_COLLEZIONE, MODELLO_EMBEDDING, creaClient, creaFunzioneEmbedding } = require("./config");

const CARTELLA_DOCUMENTI = path.resolve(__dirname, "..", "..", "data", "documenti");

// Negozio a cui si riferisce ogni documento: il manuale vale per tutti i negozi
function negozioDelFile(nomeFile) {
  const trovato = nomeFile.match(/_(NEG\d{2})\.md$/);
  return trovato ? trovato[1] : "tutti";
}

// Divide un file Markdown in un chunk per ogni sezione "##".
// In testa al testo di ogni chunk aggiungo il titolo del capitolo "#" a cui appartiene,
// così l'embedding "sa" di quale argomento fa parte la sezione.
function dividiInChunk(testo, nomeFile) {
  const chunk = [];
  let capitolo = "";
  let sezioneCorrente = null;

  // Chiude la sezione in corso e la aggiunge all'elenco dei chunk
  const chiudiSezione = () => {
    if (!sezioneCorrente) return;
    const corpo = sezioneCorrente.righe.join("\n").trim();
    chunk.push({
      testo: `# ${sezioneCorrente.capitolo}\n## ${sezioneCorrente.titolo}\n\n${corpo}`,
      metadati: {
        file: nomeFile,
        capitolo: sezioneCorrente.capitolo,
        sezione: sezioneCorrente.titolo,
        negozio: negozioDelFile(nomeFile),
      },
    });
    sezioneCorrente = null;
  };

  for (const riga of testo.split(/\r?\n/)) {
    if (riga.startsWith("# ")) {
      // Nuovo capitolo: chiude l'eventuale sezione aperta
      chiudiSezione();
      capitolo = riga.slice(2).trim();
    } else if (riga.startsWith("## ")) {
      // Nuova sezione: diventa un nuovo chunk
      chiudiSezione();
      sezioneCorrente = { capitolo, titolo: riga.slice(3).trim(), righe: [] };
    } else if (sezioneCorrente) {
      sezioneCorrente.righe.push(riga);
    }
    // Il testo fuori da una sezione "##" (es. subito sotto un titolo "#") non viene indicizzato
  }
  chiudiSezione();
  return chunk;
}

async function main() {
  const client = creaClient();
  const funzioneEmbedding = creaFunzioneEmbedding();

  // Ricreo la collezione da zero: se esiste già la elimino
  try {
    await client.deleteCollection({ name: NOME_COLLEZIONE });
    console.log(`Collezione "${NOME_COLLEZIONE}" esistente eliminata`);
  } catch {
    // La collezione non esisteva ancora: niente da eliminare
  }
  const collezione = await client.createCollection({
    name: NOME_COLLEZIONE,
    embeddingFunction: funzioneEmbedding,
    metadata: { descrizione: "Procedure e schede dei negozi SpesaViva" },
  });

  const fileMarkdown = fs.readdirSync(CARTELLA_DOCUMENTI).filter((f) => f.endsWith(".md")).sort();
  let totale = 0;

  for (const nomeFile of fileMarkdown) {
    const testo = fs.readFileSync(path.join(CARTELLA_DOCUMENTI, nomeFile), "utf-8");
    const chunk = dividiInChunk(testo, nomeFile);
    if (chunk.length === 0) {
      console.log(`${nomeFile}: nessuna sezione "##" trovata`);
      continue;
    }

    // Gli embedding vengono calcolati da Chroma con la funzione OpenAI della collezione
    await collezione.add({
      ids: chunk.map((_, i) => `${nomeFile}#${String(i + 1).padStart(2, "0")}`),
      documents: chunk.map((c) => c.testo),
      metadatas: chunk.map((c) => c.metadati),
    });
    console.log(`${nomeFile}: ${chunk.length} chunk indicizzati`);
    totale += chunk.length;
  }

  console.log(`Totale: ${totale} chunk nella collezione "${NOME_COLLEZIONE}" (embedding: ${MODELLO_EMBEDDING})`);
}

main().catch((errore) => {
  // Mostro solo il messaggio, mai la configurazione del client (che non contiene comunque la chiave)
  // Messaggio fisso: il testo originale (es. errori di OpenAI) può contenere parti della chiave
  console.error(`Indicizzazione non riuscita (${errore.name}): controlla che ChromaDB sia avviato e che la chiave OpenAI nel .env sia valida.`);
  process.exit(1);
});
