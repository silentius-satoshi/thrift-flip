import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const ROOT = dirname(fileURLToPath(import.meta.url))

// Files served from public/ that the installed app needs to boot. `/icons.svg`
// is deliberately absent: nothing in the app loads it.
const SHELL = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.svg']

/**
 * Writes dist/sw.js from src/sw.js, substituting the build's real precache
 * manifest and a version derived from it.
 *
 * The manifest carries the hashed bundle, not just the shell. Precaching only
 * the shell and runtime-caching /assets/* cannot survive the first offline
 * launch: the very first navigation is uncontrolled, so the worker never sees
 * those asset requests and they are still missing when the network goes.
 */
function serviceWorker() {
  return {
    name: 'thrift-flip-sw',
    apply: 'build',
    writeBundle(options, bundle) {
      const emitted = Object.keys(bundle).sort().map((f) => `/${f}`)
      const precache = ['/', ...SHELL, ...emitted]

      // Hashing the public bytes as well as the emitted filenames: an edited
      // manifest or icon changes no hashed filename, so a name-only version
      // would leave the old copy precached forever.
      const version = createHash('sha256')
      version.update(emitted.join('|'))
      for (const path of SHELL) version.update(readFileSync(join(ROOT, 'public', path)))

      const source = readFileSync(join(ROOT, 'src', 'sw.js'), 'utf8')
        .replace('__BUILD_ID__', version.digest('hex').slice(0, 8))
        .replace('__PRECACHE__', JSON.stringify(precache))

      // Rollup has already written its files by this hook, so emitFile is gone
      // and unnecessary — a plain write lands beside them.
      writeFileSync(join(options.dir, 'sw.js'), source)
    },
  }
}

/**
 * The dev server's answer at /sw.js: a worker whose only job is to remove
 * itself.
 *
 * Serve a production build from the same origin and port as `npm run dev` —
 * previewing `dist/`, then going back to work — and the worker it registered
 * keeps answering navigations with its cached shell. The dev server's HTML
 * never loads, so the unregister in main.jsx never gets to run, and the
 * developer sees a frozen build with no obvious way out. The browser's routine
 * update check fetches /sw.js on every navigation, so answering it with this
 * defuses the trap on the spot.
 */
function serviceWorkerKillSwitch() {
  return {
    name: 'thrift-flip-sw-dev-killswitch',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.setHeader('Cache-Control', 'no-store')
        // skipWaiting is the opposite of what the real worker does, and
        // deliberately so: this one exists to interrupt.
        res.end(`self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) {
    try { await client.navigate(client.url); } catch { /* the next reload lands on dev anyway */ }
  }
})()));
`)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker(), serviceWorkerKillSwitch()],
  test: {
    // calculations.js is pure — no DOM needed, so no jsdom dependency
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
