// Installazione e avvio del progetto con un solo comando (Windows, macOS e Linux).
//
//   npm run setup     crea il .venv se manca, installa le dipendenze Python e Node,
//                     indicizza il manuale in ChromaDB se la collezione non esiste ancora
//                     (npm run setup -- --reindicizza per rifarla da capo)
//   npm start         avvia ChromaDB, data agent, back end e front end, in quest'ordine,
//                     aspettando che ognuno sia pronto. Ctrl+C li ferma tutti.
//   node avvia.mjs produzione   avvio nel contenitore Docker (Render), vedi Dockerfile
import { spawn, spawnSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const CARTELLA = import.meta.dirname
const WINDOWS = process.platform === 'win32'
const VENV = path.join(CARTELLA, '.venv')
// Il .venv ha gli eseguibili in Scripts\ su Windows e in bin/ altrove
const BIN_VENV = path.join(VENV, WINDOWS ? 'Scripts' : 'bin')
const PYTHON_VENV = path.join(BIN_VENV, WINDOWS ? 'python.exe' : 'python')
const CHROMA_VENV = path.join(BIN_VENV, WINDOWS ? 'chroma.exe' : 'chroma')
const ATTESA_MASSIMA_MS = 120_000 // tempo massimo perché un servizio sia pronto
const NOME_COLLEZIONE = 'procedure_spesaviva'

// --- .env --------------------------------------------------------------------

// Legge le porte dal .env (solo i nomi che servono qui: la chiave non si legge né si stampa)
function leggiConfigurazione() {
  const percorso = path.join(CARTELLA, '.env')
  if (!existsSync(percorso)) {
    termina('Manca il file .env nella cartella del progetto.\n' +
      'Copia .env.example in .env e inserisci la tua chiave OpenAI e i modelli, poi riprova.')
  }
  const valori = {}
  for (const riga of readFileSync(percorso, 'utf-8').split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m) valori[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  const chiave = valori.OPENAI_API_KEY
  if (!chiave || chiave === 'inserisci-qui-la-tua-chiave') {
    termina('Nel file .env manca la chiave OPENAI_API_KEY (c\'è ancora il valore di esempio?).')
  }
  return {
    chroma: Number(valori.CHROMA_PORT || 8000),
    dataAgent: Number(valori.DATA_AGENT_PORT || 8001),
    backend: Number(valori.BACKEND_PORT || 3001),
    frontend: 5173, // fissa: il back end accetta CORS solo da localhost:5173
  }
}

// --- Processi ----------------------------------------------------------------

const servizi = [] // processi avviati, da fermare alla fine
let inChiusura = false

function termina(messaggio) {
  console.error(`\n[avvio] ${messaggio}`)
  fermaTutti()
  process.exit(1)
}

// Comando sincrono (installazioni): si vede l'output, se fallisce ci si ferma
function esegui(descrizione, comando, argomenti, cwd = CARTELLA) {
  console.log(`\n[setup] ${descrizione}`)
  // npm su Windows è un file .cmd: serve la shell, con il comando in un'unica stringa (argomenti fissi)
  const esito = WINDOWS && comando === 'npm'
    ? spawnSync(`npm ${argomenti.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
    : spawnSync(comando, argomenti, { cwd, stdio: 'inherit' })
  if (esito.status !== 0) termina(`Non riuscito: ${descrizione}.`)
}

// Avvia un servizio e ne mostra l'output riga per riga con un prefisso
// senzaChiave: il servizio non riceve OPENAI_API_KEY nelle variabili d'ambiente.
// chiaveDaStdin: la chiave arriva da standard input (data agent in produzione, vedi data_agent/app.py).
// uid/gid: utente con cui gira il servizio (solo Linux, nel contenitore).
function avvia(nome, comando, argomenti, { cwd = CARTELLA, env = {}, senzaChiave = false, chiaveDaStdin = false, uid, gid } = {}) {
  const ambiente = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...env }
  if (senzaChiave || chiaveDaStdin) delete ambiente.OPENAI_API_KEY
  if (chiaveDaStdin) ambiente.CHIAVE_DA_STDIN = '1'
  const processo = spawn(comando, argomenti, {
    cwd,
    env: ambiente,
    // Fuori da Windows ogni servizio ha il suo gruppo di processi, da fermare tutto insieme
    detached: !WINDOWS,
    ...(uid !== undefined && { uid, gid }),
  })
  if (chiaveDaStdin) processo.stdin.end(`${process.env.OPENAI_API_KEY}\n`)
  const prefisso = `[${nome}]`.padEnd(13)
  for (const flusso of [processo.stdout, processo.stderr]) {
    let resto = ''
    flusso.on('data', (dati) => {
      const righe = (resto + dati.toString()).split(/\r?\n/)
      resto = righe.pop()
      for (const riga of righe) if (riga.trim()) console.log(`${prefisso} ${riga}`)
    })
  }
  processo.on('exit', (codice) => {
    // Con Ctrl+C anche i servizi ricevono il segnale e possono chiudersi prima del gestore qui sotto:
    // si aspetta un attimo, così un arresto voluto non viene scambiato per un errore
    setTimeout(() => {
      if (!inChiusura) termina(`${nome} si è fermato (codice ${codice}): fermo anche gli altri servizi.`)
    }, 500)
  })
  servizi.push({ nome, processo })
  return processo
}

function fermaTutti() {
  inChiusura = true
  // In ordine inverso: prima il front end, per ultimo ChromaDB
  for (const { nome, processo } of [...servizi].reverse()) {
    if (processo.exitCode !== null || processo.signalCode !== null) continue
    try {
      if (WINDOWS) execSync(`taskkill /PID ${processo.pid} /T /F`, { stdio: 'ignore' })
      else process.kill(-processo.pid, 'SIGTERM')
    } catch {
      // già fermato (per esempio dallo stesso Ctrl+C del terminale)
    }
    console.log(`[avvio] fermato: ${nome}`)
  }
}

// Vero se qualcuno ascolta già sulla porta
function portaOccupata(porta) {
  return new Promise((risolvi) => {
    const socket = net.connect({ port: porta, host: '127.0.0.1' })
    socket.once('connect', () => { socket.destroy(); risolvi(true) })
    socket.once('error', () => risolvi(false))
  })
}

// Aspetta che l'indirizzo risponda con 200
async function attendiPronto(nome, url) {
  const scadenza = Date.now() + ATTESA_MASSIMA_MS
  while (Date.now() < scadenza) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok) {
        console.log(`[avvio] pronto: ${nome}`)
        return
      }
    } catch {
      // non ancora in ascolto
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  termina(`${nome} non è pronto dopo ${ATTESA_MASSIMA_MS / 1000} secondi.`)
}

function avviaChroma(porte) {
  // ChromaDB non calcola embedding (li calcola il back end): la chiave non gli serve
  avvia('chromadb', CHROMA_VENV, ['run', '--path', path.join(CARTELLA, 'chroma_data'), '--host', '127.0.0.1', '--port', String(porte.chroma)],
    { senzaChiave: true })
  return attendiPronto('ChromaDB', `http://127.0.0.1:${porte.chroma}/api/v2/heartbeat`)
}

async function controllaPorteLibere(porte) {
  for (const [nome, porta] of Object.entries(porte)) {
    if (await portaOccupata(porta)) {
      termina(`La porta ${porta} (${nome}) è già occupata: forse il progetto è già avviato in un altro terminale.`)
    }
  }
}

// Ctrl+C (e chiusura del terminale): si fermano tutti i servizi
for (const segnale of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(segnale, () => {
    if (inChiusura) return
    console.log('\n[avvio] arresto dei servizi...')
    fermaTutti()
    process.exit(0)
  })
}

// --- Comandi -----------------------------------------------------------------

async function setup() {
  const porte = leggiConfigurazione()

  if (!existsSync(PYTHON_VENV)) {
    // Python di sistema: "py" su Windows, "python3" altrove (con "python" come alternativa)
    const candidati = WINDOWS ? ['py', 'python'] : ['python3', 'python']
    const python = candidati.find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0)
    if (!python) termina('Python non trovato: installa Python 3 e riprova.')
    esegui('Creazione dell\'ambiente virtuale .venv', python, ['-m', 'venv', VENV])
  } else {
    console.log('[setup] Ambiente virtuale .venv già presente')
  }
  esegui('Dipendenze Python (requirements.txt)', PYTHON_VENV, ['-m', 'pip', 'install', '-r', 'requirements.txt'])
  esegui('Dipendenze del back end', 'npm', ['install'], path.join(CARTELLA, 'backend'))
  esegui('Dipendenze del front end', 'npm', ['install'], path.join(CARTELLA, 'frontend'))

  // Indicizzazione del manuale: richiede ChromaDB acceso e usa gli embedding OpenAI,
  // quindi si fa solo se la collezione manca (o se lo si chiede con --reindicizza)
  if (await portaOccupata(porte.chroma)) termina(`La porta ${porte.chroma} di ChromaDB è già occupata: ferma il progetto e riprova.`)
  await avviaChroma(porte)
  const collezione = await fetch(
    `http://127.0.0.1:${porte.chroma}/api/v2/tenants/default_tenant/databases/default_database/collections/${NOME_COLLEZIONE}`)
  if (collezione.ok && !process.argv.includes('--reindicizza')) {
    console.log(`\n[setup] Manuale già indicizzato (collezione "${NOME_COLLEZIONE}"): nessuna chiamata a OpenAI`)
  } else {
    esegui('Indicizzazione del manuale in ChromaDB', 'node', ['rag/indicizza.js'], path.join(CARTELLA, 'backend'))
  }
  fermaTutti()
  console.log('\n[setup] Installazione completata. Per avviare il progetto: npm start')
}

async function start() {
  const porte = leggiConfigurazione()
  if (!existsSync(PYTHON_VENV) || !existsSync(path.join(CARTELLA, 'frontend', 'node_modules'))) {
    termina('Dipendenze non installate: esegui prima npm run setup')
  }
  await controllaPorteLibere(porte)

  await avviaChroma(porte)
  avvia('data-agent', PYTHON_VENV, [path.join('data_agent', 'app.py')])
  await attendiPronto('data agent', `http://127.0.0.1:${porte.dataAgent}/health`)
  avvia('backend', process.execPath, ['server.js'], { cwd: path.join(CARTELLA, 'backend') })
  await attendiPronto('back end', `http://127.0.0.1:${porte.backend}/api/scenari`)
  // Vite lanciato direttamente con node (non con npm.cmd), così Ctrl+C non chiede conferme
  avvia('frontend', process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js')], { cwd: path.join(CARTELLA, 'frontend') })
  await attendiPronto('front end', `http://localhost:${porte.frontend}/`)

  console.log(`\n[avvio] Tutto pronto: apri http://localhost:${porte.frontend}  (Ctrl+C per fermare tutto)\n`)
}

// Avvio nel contenitore Docker (Render): configurazione dalle variabili d'ambiente della piattaforma,
// front end già compilato e servito dal back end, data agent con un utente separato.
async function produzione() {
  for (const variabile of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'ORCHESTRATOR_MODEL', 'PORT']) {
    if (!process.env[variabile]) termina(`Variabile ${variabile} mancante: impostala nelle variabili d'ambiente del servizio.`)
  }
  const porte = { chroma: 8000, dataAgent: 8001 }
  await avviaChroma(porte)
  // Il disco del contenitore si azzera a ogni riavvio: se manca, il manuale si reindicizza (una sola chiamata di embedding)
  const collezione = await fetch(
    `http://127.0.0.1:${porte.chroma}/api/v2/tenants/default_tenant/databases/default_database/collections/${NOME_COLLEZIONE}`)
  if (!collezione.ok) esegui('Indicizzazione del manuale in ChromaDB', 'node', ['rag/indicizza.js'], path.join(CARTELLA, 'backend'))

  // Il codice scritto dall'agente gira con un utente diverso: non può leggere variabili e memoria
  // degli altri processi (dove c'è la chiave) e la chiave stessa gli arriva da standard input
  const utente = process.env.UID_DATA_AGENT
    ? { uid: Number(process.env.UID_DATA_AGENT), gid: Number(process.env.GID_DATA_AGENT) }
    : {}
  avvia('data-agent', PYTHON_VENV, [path.join('data_agent', 'app.py')], { chiaveDaStdin: true, ...utente })
  await attendiPronto('data agent', `http://127.0.0.1:${porte.dataAgent}/health`)
  avvia('backend', process.execPath, ['server.js'], { cwd: path.join(CARTELLA, 'backend'), env: { MODALITA: 'produzione' } })
  await attendiPronto('back end', `http://127.0.0.1:${process.env.PORT}/api/scenari`)
  console.log(`\n[avvio] Tutto pronto sulla porta ${process.env.PORT}\n`)
}

const comandi = { setup, start, produzione }
const comando = comandi[process.argv[2]]
if (!comando) termina('Uso: node avvia.mjs setup | start | produzione')
comando().catch((errore) => termina(`Errore imprevisto: ${errore.message}`))
