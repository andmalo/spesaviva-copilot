// Configurazione di Vite per il front end della chat.
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Il .env sta nella cartella principale del progetto, un livello sopra frontend/
const CARTELLA_PROGETTO = path.resolve(import.meta.dirname, '..')

export default defineConfig(({ mode }) => {
  // Leggo solo le variabili che iniziano con "BACKEND_": la chiave API e le altre
  // variabili del .env non vengono mai caricate nella configurazione del front end
  const env = loadEnv(mode, CARTELLA_PROGETTO, 'BACKEND_')
  const portaBackend = env.BACKEND_PORT || '3001'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true, // il back end accetta CORS solo da localhost:5173
      // Le chiamate a /api vanno al back end Node.js: il browser parla solo con Vite
      proxy: {
        '/api': {
          // 127.0.0.1 e non localhost: il back end ascolta solo sull'indirizzo IPv4 di loopback
          target: `http://127.0.0.1:${portaBackend}`,
          changeOrigin: true,
        },
      },
    },
  }
})
