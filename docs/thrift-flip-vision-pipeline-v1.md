# Thrift Flip — Vision Pipeline Spec
### Removing Google Lens: direct multimodal analysis → eBay-tailored listing
### Version: 2.0 (file kept at `-v1` for link stability) · Companion to `thrift-flip-nostr-spec-v1.md` and `thrift-flip-ebay-connect-v1.md`
### Repo: `silentius-satoshi/thrift-flip`
### V0 is a one-hour parallel check; V1 runs after the front-end layer is in place (`thrift-flip-plan.md` §6)

---

## 0. Erratum — n8n is dead (applied July 2026)

**This spec was originally written against an n8n proxy on Railway. That component was deleted before it was ever wired, and every reference to it in this document has been corrected in place.** The architecture that replaced it, from `thrift-flip-plan.md` §4:

| Old (do not build) | Current |
|---|---|
| n8n webhook receives photos → calls Gemini | **The client calls Gemini directly.** Google's API serves CORS headers, so a browser page can call it on Dad's own key — no server in the path, which is why the vision layer is the *most* sovereign part of the app |
| n8n env vars hold the Gemini key | **BYOK** — Dad's key, entered once (§2.5), stored client-side |
| n8n holds the SerpApi key (no CORS there) | **A thin stateless edge relay** in the app's own repo: `/api/serpapi/comps.js` on the same Vercel deploy (see `thrift-flip-ebay-connect-v1.md` §3 for the pattern and its rules) |
| NIP-98 auth on the n8n webhooks (old Nostr step N5) | **NIP-98 on the edge relays** — the pattern survived and the host changed, though it is not currently scheduled (nostr §0.2) |

If any line below still reads like a server sits between the phone and Gemini, that line is wrong and this table wins.

**Sequencing note.** `thrift-flip-plan.md` §6.1 is the authority on *when* things exist and outranks this document. Three things it changes here:

- **V0 is a one-hour parallel check, not a gate.** Run it in AI Studio any time before V1 needs a model string; it does not block the front-end work that comes first. Plan §6.2 defines it, scored on the same five core items §7's V1 gate names, so the two tests chain against one baseline.
- **V1 runs after F1 and F2+A**, so the `ui/` component layer, the eBay-dark tokens, the 16px base and the four-tab camera-first shell all exist by the time this spec's UI lands. Everything V1 adds is *composed* from `ui/` — no hand-rolled stylesheets, no interim pencil render, no per-input font-size workaround.
- **The vault is deferred indefinitely** (nostr §0.2), so §2.5's "encrypted under the vault's `STORE_ENC_INFO` key" and its kind-30078 sync describe a state with no date. The key ships plaintext under `storageService` with a risk note. That was accepted for this key on its merits — free tier, one-tap revoke — and remains so; the eBay token got re-opened, this one did not.

---

## 1. The Verdict First

**Google Lens was never the product. It was a workaround for models that couldn't see.** Dad's original workflow — AntiqSnap photo → Google AI mode conversation → listing — already proved the real pipeline: *a vision model looks at the photos and his notes, and reasons about the item directly.* The Lens → SerpApi → public-image-URL chain existed because the 2024-era plan predated cheap, strong native vision.

Killing Lens deletes three components at once:

| Component | Why it existed | Fate |
|---|---|---|
| SerpApi Google Lens engine | Identify the item from a photo | **Deleted** — Gemini 3 Flash sees the photos directly |
| ImgBB | Lens required a *public URL*; couldn't accept uploads | **Deleted** — Gemini accepts inline base64; nothing needs a public URL for analysis |
| The identify→search→synthesize 3-hop chain | Stitch Lens output into a text-only prompt | **Deleted** — one multimodal call does identification + condition read + listing copy |

What Lens's removal does **not** automatically replace: **live sold-price comps.** Lens identification and SerpApi's eBay-sold search were separate SerpApi calls. Identification moves to Gemini; pricing needs its own honest decision (§4).

