import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline boot (M1), production only. The dev server re-serves modules on every
// save, and a worker answering from cache would make edits silently invisible.
// Dev goes further and unregisters: running `npm run dev` on the same localhost
// port that once served a `dist` build would otherwise leave that build's worker
// in charge of this one.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // After load, so registering never competes with the first paint.
    window.addEventListener('load', () => {
      // A worker that fails to register costs offline boot and nothing else —
      // taking the app down over it would be the larger bug.
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  } else {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {})
  }
}
