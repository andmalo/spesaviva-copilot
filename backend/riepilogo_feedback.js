// Riepilogo delle valutazioni: voti positivi e negativi per strumento, letti da feedback.jsonl.
// Uso (dalla cartella backend):  node riepilogo_feedback.js [percorso del file]
const fs = require("node:fs");
const path = require("node:path");

const percorso = process.argv[2] ?? path.join(__dirname, "feedback.jsonl");
if (!fs.existsSync(percorso)) {
  console.log(`Nessuna valutazione: il file ${percorso} non esiste ancora.`);
  process.exit(0);
}

const conteggi = new Map(); // strumento -> { positivi, negativi }
let totale = 0;
let righeNonValide = 0;
for (const riga of fs.readFileSync(percorso, "utf-8").split(/\r?\n/)) {
  if (!riga.trim()) continue;
  let voto;
  try {
    voto = JSON.parse(riga);
  } catch {
    righeNonValide++;
    continue;
  }
  if (voto.voto !== "su" && voto.voto !== "giu") {
    righeNonValide++;
    continue;
  }
  totale++;
  // Una risposta con più strumenti conta per ognuno di essi
  const strumenti = Array.isArray(voto.strumenti) && voto.strumenti.length ? voto.strumenti : ["(nessuno strumento)"];
  for (const nome of strumenti) {
    const c = conteggi.get(nome) ?? { positivi: 0, negativi: 0 };
    if (voto.voto === "su") c.positivi++;
    else c.negativi++;
    conteggi.set(nome, c);
  }
}

console.log(`Valutazioni: ${totale}${righeNonValide ? ` (righe non valide ignorate: ${righeNonValide})` : ""}\n`);
const larghezza = Math.max(10, ...[...conteggi.keys()].map((n) => n.length));
console.log(`${"Strumento".padEnd(larghezza)}  Positivi  Negativi`);
for (const [nome, c] of [...conteggi].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${nome.padEnd(larghezza)}  ${String(c.positivi).padStart(8)}  ${String(c.negativi).padStart(8)}`);
}
