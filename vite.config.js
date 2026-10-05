import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { setupEngine } from './scripts/setup-engine.mjs'

// The engine binaries are generated out of node_modules and never committed, so a
// build that skips the npm prebuild hook (a bare `vite build`, or a hosting build
// command typed by hand) would ship a site whose worker 404s on /stockfish.js.
// Copying in buildStart happens before Vite mirrors public/ into dist/, so the
// engine ends up in the output either way.
const stockfishEngine = {
  name: 'stockfish-engine',
  async buildStart() {
    try {
      for (const line of await setupEngine()) console.log(`[engine] ${line}`)
    } catch (err) {
      this.error(err.message) // fail the build rather than ship a dead engine
    }
  },
  // Dev only self-heals: a missing copy here is the same file predev already made,
  // and a warning beats blocking the server on a 94.5 MB read.
  configureServer() {
    setupEngine().catch((err) => console.warn(`[engine] ${err.message}`))
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stockfishEngine],
})
