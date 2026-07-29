# Thrift Flip

A mobile-first dark mode React app for resellers who shop at Goodwill and sell on eBay. Point your phone camera at an item, get an instant flip verdict, and turn it into a listing — without typing more than a few words.

## Stack

- **React 19** + **Vite 8** — no TypeScript
- **Plain CSS** — a token system in `src/index.css` and a shared component layer in `src/components/ui/`; screen CSS is layout glue only
- **Direct `fetch` to Gemini** — analysis goes straight from the device on your own key, with nothing in between
- **A live viewfinder** — `getUserMedia` streams the rear camera into the capture screen and the shutter grabs a frame; if the camera is refused or absent it falls back to the native one, which is where every photo came from before M2
- **Three stateless relays** (`api/ebay/*`, `api/serpapi/*`) — eBay serves no CORS headers and its token exchange needs a client secret; SerpApi is a metered server-to-server key. Thin relays are unavoidable, and they store nothing
- **React state + localStorage + IndexedDB** — no Redux, no external state library. Photos and encrypted credentials live in IndexedDB
- **A hand-rolled service worker** (`src/sw.js`, no build plugins beyond a 25-line one in `vite.config.js`) — installed to the home screen, the app **boots with no network at all**, which is the whole point of a pencil floor figured on the phone
- **Vercel** — deployment target

## Screens

Four tabs, plus screens reached from them.

| Screen | What it does |
|---|---|
| **Buy** | Camera-first capture → pencil estimate → stamped verdict |
| **Cart** | Items you decided to buy, with the trip total |
| **List** | The eBay listing editor, seeded from the analysis |
| **Selling** | What you've sent, and what's still in progress |
| Flip | Per-item chat about a find |
| Drafts · Preview · Settings | Saved work, the buyer's-eye view, and your AI key |

## Getting Started

```bash
npm install
npm run dev
```

No `.env` file and no build-time secrets. Open **Selling → key icon → Add your AI key** and paste a Gemini key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Everything before the verdict — capture, the pencil floor, cart, drafts — works with no key at all.

## How analysis works

One multimodal call. Photos plus your notes go to Gemini with a structured-output schema (`src/config/schema.js`), and one response comes back carrying the identification, the condition read, an eBay listing, a **Mercari variant**, the price estimate, and a strategy note. The buy/skip arithmetic is not the model's job — the 3× and $20-net rules live in `src/utils/calculations.js` and run on-device.

Your key is **AES-GCM ciphertext on the phone**, unlocked by Face ID — or a PIN where Face ID isn't available. The encryption key comes from the biometric assertion itself, so without you the ciphertext isn't merely protected, it's unopenable. The key leaves the phone only in the request to Google, and it is excluded from the JSON backup. Revoke it in seconds at the link above.

## Distribution — three lanes

**Send to eBay (API, one tap) → Vendoo imports the eBay listing → Vendoo crosslists to Mercari, Poshmark and Facebook.**

eBay is the one real integration; Vendoo is an optional fan-out that our listing quality feeds. We never build marketplace form-filling automation — that is Vendoo's full-time business, and browser robots against changing DOMs are not a feature.

Below Vendoo sits the floor, which ships today: **copy-assist**. The List screen's distribution row builds a labeled clipboard package and deep-links you into the marketplace's own sell flow — *Copy for eBay* uses whatever is in the editor right now, *Copy for Mercari* uses the Mercari register from the analysis. It needs no accounts, no API and no subscription, and it stays reachable forever as the escape hatch when a validation fight strands a listing.

## Where things run

The sovereignty claim, stated precisely: **no server holds your data.** Not "no
server exists" — eBay's CORS policy makes that impossible for a web app — but
nothing that runs remotely keeps anything.

| Runs | Holds | Notes |
|---|---|---|
| **Your phone** | Everything — cart, drafts, conversations, sold history, photos, and both credentials as ciphertext | The only complete copy. `Download everything` is your backup; there is no account to restore from |
| **`api/ebay/*`** (Vercel) | Nothing | Two stateless functions. No database, no KV, and no logging of bodies or tokens. They exist because eBay serves no CORS headers and its token exchange needs a client secret |
| **`api/serpapi/comps`** (Vercel) | Nothing | Comps tier A. Stateless, same bearer gate, same no-logging rule. Returns a computed summary — median, count, window, velocity, five samples — never SerpApi's payload. **Answers `unavailable` today**: eBay gates sold search and SerpApi's engine does not get through it |
| **Google** | The analysis request, in flight | Photos and notes go direct from the device on your own key |
| **eBay** | Your listings, drafts and orders | Where the selling actually happens; the app never publishes on your behalf |

Photos never leave the phone. They are downscaled at capture, stored in
IndexedDB, and attached to analysis and chat requests — never uploaded to any
host of ours, because there isn't one.

## Testing

```bash
npm test        # Vitest — pure-logic specs (profit math, house rules, schema shape)
npm run build
```

Two harnesses sit outside `npm test`, both dev-only and neither a dependency:

- `scripts/live-check.mjs` runs real analyses against labeled fixtures and scores identification, anchoring and calibration. It takes keys from the environment only.
- `scripts/mobile-check.mjs` builds, serves `dist/`, and proves offline boot, the service worker's caching rules and its deploy purge, the live viewfinder and its fallback, and the shipping estimate's clamp — then sweeps every screen at 360×800, 375×667, 390×844 and 430×932 for overflow, sub-44px tap targets and misplaced fixed chrome. Needs a browser for the run and nothing afterwards:

  ```bash
  npm i --no-save playwright-core && npx playwright-core install chromium
  node scripts/mobile-check.mjs                      # everything
  node scripts/mobile-check.mjs --camera --shipping  # or one suite at a time
  ```

See `docs/v1-live-check-runbook.md`.

## Roadmap

- [x] Real Gemini analyze on the user's own key
- [x] Pencil floor + the first unit tests
- [x] Component layer, four-tab camera-first shell, PWA install
- [x] Mercari variant + copy-assist for both marketplaces
- [x] Encrypted credential vault — Face ID or PIN, no plaintext keys (N1-lite)
- [x] eBay OAuth connect and one-tap drafts (E1–E2)
- [x] Real chat on the analysis, with the photos in context (V3)
- [x] Sold orders flowing back into Selling; comps tier 0 from your own sales (E3–E4)
- [x] Offline boot and a measured mobile pass — the installed app opens with no signal (M1)
- [x] Live viewfinder, shipping estimated by the model instead of guessed in the aisle, safe areas (M2)
- [ ] Comps tiers A and B — sold-listing search beyond your own history (V2)
- [ ] Multi-device sync and portable identity (Nostr N1–N6, deferred)

**The build is complete; the verification is not.** Eleven checks need a real
phone, a real key and a sandbox account — they are indexed in
`docs/v1-live-check-runbook.md` §10 and every one is still unrun. Start with
§11a: on iOS, adding the app to the home screen *after* adding your key leaves
the key behind in Safari's separate storage. Planning docs live in `docs/`;
`docs/thrift-flip-plan.md` outranks the others on sequencing.
