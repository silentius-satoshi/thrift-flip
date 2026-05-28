# Thrift Flip

A mobile-first dark mode React app for resellers who shop at Goodwill and sell on eBay. Point your phone camera at an item, get an instant flip analysis, and send a draft listing to eBay — without typing more than a few words.

## Stack

- **React 19** + **Vite 8** — no TypeScript
- **Plain CSS** — dark mode only, per-component CSS files
- **Fetch API** — all webhook calls, no axios
- **React state only** — no Redux or external state library
- **Vercel** — deployment target

## Screens

| Screen | What it does |
|---|---|
| Shopping | Photo + details → AI flip analysis (verdict, sell velocity, chat) |
| Cart | Holds analyzed items with profit summaries |
| Listing | Editable eBay draft with AI-generated title and description |

## Getting Started

```bash
npm install
npm run dev
```

Copy `.env.local.example` to `.env.local` and set `VITE_N8N_BASE_URL` to your n8n instance URL.

## Backend

The app connects to an n8n workflow via webhooks. All webhook calls are currently mocked in `src/utils/webhooks.js` with `// TODO: replace` comments marking where real endpoints go.

Five webhook endpoints:

| Endpoint | Triggered by |
|---|---|
| `/analyze` | Shopping Mode — photo submitted |
| `/chat` | Shopping Mode — follow-up message sent |
| `/generate-listing` | Cart — Ready to list tapped |
| `/regenerate-field` | Listing Mode — Rewrite / Shorter / More detail |
| `/send-to-ebay` | Listing Mode — Send to eBay drafts |

## Roadmap

- [ ] Wire real Gemini API via n8n analyze webhook
- [ ] Wire SerpApi Google Lens for product identification
- [ ] Wire eBay sold price lookup via SerpApi
- [ ] Wire listing generation to real Gemini call
- [ ] Wire eBay Inventory API for draft creation
- [ ] Add Mercari as a listing platform option
- [ ] Trip history and profit tracking