**And none of it has been tested.** The claim that a vision model can do this on real thrift inventory in real store lighting is the load-bearing assumption of the entire project and has never been checked once — which is why plan §6.2's V0 pass, an hour in AI Studio with no code, is now the next action in the whole plan.

---

## 2. The New Pipeline

```
📱 1–3 photos + Dad's notes (details, condition, Goodwill price)
        │  (base64 inline — photos never leave the request; no image host)
        ▼
🤖 ONE Gemini call — DIRECT from the browser, on Dad's own key
   multimodal, structured output (responseSchema)
   input: images + notes + the existing 3-mode Flip system prompt (updated)
   output: strict JSON — identification, attributes, condition read,
           eBay title/description/specifics/category, price estimate + confidence
        ▼
💰 Comps provider (pluggable — §4): tightens the price estimate
   tier 0 (his own sold history) is a local lookup; tiers A/B route through
   /api/serpapi/comps.js and /api/ebay/proxy.js (neither vendor serves CORS);
   tier C is the model's own estimate and needs no network hop at all
        ▼
📱 Verdict card + Flip conversation (unchanged UX)
```

Chat mode and listing generation (`GENERATE_LISTING_NOW`) are the same direct client call with the same system prompt — Gemini keeps the images in context across the conversation, which is strictly better than today's design where only Lens ever saw the photo.

> **Photo storage caveat, live at V1.** Those 1–3 photos per item are stored as base64 in localStorage today, against a ~5MB cap that has never been stressed because no real trip has ever run. The fix — moving shopping photos to IndexedDB — was bundled into Nostr N4, which is now deferred. Plan §6.1 requires a downscale-and-cap guard in S1 before the first trip. Do not let V1 increase per-item photo count or resolution without accounting for it.

---

## 2.5 BYOK Onboarding — the ninety seconds, specced

The pipeline runs on Dad's own Gemini key, entered once. This section exists because "go get an API key" is where non-technical users quit — so the flow is designed to be walked, not read, and the app must be fully useful before the key exists.

**Vocabulary rule:** the string "API key" never appears in the UI. It is **"your AI key"** everywhere, with the standing explanation: *Verdicts run on your key, straight from this phone, no middleman.*

> **This flow needs a Settings screen, and there isn't one.** The repo has no Settings surface at all (plan §3, §3.1). V1 therefore builds the Settings screen *and* the key-detail sub-screen described below, both **composed from `ui/` components** (`Row`, `Field`, `Button`, `StatusTag` — the layer exists by then) and both joining the lazy-init + persist pattern or a refresh ejects him mid-flow (plan §8). Settings sits behind a **header entry point, not a sixth tab** — the shell is four tabs by V1. Budget V1 accordingly; plan §6.1 sizes it.

### The flow (Your keys → Verdicts → Add your AI key)

1. **"Open Google's key page"** — a button deep-linking to https://aistudio.google.com/apikey. One line above it: *Sign in with your normal Gmail, tap Create API key, tap Copy, then come back here.* No other instructions.
2. **Paste field** — a `ui/` `Input`, `autocomplete="off"`, paste-button beside it (iOS clipboard prompt handles permission). No font-size workaround needed: F1 raised the base to 16px long before this ships, which is what the iOS focus-zoom rule requires.
3. **Verification call** — on paste, the app immediately fires a minimal live request (`"Reply with OK"`, `maxOutputTokens: 5`) against the configured model.
   - Success → **"Connected — verdicts are live"** with a green check; the key is stored (below) and the raw string never shown again.
   - Failure → specific errors, never generic: invalid key ("That key didn't work — check the paste caught the whole thing"), quota/billing ("Key works but Google says it's out of free calls today"), network ("No signal — I'll verify when you're back online" and queue it).
4. **Done state** — the Verdicts row thereafter shows `Gemini · ••••` + last-4 + "runs on your key," with a detail screen offering **Test key**, **Replace key**, and **Revoke help** (one line + link: *revoke any key in seconds at aistudio.google.com/apikey*).
   - **While the key is plaintext (i.e. now, and until a vault ships):** that detail screen also carries the one-line risk note required by plan §6.1 — *"Stored on this phone. Anyone who can unlock your phone can read it — revoke it in seconds at the link below if that ever happens."* It is deleted in the same commit that moves the key into a vault.

