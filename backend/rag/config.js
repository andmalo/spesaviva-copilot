// Configurazione comune del RAG: connessione a ChromaDB e funzione di embedding.
const path = require("node:path");

// Carico le variabili dal file .env della cartella principale del progetto
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), quiet: true });

const { ChromaClient } = require("chromadb");
const { OpenAIEmbeddingFunction } = require("@chroma-core/openai");

// Nome della collezione che contiene i chunk dei documenti
const NOME_COLLEZIONE = "procedure_spesaviva";

// Modello di embedding OpenAI usato sia per indicizzare sia per cercare
const MODELLO_EMBEDDING = "text-embedding-3-small";

// Client verso il server ChromaDB locale, sulla porta CHROMA_PORT del .env
function creaClient() {
  return new ChromaClient({
    host: "localhost",
    port: Number(process.env.CHROMA_PORT || 8000),
    ssl: false,
  });
}

// Funzione di embedding: legge la chiave dalla variabile d'ambiente OPENAI_API_KEY,
// così la chiave non compare mai nel codice né nella configurazione salvata da Chroma
function creaFunzioneEmbedding() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY mancante nel file .env");
  }
  return new OpenAIEmbeddingFunction({
    apiKeyEnvVar: "OPENAI_API_KEY",
    modelName: MODELLO_EMBEDDING,
  });
}

module.exports = { NOME_COLLEZIONE, MODELLO_EMBEDDING, creaClient, creaFunzioneEmbedding };
