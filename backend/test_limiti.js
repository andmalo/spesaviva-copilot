// Test del contatore dei token del giorno (limiti.js), SENZA chiamate a OpenAI e senza un Redis vero:
// - cambio di giorno con il fuso di Roma (23:30 UTC del 31 ottobre = 00:30 del 1 novembre a Roma);
// - contatore che sopravvive a un "riavvio" (nuova istanza del modulo sullo stesso archivio), su file e su Redis;
// - Redis che non risponde: richieste rifiutate con un messaggio chiaro e riga di log; token non persi;
// - server vero con un Redis irraggiungibile: la chat risponde 503.
//
// Uso (dalla cartella backend):  node test_limiti.js
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

const FILE = path.join(os.tmpdir(), `contatore_test_${process.pid}.json`);
process.env.FILE_CONTATORE_TOKEN = FILE;
process.env.TETTO_TOKEN_GIORNALIERO = "1000";
delete process.env.REDIS_URL;

let falliti = 0;
function verifica(descrizione, ok) {
  console.log(`  ${ok ? "OK  " : "NO  "} ${descrizione}`);
  if (!ok) falliti++;
}

// Nuova istanza dei moduli, come dopo un riavvio del server (lo stato in memoria si perde)
function caricaLimiti() {
  for (const modulo of ["./limiti", "./config"]) delete require.cache[require.resolve(modulo)];
  return require("./limiti");
}

// Finto Redis: get, incrBy, expire su una Map, con le scadenze annotate; "giu" simula un Redis che non risponde
function creaRedisFinto() {
  const dati = new Map();
  const scadenze = new Map();
  const finto = {
    giu: false, comandi: [], dati, scadenze,
    async get(chiave) { if (finto.giu) return new Promise(() => {}); finto.comandi.push("GET"); return dati.has(chiave) ? String(dati.get(chiave)) : null; },
    async incrBy(chiave, n) { if (finto.giu) return new Promise(() => {}); finto.comandi.push("INCRBY"); dati.set(chiave, (dati.get(chiave) ?? 0) + n); return dati.get(chiave); },
    async expire(chiave, s) { if (finto.giu) return new Promise(() => {}); finto.comandi.push("EXPIRE"); scadenze.set(chiave, s); return 1; },
  };
  return finto;
}

// Righe di log scritte durante fn (il logger scrive sullo standard output)
async function conLog(fn) {
  const righe = [];
  const originale = process.stdout.write.bind(process.stdout);
  process.stdout.write = (testo, ...resto) => { righe.push(String(testo)); return originale(testo, ...resto); };
  try {
    await fn();
  } finally {
    process.stdout.write = originale;
  }
  return righe.join("");
}

async function errore(promessa) {
  try { await promessa; return null; } catch (e) { return e; }
}