### Storage & sync

**The design:** the key is encrypted under the vault's `STORE_ENC_INFO` AES key (nostr §5.2) — same Face ID unlock, cryptographically separate from the identity key — and synced across devices inside a kind-30078 event (`d: thrift-flip:ai-key`, NIP-44 to self). Second device: Face ID → key arrives → verdicts work, nothing to re-enter.

**What ships:** the vault is Nostr N1 and the sync engine N2–N3, all deferred with no date (nostr §0.2). The key is written through `storageService` in plaintext with a `// TODO: migrate to vault STORE_ENC_INFO` marker at the write site, paired with the risk note above. **The "never in logs or error messages" half of the rule applies from day one** — it costs nothing and is the half that leaks in practice. One more rule the deferral adds: **the S1 JSON export must exclude this key**, or "Download everything" writes it in the clear into his Files app, which is worse than where it already is (plan §6.1).

**Honest threat note (document, don't hide):** a key used from a browser app is readable by the phone's owner via DevTools. That is acceptable by design — it is *his* key on *his* phone; a vault would protect it from a thief, not from himself. Worst-case leak = someone else's free-tier Gemini calls, fixed by one-tap revoke. **That reasoning is why this key stays plaintext under the deferral while the eBay refresh token's equivalent decision was re-opened** (plan §6.1): an ~18-month token to his selling account is not the same object.

### Non-blocking by architecture

Onboarding never gates on the key. The pencil tag (on-device break-even math) works with zero keys from first launch; the stamped verdict is what the key unlocks. Until a key exists, the verdict screen shows one quiet card — **"Add your AI key to get stamped verdicts"** → deep-links to the flow above — dismissible per session, never a wall. Expected reality: the key gets set up once, together, the same afternoon the app is installed; the flow exists so a new phone or a revoked key can be recovered solo.

> **The pencil tag is a real V1 dependency, and it was originally scheduled last.** The break-even arithmetic and the pencil verdict were A-track work (frontend v2 §10), after everything else, while this section and the V1 gate both assume the tag works from first launch. **Resolved in plan §6.1, and the two halves land in different steps:** F2+A builds the render — `VerdictBanner variant="pencil"` plus the earnings `Panel`, data-driven against a stub — and **V1 supplies the arithmetic** in `src/utils/calculations.js`, which today holds only the forward math (`calcProfit`, `checkRules`) and gets its first unit tests here. The derived formula and the `$46.50` worked example live in plan §6.1; note the example assumes `shipping = 12`, not `calcProfit`'s `5.00` default.

### Completion gate (rides with V1)

Fresh install, no key → pencil tag works end-to-end. Add key via the deep-link flow → verification call round-trips → stamped verdict appears on the next analysis. Kill the key in AI Studio → next analysis shows the specific invalid-key error and the pencil tag still renders. Settings and the key detail sub-screen both survive a refresh (the persistence trap, plan §8). *(A fifth check — second device via word-import shows the key with no re-entry — needs the vault and sync engine and is now unscheduled; it is the same unrun test as nostr §13's N3 gate and eBay §8's E4 sync half. Do not record it as passed.)*

---

## 3. Model Choice (verified July 2026)

Gemini 2.0 models were shut down June 1, 2026 — anything in old notes pointing at a **2.0-era** string must not ship. (2.5 Flash-Lite is a live, separate family and is fine.) Current options:

| Model | Input / Output per 1M tokens | Vision | Fit |
|---|---|---|---|
| **`gemini-3-flash-preview`** | **$0.25 / $1.50** | ✅ | **Default.** Strong ID + copywriting, 1M context, fast |
| `gemini-2.5-flash-lite` | $0.10 / $0.40 | ✅ | Budget tier / high-volume fallback |
| `gemini-3.6-flash` | $1.50 / $7.50 | ✅ | Quality tier for hard antiques; released July 21, 2026 |
| Gemini 3.x Pro | $2.00+ / $12.00+ | ✅ | Overkill — not used |

**Free tier reality (changed April 2026):** AI Studio free access is now Flash/Flash-Lite only, ~1,500 requests/day on Flash models, Pro is paid-only. 1,500 RPD still covers every realistic Goodwill trip for $0. Keep the model id in **one client-side config constant** (`src/config/gemini.js`) so tiering is a one-line change, and route "rare/antique" escalations (Flip conversation asks for a second opinion) to 3.6-flash.

**Cost per full item** (3 photos ≈ 1,700–2,500 img tokens + prompt + ~800 out): ≈ **$0.002–0.004** on 3-flash. A 20-item trip costs under a dime, before the free tier makes it $0.

> **Amend this section from V0's findings before V1 is written** (plan §6.2, §9.2). V0 scores real thrift inventory against the default model and, critically, tests *calibration* — whether `confidence: high` is actually more accurate than `confidence: low`. If the default underperforms, the fix lands here: promote `gemini-3.6-flash`, tighten the escalation rule, or add capture guidance to the UI.

---

## 4. The Sold-Comps Decision (the honest part)

Identification is solved. Pricing has four rungs, because eBay's own sold-data API — Marketplace Insights — is **Limited Release**, and small developers are routinely denied access (the community threads are a graveyard of "denied"). Do not architect around getting it.

| Provider | Data quality | Cost | Status |
|---|---|---|---|
| **0. His own sold history** | The only comps that are *his* — same item, same photos, same buyer pool, actual realized price | $0 | **Ranked first when a match exists.** Populated by the eBay inbound pull (`thrift-flip-ebay-connect-v1.md` §7), which writes to the `thrift-flip-sold-history` store keyed by item id. Empty until E3, so it is a rung that *fills in over time*, not one that blocks |
| **A. SerpApi — eBay engine only** (`LH_Sold=1`) | Real sold prices, the gold standard for flips | 100 free searches/mo, then $25/mo | **The default rung for a new item.** Keep the *eBay* engine; only the *Lens* engine dies. 1 credit per item instead of 2 → free tier now covers 100 items/mo |
| B. eBay Browse API (official, free) | *Active* listings only — asking prices, not sold | Free, standard developer keys | Fallback + always-on supplement (competition count feeds Sell Velocity) |
| C. Gemini estimate + confidence band | Model knowledge; decent on branded goods, weak on obscure | ~$0 | Always present as the floor; verdict shows `confidence: low` and links Dad to eBay's sold filter for 10 seconds of manual truth |

**Architecture:** a `compsProvider` interface — `getComps(query) → { source, samples[], median, sellThrough? }` — with **0→A→B→C** fallback and the source labeled on the verdict card (`"You sold one for $58 in March"` > `"12 sold in 30 days · via eBay sold data"` > `"model estimate — verify before big buys"`). Tier 0 is a local lookup over `thrift-flip-sold-history` and needs no network; tiers A and B call out through the `/api/serpapi/comps.js` and `/api/ebay/proxy.js` edge relays (neither vendor serves CORS); tier C is already in hand from the Gemini response. Dad's 3×/$20 rule math stays in the client, unchanged, fed by whichever comps arrived.

**At V1 only tier C exists**, which is the point of V1 — get a real verdict on the phone and find out whether the model's own estimate is good enough to shop with, before spending on comps infrastructure. T1 (plan §6.3) is what answers that.

---

## 5. Structured Output — kill the regex janitor

Today's design has Gemini return prose-wrapped JSON and a scrubbing step stripping backticks. Replace with Gemini's native structured output — `responseMimeType: "application/json"` + `responseSchema` — which guarantees parseable JSON. **This is the schema V0 runs against in AI Studio** (plan §6.2) — use it verbatim there, not an ad-hoc prompt, or V0 tests something V1 won't ship.

```jsonc
// analyze response schema (abridged — full schema in src/config/schema.js)
{
  "identification": {
    "name": "string",            // "Nike Air Max 90, White/Red"
    "brand": "string|null",
    "model": "string|null",
    "era": "string|null",
    "category_path": "string",   // eBay taxonomy path
    "confidence": "high|medium|low",
    "clarifying_question": "string|null"   // only when confidence=low
  },
  "condition_read": {
    "grade": "New|Like New|Good|Acceptable|For Parts",
    "visible_flaws": ["string"],           // seen in photos — Dad confirms, not retypes
    "notes_conflicts": "string|null"       // photo contradicts Dad's notes → surface it
  },
  "listing": {
    "title": "string",                      // ≤80 chars, brand-first, no filler
    "description_html": "string",
    "item_specifics": { "Brand": "", "Size": "", "Color": "", "Material": "", "MPN": "" },
    "condition_description": "string"
  },
  "listing_mercari": {                      // V1.5 — same facts, Mercari's register
    "title": "string",                      // ≤80 chars, casual, keyword-front
    "description": "string",                // plain text, shorter, first-person OK
    "hashtags": ["string"],                 // 3–5, e.g. "#Pendleton #woolblanket"
    "suggested_price": 0                    // Mercari skews lower; round to $x9/$x5
  },
  "pricing": {
    "estimate": 0, "range_low": 0, "range_high": 0,
    "confidence": "high|medium|low",
    "rationale": "string"
  },
  "strategy": { "platform": "eBay|Mercari|FB Marketplace", "format": "fixed|auction",
                "rarity_flag": false, "timing_note": "string" }
}
```

The existing three-mode Flip system prompt survives nearly intact — Mode 1 gains "you can SEE the photos; read condition from them and reconcile with the user's notes," Mode 3's "return ONLY raw JSON, no markdown" paragraph is deleted (the schema enforces it), and the sold-comps block is injected **by the client** from `compsProvider` output rather than asked of the model.

---

## 6. What Changes Where

| Layer | Change | Step |
|---|---|---|
| `src/utils/webhooks.js` | Mocks → **direct `fetch` to `generativelanguage.googleapis.com`** with the user's key, base64 photos in body (existing `fileToBase64` output reused as-is). The file's name outlives its webhook origin; rename to `src/utils/ai.js` when convenient | V1 |
| `src/hooks/useGemini.js` | Currently throws — becomes the real analyze/chat/generate-listing surface: build request → structured call → merge comps → return | V1 |
| `src/utils/calculations.js` | Gains the pencil floor: invert the 3×/$20 rule to "what must it sell for?" — pure arithmetic, no network, no key. **Plus its first unit tests** (plan §6.1) | V1 |
| **New: Settings screen + AI-key detail sub-screen** | The BYOK flow has nowhere to live today (§2.5). Both join the persistence pattern | V1 |
| `/api/serpapi/comps.js` | New thin edge relay: holds `SERPAPI_KEY` as an env var, adds CORS, stores nothing. Same rules as `thrift-flip-ebay-connect-v1.md` §3 | V2 |
| ImgBB account | Decommission — nothing needs a public analysis URL. **Listing photos for eBay were to travel via Blossom (Nostr N4), which is now deferred indefinitely — so the eBay picture path is an open question, not a solved one; see `thrift-flip-ebay-connect-v1.md` §6 and amend this row with whatever it settles** | V4 |
| Client verdict UI | Comps `source` chip + confidence tint on the price row | V2 |
| Cost table in README | SerpApi line halves (1 credit/item); ImgBB line deleted; n8n/Railway line deleted | V4 |

---

## 7. Build Order

*(Position in the overall sequence: V0 runs in parallel any time before V1; V1+S1 come after F1 and F2+A; V1.5/E0 after F3/F4; V2–V4 after E1–E2. Calibration with Dad happens after the whole build. See `thrift-flip-plan.md` §6.)*

**V0 — Model check, no code (about an hour, runs in parallel).** Defined in plan §6.2: 10–15 real thrift items through AI Studio on the §5 schema and the real system prompt, scoring identification, price, and calibration. A good result is **≥4 of the 5 core items** (sneaker, book, tool, mug, vintage electronics) correct on brand+model, defensible price ranges, and confidence that tracks accuracy. It is not a gate — a poor result amends §3 (default model, escalation rule, capture guidance) before V1 hardcodes any of it.

**V1 — Real analyze, model-only pricing, the pencil arithmetic, and the Settings surface.** Runs after F1 and F2+A, so it composes from `ui/` and the pencil banner already exists. Gemini structured call wired end-to-end **direct from the client**, comps = tier C only. Plus the pencil math in `calculations.js`, Vitest and its first specs, and the §2.5 Settings + key-detail screens. Gate: **the same 5 core items from V0, re-shot through the app**, ≥4 correct brand+model — V0 tested the model, this tests the wiring against a known baseline; JSON parses with zero cleanup code anywhere in the path; the §2.5 no-key gate holds end-to-end; and both new screens survive a refresh.

**V1.5 — Marketplace variants + the Vendoo handoff (an hour, rides on V1's code; scheduled after F3/F4).** Add `listing_mercari` to the responseSchema (one schema block, zero new dependencies — the same call now returns both registers). Client: a "Copy for Mercari" button on the generated listing that copies title + description + hashtags and deep-links to the Mercari app; ListingMode shows which variant is on the clipboard. Document the distribution path in the README: **Send to eBay (our API, one tap) → Vendoo imports the eBay listing → Vendoo's automation crosslists to Mercari/Poshmark/FB.** We never build marketplace automation ourselves — eBay is the API-real spine, Vendoo is an optional fan-out that our listing quality feeds, and the copy-assist covers the no-Vendoo case. Running it after T1 means the listing half gets built against items he actually bought. Gate: analyze one item → both listings present in one response; Copy for Mercari pastes cleanly into the Mercari app's form. *(The third original check — "the eBay draft created by Send-to-eBay appears in Vendoo's import screen untouched" — needs API draft creation, which is E2. It runs as part of E2's gate; at V1.5 the only eBay lane is E0's clipboard.)*

**V2 — Comps provider (after E1–E2, since it rides on the same edge-relay pattern).** SerpApi eBay engine behind `/api/serpapi/comps.js` + Browse API fallback + source chip; the tier-0 personal-history lookup is wired against `thrift-flip-sold-history` and returns empty until E3 fills it. Gate: analyze a common item → verdict shows real sold median labeled "via eBay sold data"; kill the SerpApi key → falls to **B**, showing Browse actives labeled as asking prices, not sold; kill Browse too → labeled model estimate. No error state at any rung.

**V3 — Conversation + listing gen on the same direct call.** Chat and `GENERATE_LISTING_NOW` migrated; photos persist in conversation context. Gate: "does the scuff on the left toe change your grade?" → the model's answer references the actual photo content; generated listing's item_specifics are real values, not "See description."

**V4 — Decommission.** ImgBB key revoked, README + Gemini prompt doc updated. Gate: `grep -rn "imgbb\|google_lens\|n8n\|railway" src/ api/ README.md` returns nothing. *(Code and README only. The spec docs deliberately keep these strings — §0's erratum table, plan §5's superseded list, and the Railway personal-relay option in nostr §13 N6.)*

---

## 8. Out of Scope

- **eBay taxonomy/category-ID resolution** — belongs to the Send-to-eBay integration spec (Taxonomy API `getCategorySuggestions` at listing time)
- **On-device vision models** — revisit if privacy demands photos never hit a third party; today the tradeoff isn't worth the quality loss (and with the direct-to-Google call, no *intermediate* party sees them at all)
- **Marketplace Insights API application** — apply opportunistically for the future subscription product; never a dependency
- **Background removal / photo enhancement** — deliberate earlier product decision to keep real photos; unchanged
- **Marketplace crosslisting automation** (Mercari/Poshmark/FB form-filling robots) — permanently out. No public APIs exist there; maintaining browser automation against DOM changes is Vendoo's full-time business, not a feature. Our answer is V1.5's three-lane distribution: eBay API → Vendoo import → copy-assist
