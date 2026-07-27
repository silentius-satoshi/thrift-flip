import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // calculations.js is pure — no DOM needed, so no jsdom dependency
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
