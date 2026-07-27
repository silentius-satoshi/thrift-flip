import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    // The edge relays (E1) are the repo's only server code — Node globals, no
    // React, no DOM. Everything under src/ stays browser-only.
    files: ['api/**/*.js', 'scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // The mobile harness is a node script whose page.evaluate bodies are
    // browser code — it needs both sets, and saying so here beats contorting
    // the callbacks to avoid naming `document`.
    files: ['scripts/mobile-check.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Vitest runs specs in the node environment (vite.config.js), so node
    // globals are simply true there. Merged on top of the browser block below.
    files: ['**/*.test.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // The service worker runs in its own global scope, and the two placeholders
    // vite.config.js substitutes at build time are undefined until it does.
    files: ['src/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, __PRECACHE__: 'readonly' },
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['api/**/*.js'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
