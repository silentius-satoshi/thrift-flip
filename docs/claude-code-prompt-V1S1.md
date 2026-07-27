# Claude Code Prompt — V1+S1: Real Gemini Analyze + BYOK + Pencil Math + Trip Prep
<!-- Model: Opus 5 · Effort: Max thinking · Verified against repo @ 223b8aa (F2+A complete) -->

Implement V1+S1: replace the mock `analyzeItem` with a **direct client call to Gemini** on the user's own key (BYOK), build the first **Settings** surface with the AI-key flow, land the **real pencil arithmetic** with the repo's first tests, and ship the **trip-prep** items (PWA manifest/icons, JSON export+import, photo-quota guard). References: `docs/thrift-flip-vision-pipeline-v1.md` (§2.5 BYOK, §3 model, §5 schema), `docs/v0-model-check.md` §3 (the system prompt of record), `docs/thrift-flip-plan.md` §6.1 (pencil formula) and §6.2 (anchoring + calibration checks).

**Scope boundary:**
- Only `analyzeItem` goes real. `sendChatMessage`, `generateListing`, `regenerateField`, `sendToEbay` **stay mocks** (V3/E-track).
- **Do not touch:** `src/contexts/*`, `src/hooks/useCart.js`, `src/hooks/useGemini.js`, and the internals of Cart/Listing/Drafts/Preview/Flip. One narrow exception: HistoryMode's **header only** gains the Settings entry button (prototype's `ledger` header key icon) — nothing else in that file.
- No Nostr, no vault, no relays. The AI key is **plaintext under `storageService`** by explicit decision (plan §6.1) with a `// TODO(N1): migrate to vault STORE_ENC_INFO` marker at the write site. It must never appear in logs, toasts, error messages, or the JSON export.
- No new runtime dependencies. Vitest enters as a **devDependency** (the repo's first test runner — say so in your plan).

---

## PART 1 — Config (`src/config/` — new directory)

1. **`gemini.js`**: `export const GEMINI_MODEL = 'gemini-3.6-flash';` (default by plan §6.2 — Dad's real-world model) and `export const GEMINI_FALLBACK = 'gemini-3-flash-preview';` (quota fallback, unused for now but named). `export const DEFAULT_SHIPPING = 12;`
2. **`prompt.js`**: the system prompt **verbatim from `docs/v0-model-check.md` §3** as `export const SYSTEM_PROMPT`. It is the prompt of record; do not editorialize it.
3. **`schema.js`**: the response schema from `docs/v0-model-check.md` §4 (vision §5 minus `listing_mercari`) as `export const RESPONSE_SCHEMA`, in Gemini's schema dialect.

## PART 2 — The real call (`src/utils/ai.js` — new)

- `getAiKey()` / `setAiKey(key)` / `clearAiKey()` over `storageService`, key `thrift-flip-ai-key`, with the TODO(N1) marker at the write site.
- `export async function analyzeItem({ photoBase64s, mimeTypes, details, condition, goodwillPrice, shipping })`:
  - No key → throw `{ code: 'no-key' }` (the UI shows the quiet card, not an error).
  - `POST https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}` with body: `systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }`, `contents: [{ role: 'user', parts: [ ...photoBase64s.map inline_data {mime_type, data}, { text: userMessage } ] }]`, `generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }`.
  - `userMessage` in the V0 doc's shape: `Notes: … / Condition as I see it: … / Goodwill price: $…` — **include the price initially; the anchoring test in Verification decides whether it stays.** Structure the message builder so removing the price line is a one-line change.
  - Error taxonomy (vision §2.5 — specific, never generic, never echoing the key): HTTP 400/403 → `{ code: 'bad-key' }`; 429 → `{ code: 'quota' }`; fetch TypeError → `{ code: 'offline' }`; schema-parse failure → `{ code: 'bad-response' }`.
  - **Adapter** — map the schema result onto the app shape F2+A consumes, so ShoppingMode barely changes: `estSellPrice = pricing.estimate`, `fees/netProfit` via `calcProfit(estimate, goodwillPrice, shipping)`, `priceRange = [range_low, range_high]`, `confidence = pricing.confidence`, `rationale`, `identification`, `conditionRead`, `listing` (carried for V1.5/E0), `source: 'model'`, `soldCount: null`, `avgDaysToSell: null`, `recentSales: []`, `chatHistory: [{ role: 'ai', text: <rationale-led teaser> }]`.
- `verifyKey(key)`: minimal live call — text-only `"Reply with OK"`, `generationConfig: { maxOutputTokens: 5 }` — returns ok/error-code. Used by the Settings flow.
- `src/utils/webhooks.js`: `analyzeItem` now re-exports from `ai.js`; the old mock body is deleted; all other mocks stay byte-identical.

## PART 3 — Real pencil math (`src/utils/calculations.js` + tests)

- Add `export function pencilFloor(goodwillPrice, shipping = DEFAULT_SHIPPING)` per plan §6.1: `max( 3 × gp, (20 + 0.30 + shipping + gp) / (1 − 0.1325) )`, rounded **up** to the nearest $0.50 (`Math.ceil(x * 2) / 2`). The canonical case: `pencilFloor(8, 12) === 46.50`.
- **Vitest**: add as devDependency, `"test": "vitest run"` script, `src/utils/calculations.test.js` covering `calcProfit` (worked examples + fee rounding), `checkRules` (both rules, boundary at exactly 3× and exactly $20), and `pencilFloor` (the 8/12→46.50 case, the 3×-dominant case, rounding).
- ShoppingMode: delete `pencilFloorStub`, import `pencilFloor`; **shipping becomes a visible input** in the capture details strip (numeric, default `DEFAULT_SHIPPING`, persisted with the form) feeding `pencilFloor`, `calcProfit`, the pencil panel's fees+shipping row, and the earnings panel's shipping row (which currently hardcodes $5).

## PART 4 — Verdict adjustments for real data (ShoppingMode only)

- **No sold data exists at V1** (comps = model only). `soldLine` becomes `Model estimate — verify before big buys` (still tappable → Why sheet). The shipping line loses `sells in ~N days` (no data) and shows `+$X shipping` from the shipping input.
- Why sheet at V1: **Model read** row becomes primary — shows `confidence` and `rationale` from the response; **Your own sales** row shows "None yet — fills in as you sell"; **eBay sold listings** row is replaced by the escape hatch: footer button becomes a real link-out — `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title)}&LH_Sold=1&LH_Complete=1`, opened via `window.open`.
- Banner detail carries confidence when not high: go → `model estimate · ${confidence} confidence`; keep "under your floor" for skip.
- **No-key path:** `Get the verdict` with no key stored → stay on pencil, show a dismissible (per-session) `Card`: "Add your AI key to get stamped verdicts" → routes to Settings. Pencil, Skip, and Add-to-cart all work — the app is fully useful with zero keys (vision §2.5's gate).
- Error paths map the `ai.js` codes to the pencil state + specific copy: `bad-key` → "That key didn't work — check the paste caught the whole thing" (+ Settings link); `quota` → "Key works but Google says it's out of free calls today"; `offline` → existing signal chip; `bad-response` → "Odd reply from the model — try again".

## PART 5 — Settings + the AI-key flow (new screens, `ui/`-composed)

- Screen id **`settings`** added to App.jsx's `valid` array; lazy-init + persist per the repo pattern, including a persisted sub-view key (`thrift-flip-settings-view`: `'main' | 'ai-key'`). Nav visible with **Selling** highlighted (`active` maps `settings → 'history'`). Entry: key-icon button in HistoryMode's header (prototype) → `onOpenSettings`.
- **Settings main** (`Row`s under `.lbl` section headers, all `ui/`):
  - *Your keys*: **Verdicts** row — no key: "Add your AI key" (blue accent) → detail; with key: `Gemini · ••••{last4}` / "runs on your key" → detail.
  - *Backup*: **Download everything** — exports `{ version: 1, exportedAt, data: {…} }` of every `thrift-flip-*` localStorage key **excluding `thrift-flip-ai-key`**, as a Blob download `thrift-flip-backup.json`. Sub-copy: *"This file is your only backup. Thrift Flip has no server."* **Import backup** — file input, parse, version check, explicit confirm ("Replaces everything on this phone"), writes keys (ignores any `ai-key` field even if present in the file), then reloads.
- **AI-key detail** (vision §2.5, verbatim flow): "Open Google's key page" button → `window.open('https://aistudio.google.com/apikey')` with the one-line instruction above it; paste `Input` (`autocomplete="off"`) with paste-button; on submit → `verifyKey` → success: "Connected — verdicts are live" + store + never show the raw string again; failure: the specific error copy. Done state: `Gemini · ••••{last4}`, **Test key**, **Replace key**, **Revoke help** (one line + the aistudio link), and the interim risk note exactly: *"Stored on this phone. Anyone who can unlock your phone can read it — revoke it in seconds at the link below if that ever happens."* (comment: deleted at N1).

## PART 6 — S1 trip prep

- **PWA**: `public/manifest.webmanifest` (name/short_name Thrift Flip, `display: standalone`, `background_color`/`theme_color: #0F0F0F`, icons 192/512). `scripts/gen-icons.mjs` — a one-off node script using **only built-in `zlib`** (no deps) that rasterizes the four-dot mark on `#0F0F0F` to `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png` (180px); commit the PNGs. `index.html`: manifest link, apple-touch-icon link, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`.
- **Photo-quota guard** (the T1 mid-aisle failure, plan §6.1): in the photo pipeline, downscale on capture before base64 — canvas, max edge 1280px, JPEG q0.8. Wrap photo-bearing `storageService` writes in try/catch for `QuotaExceededError` → loud toast "Storage full — export a backup, then remove old drafts", never a silent loss of the verdict.

## Constraints recap

Untouchables as listed. Key never logged/exported/echoed. Mocks other than analyze unchanged. `npm run build` and `npm test` clean; zero console errors.

## Verification (run after implementing)

1. `npm test` green (first run ever — include the output); `npm run build` clean; `var(--…)` grep still resolves.
2. **No-key E2E:** fresh profile → capture → Get the verdict → pencil with the quiet card; floor for gp=8/ship=12 reads **$46.50**; Skip and Add-to-cart work. The app is fully useful with zero keys.
3. **Key flow:** Settings → Add your AI key → paste a real key → "Connected — verdicts are live" → next analyze returns a stamped verdict. Paste garbage → the bad-key copy. Settings and the detail sub-view both survive refresh.
4. **The 5 core items** (sneaker, book, tool, mug, vintage electronics) through the app on a real key → ≥4 correct brand+model in `identification`.
5. **Anchoring test (plan §6.2):** one mid-difficulty item, identical photos/notes, run at $4 then $30 stated price → if `pricing.estimate` moves meaningfully, remove the price line from the user message (the one-line change) and report it in the summary.
6. **Calibration first-pass:** record confidence vs. correctness for the runs above; report the table.
7. Kill the key in AI Studio → next analyze shows the bad-key copy and the pencil still renders.
8. Export → open the JSON → `thrift-flip-ai-key` absent; import on a cleared profile → cart/drafts/history restored.
9. Add to Home Screen → standalone, four-dot icon, dark status bar. Captured photos land under ~300KB each (downscale working).
10. Grep the bundle/network panel: the key appears only in the request URL to `generativelanguage.googleapis.com`, nowhere else. Final summary lists every file changed with line counts.
