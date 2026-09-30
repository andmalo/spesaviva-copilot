// Prova la ricerca sulle domande RAG (1-8) di test/domande_test.md
// e stampa, per ognuna, le 3 sezioni trovate con la distanza.
//
// Uso (dalla cartella backend, con il server ChromaDB avviato): node rag/test_ricerca.js
const fs = require("node:fs");
const path = require("node:path");
const { cercaProcedure } = require("./cerca");

const PERCORSO_DOMANDE = path.resolve(__dirname, "..", "..", "test", "domande_test.md");

// Legge la tabella delle domande e tiene solo le righe con strumento atteso "RAG"
function leggiDomandeRag() {
  const righe = fs.readFileSync(PERCORSO_DOMANDE, "utf-8").split(/\r?\n/);
  const domande = [];
  for (const riga of righe) {
    // Formato della riga: | N. | Domanda | Strumento atteso |
    const celle = riga.split("|").map((c) => c.trim());
    if (celle.length >= 4 && /^\d+$/.test(celle[1]) && celle[3] === "RAG") {
      domande.push({ numero: Number(celle[1]), testo: celle[2] });
    }
  }
  return domande;
}

async function main() {
  const domande = leggiDomandeRag();
  console.log(`Domande RAG trovate: ${domande.length}\n`);

  for (const domanda of domande) {
    const risultati = await cercaProcedure(domanda.testo, 3);
    console.log(`${domanda.numero}. ${domanda.testo}`);
    risultati.forEach((r, i) => {
      const { file, sezione } = r.metadati;
      console.log(`   ${i + 1}) [${r.distanza.toFixed(3)}] ${sezione}  (${file})`);
    });
    console.log();
  }
}

main().catch((errore) => {
  console.error("Test della ricerca non riuscito:", errore.message);
  process.exit(1);
});
