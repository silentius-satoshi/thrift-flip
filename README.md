# Thrift Flip

A mobile-first dark mode React app for resellers who shop at Goodwill and sell on eBay. Point your phone camera at an item, get an instant flip verdict, and turn it into a listing — without typing more than a few words.

## Stack

- **React 19** + **Vite 8** — no TypeScript
- **Plain CSS** — a token system in `src/index.css` and a shared component layer in `src/components/ui/`; screen CSS is layout glue only
- **Direct `fetch`** — the app calls Gemini straight from the device on the user's own key. No server, no middleman
- **React state + localStorage** — no Redux, no external state library
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

The key is stored on the phone in plaintext and never leaves it except in the request to Google. It is excluded from the JSON backup. Revoke it in seconds at the link above.

## Distribution — three lanes

**Send to eBay (API, one tap — arrives at E2) → Vendoo imports the eBay listing → Vendoo crosslists to Mercari, Poshmark and Facebook.**

eBay is the one real integration; Vendoo is an optional fan-out that our listing quality feeds. We never build marketplace form-filling automation — that is Vendoo's full-time business, and browser robots against changing DOMs are not a feature.

Below Vendoo sits the floor, which ships today: **copy-assist**. The List screen's distribution row builds a labeled clipboard package and deep-links you into the marketplace's own sell flow — *Copy for eBay* uses whatever is in the editor right now, *Copy for Mercari* uses the Mercari register from the analysis. It needs no accounts, no API and no subscription, and it stays reachable forever as the escape hatch when a validation fight strands a listing.

## Testing

```bash
npm test        # Vitest — pure-logic specs (profit math, house rules, schema shape)
npm run build
```

`scripts/live-check.mjs` is a separate harness that runs real analyses against labeled fixtures and scores identification, anchoring and calibration. It takes keys from the environment only. See `docs/v1-live-check-runbook.md`.

## Roadmap

- [x] Real Gemini analyze on the user's own key
- [x] Pencil floor + the first unit tests
- [x] Component layer, four-tab camera-first shell, PWA install
- [x] Mercari variant + copy-assist for both marketplaces
- [ ] eBay OAuth connect and one-tap drafts (E1–E2)
- [ ] Real chat on the analysis (V3)
- [ ] Sold comps ladder — own history, then search (V2)
- [ ] Sold orders flowing back into Selling (E3–E4)

Planning docs live in `docs/`; `docs/thrift-flip-plan.md` is the one that outranks the others on sequencing.