async function main() {
  fs.rmSync(FILE, { force: true });
  let limiti = caricaLimiti();

  console.log("\nGiorno con il fuso di Roma");
  const { giornoRoma } = limiti;
  verifica("31/10 23:30 UTC = 1 novembre a Roma", giornoRoma(new Date("2026-10-31T23:30:00Z")) === "2026-11-01");
  verifica("31/10 22:59 UTC = ancora 31 ottobre a Roma", giornoRoma(new Date("2026-10-31T22:59:00Z")) === "2026-10-31");
  verifica("ora legale: 30/6 22:30 UTC = 1 luglio a Roma", giornoRoma(new Date("2026-06-30T22:30:00Z")) === "2026-07-01");

  console.log("\nCambio di giorno a mezzanotte di Roma");
  let ora = new Date("2026-10-31T22:30:00Z"); // 23:30 del 31 ottobre a Roma
  const redisMezzanotte = creaRedisFinto();
  const c = limiti.creaContatoreToken({ archivio: limiti.creaArchivioRedis(redisMezzanotte), tetto: 1000, adesso: () => ora });
  await c.aggiungiTokenOggi(1000);
  const primaDiMezzanotte = await errore(c.controllaTettoGiornaliero());
  verifica(`alle 23:30 di Roma il tetto è raggiunto (${primaDiMezzanotte?.codice})`, primaDiMezzanotte?.codice === "tetto_giornaliero");
  ora = new Date("2026-10-31T23:30:00Z"); // 00:30 del 1 novembre a Roma, ancora 31 ottobre in UTC
  verifica(`alle 00:30 di Roma il contatore riparte da zero (${await c.tokenUsatiOggi()})`, (await c.tokenUsatiOggi()) === 0);
  verifica("e le richieste sono di nuovo accettate", (await errore(c.controllaTettoGiornaliero())) === null);
  verifica("chiavi con la data: token:2026-10-31 e nessun token:2026-11-01 finché non si spende",
    redisMezzanotte.dati.get("token:2026-10-31") === 1000 && !redisMezzanotte.dati.has("token:2026-11-01"));

  console.log("\nRiavvio simulato, archivio su file");
  verifica(`archivio file senza REDIS_URL (${limiti.archivioContatore})`, limiti.archivioContatore === "file");
  await limiti.aggiungiTokenOggi(600);
  limiti = caricaLimiti(); // "riavvio"
  verifica(`dopo il riavvio il contatore vale ancora 600 (${await limiti.tokenUsatiOggi()})`, (await limiti.tokenUsatiOggi()) === 600);
  await limiti.aggiungiTokenOggi(500);
  limiti = caricaLimiti();
  const oltre = await errore(limiti.controllaTettoGiornaliero());
  verifica(`600 + 500 oltre il tetto di 1000 anche dopo due riavvii (${oltre?.stato} ${oltre?.codice})`,
    oltre?.stato === 429 && oltre.codice === "tetto_giornaliero");
  const contenuto = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  verifica(`chiave con la data di Roma nel file (${Object.keys(contenuto)})`, contenuto[`token:${giornoRoma(new Date())}`] === 1100);

  console.log("\nFile del contatore rovinato");
  fs.writeFileSync(FILE, "{ non è json");
  const rovinato = await errore(limiti.controllaTettoGiornaliero());
  verifica(`richiesta rifiutata, non contatore azzerato (${rovinato?.stato} ${rovinato?.codice})`,
    rovinato?.stato === 503 && rovinato.codice === "limite_spesa_non_verificabile");
  fs.rmSync(FILE, { force: true });

  console.log("\nRiavvio simulato, archivio su Redis");
  const redis = creaRedisFinto();
  const primo = limiti.creaContatoreToken({ archivio: limiti.creaArchivioRedis(redis), tetto: 1000 });
  await primo.aggiungiTokenOggi(300);
  const secondo = limiti.creaContatoreToken({ archivio: limiti.creaArchivioRedis(redis), tetto: 1000 }); // "riavvio"
  verifica(`la nuova istanza legge 300 (${await secondo.tokenUsatiOggi()})`, (await secondo.tokenUsatiOggi()) === 300);
  const chiave = `token:${giornoRoma(new Date())}`;
  verifica(`INCRBY sulla chiave ${chiave} con scadenza di 48 ore (${redis.scadenze.get(chiave)} s)`,
    redis.comandi.includes("INCRBY") && redis.scadenze.get(chiave) === 48 * 60 * 60);
  // Due istanze che spendono insieme (per esempio due server): INCRBY non perde token
  await Promise.all([primo.aggiungiTokenOggi(100), secondo.aggiungiTokenOggi(50), primo.aggiungiTokenOggi(25)]);
  verifica(`spese contemporanee sommate tutte (${redis.dati.get(chiave)})`, redis.dati.get(chiave) === 475);

  console.log("\nRedis che non risponde");
  const giu = creaRedisFinto();
  const contatoreGiu = limiti.creaContatoreToken({ archivio: limiti.creaArchivioRedis(giu, { timeoutMs: 100 }), tetto: 1000 });
  await contatoreGiu.aggiungiTokenOggi(40);
  giu.giu = true;
  let rifiuto;
  const log = await conLog(async () => { rifiuto = await errore(contatoreGiu.controllaTettoGiornaliero()); });
  verifica(`richiesta rifiutata, non accettata senza limite (${rifiuto?.stato} ${rifiuto?.codice})`,
    rifiuto?.stato === 503 && rifiuto.codice === "limite_spesa_non_verificabile");
  verifica("messaggio chiaro per l'utente", rifiuto?.message.includes("non è possibile verificare il limite di spesa"));
  verifica("il rifiuto finisce nel log", log.includes("limite di spesa non verificabile: richiesta rifiutata"));
  // Token di una chiamata già fatta mentre Redis non risponde: restano in sospeso e si salvano al ritorno
  await conLog(() => Promise.all([contatoreGiu.aggiungiTokenOggi(10), contatoreGiu.aggiungiTokenOggi(5)]));
  giu.giu = false;
  await contatoreGiu.aggiungiTokenOggi(1);
  verifica(`al ritorno di Redis nessun token perso né contato due volte (${giu.dati.get(chiave)})`, giu.dati.get(chiave) === 56);

  console.log("\nServer vero con un Redis irraggiungibile");
  const porta = 3111;
  const server = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, OPENAI_API_KEY: "chiave-finta-per-il-test", ORCHESTRATOR_MODEL: "finto", BACKEND_PORT: String(porta),
      REDIS_URL: "redis://127.0.0.1:1", LOG_FORMAT: "json", LOG_LEVEL: "info" },
  });
  let uscita = "";
  server.stdout.on("data", (d) => { uscita += d; });
  server.stderr.on("data", (d) => { uscita += d; });
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`http://127.0.0.1:${porta}/api/scenari`)).ok) break; } catch { /* non ancora pronto */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    const r = await fetch(`http://127.0.0.1:${porta}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s", messaggio: "Ciao", scenario: "caldo" }),
    });
    const corpo = await r.json();
    verifica(`la chat risponde ${r.status} ${corpo.codice}`, r.status === 503 && corpo.codice === "limite_spesa_non_verificabile");
    await new Promise((ok) => setTimeout(ok, 200));
    const righe = uscita.split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return {}; } });
    const rifiutata = righe.find((x) => x.msg === "limite di spesa non verificabile: richiesta rifiutata");
    const fine = righe.find((x) => x.msg === "richiesta completata" && x.rotta === "/api/chat");
    verifica("nel log il rifiuto e la riga di fine richiesta con lo stesso requestId",
      rifiutata?.archivio === "redis" && fine?.codice === "limite_spesa_non_verificabile" && rifiutata.requestId === fine.requestId);
    verifica("nel log l'archivio Redis non raggiungibile", righe.some((x) => x.msg === "archivio del contatore dei token non raggiungibile"));
  } finally {
    if (process.platform === "win32") execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill();
  }
}

main()
  .catch((e) => { console.error(`Test interrotto: ${e.message}`); falliti++; })
  .finally(() => {
    fs.rmSync(FILE, { force: true });
    console.log(falliti ? `\n${falliti} verifiche NON superate` : "\nTutte le verifiche superate");
    process.exitCode = falliti ? 1 : 0;
  });
