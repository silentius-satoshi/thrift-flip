# Thrift Flip — Master Plan & Session Handoff
### The entry-point document. Read this first; the four companion specs, the build prompt, and the prototype carry the detail.
### Repo: `silentius-satoshi/thrift-flip` · verified at commit `b22906b` · July 2026
### Build order resequenced July 2026 — validate, ship, and go to the store before refactoring (§6, §6.1)

---

## 1. What This Is

**Thrift Flip** is a mobile-first React PWA built for one user — "Dad," a Goodwill reseller who flips items on eBay. It answers two questions: *should I buy this item, standing in the aisle?* and *turn it into a listing with minimal typing.* House rules baked into all math: an item must sell for **3× purchase price AND net ≥ $20 profit** after eBay fees (13.25% + $0.30) and shipping (~$5–12).

Long-term it becomes a sovereign, subscription-ready product (Bitcoin/Lightning payments, hosted-convenience paid tier), but every near-term decision serves Dad's daily use first.

## 2. Document Inventory

| File | Role | Status |
|---|---|---|
| `thrift-flip-plan.md` | This file — orientation, workflow, build order. **§6.1 is the authority on cross-track sequencing;** where a spec's storage or gate language disagrees with it, §6.1 wins | **Current** |
| `thrift-flip-frontend-spec-v2.md` | eBay-dark design language + the `ui/` component layer | **Current** (supersedes v1 paper-tag direction) — §3, §4, §6, §8, §10 amended July 2026 for the resequencing |
| `thrift-flip-vision-pipeline-v1.md` | Photo → identify → listing via direct Gemini BYOK; comps ladder; §2.5 BYOK onboarding; V1.5 Mercari/Vendoo | **Current** — §0 erratum applied July 2026 (n8n references retired) |
| `thrift-flip-nostr-spec-v1.md` | Identity (Face ID/PRF + 12 words), encrypted relay storage, Blossom media | **Current but DEFERRED** — §0 erratum + deferral note applied July 2026; see §6.1 |
| `thrift-flip-ebay-connect-v1.md` | eBay OAuth, thin edge relays, drafts out / sold data in | **Current** — **developer account is APPROVED** ✅, §0 corrected |
| `claude-code-prompt-F1.md` | The F1 build prompt | **Valid as written and NEXT.** F1 runs first again, against `b22906b` exactly — the staleness warning in its header no longer applies and has been removed (§6.1) |
| `thrift-flip-design-v3-1-ebay.html` | Interactive reference prototype (10 screens, eBay dark) | **Current visual reference** |
| frontend-spec-v1, design-v2.html, design-v3.html | Earlier directions | Superseded — do not use |

## 3. Repo State (what exists at `b22906b`)

React 19 + Vite 8, **zero other dependencies**, ~2,800 LOC, plain CSS per component, deployed target Vercel (390px centered column, dark only).

- **Screens (5 tabs + 2 sub-screens):** ShoppingMode (form → verdict w/ VerdictCard, SellVelocity, floating chat bubble), FlipMode (Signal-style conversation list + iMessage chat), CartMode (conflict modal), ListingMode (editor, save-draft bottom sheet, Drafts/✕ header), PreviewMode, DraftsMode, HistoryMode (trip stats, double-tap delete). Nav in `Nav.jsx`. **There is no Settings screen — V1 builds the first one (§6.1).**
- **State/persistence:** everything in localStorage behind `src/utils/storageService.js` (async API; the seam built deliberately for the Nostr layer). Screen, sub-view, form, verdict, listing edits, cart, conversations, drafts, history all persist across refresh. Pattern: lazy `useState` initializers do direct sync reads, marked `// Direct read — sync required for useState lazy init`. **Photos are base64 in localStorage** — see the quota warning in §6.1.
- **Stubs awaiting the specs:** `webhooks.js` (5 mocked endpoints, `// TODO: replace`), `useGemini.js` (throws), `UserContext` (hardcoded `local-user-001`, shaped for replacement).
- **Not in the repo:** no AI calls, no eBay calls, no Nostr, no Settings screen, no `docs/` (added July 2026), no `api/`, old generic dark theme still in place.

**§3.1 — Verified directly against the working tree (July 2026).** Everything above was previously secondhand; these specific facts have now been read out of the repo itself and can be cited in build prompts without re-checking:

- **Base font is `15px`** — `src/index.css` line 41. The iOS focus-zoom rule in §8 is real and currently violated by default.
- **`index.html` viewport is `width=device-width, initial-scale=1.0`** — no `viewport-fit=cover`, no `theme-color`. S1 adds both.
- **The screen array is exactly** `['shop', 'flip', 'cart', 'listing', 'history', 'drafts']` — `App.jsx` line 22, with `'preview'` deliberately excluded and redirected to `'listing'` on line 23. Anything adding a screen edits this line.
- **Dependencies are `react@^19.2.6` + `react-dom@^19.2.6` and nothing else.** Dev deps are eslint/vite only.
- **There is no test runner at all** — `package.json` has no `test` script and no vitest/jest. See the V1 scope note in §6.1; "add a unit test" currently means "add a test framework first."
- **`src/utils/calculations.js` is 11 lines**: `calcProfit(sellPrice, goodwillPrice, shipping = 5.00)` returning `{ ebayFee, net }`, and `checkRules(sellPrice, goodwillPrice, profit)` returning `{ rule1, rule2, verdict }`. **Note `verdict` is the string `'buy'` or `'skip'`** — the design specs use `'go' | 'skip' | 'pencil'`, so F2 needs an explicit mapping rather than passing it through.
- **`ShoppingMode.css` line targets in the F1 prompt are accurate**: 35 (`min-height: calc(100dvh - 80px)`), 61 (`padding: 12px 16px 130px`), 72 (`bottom: 60px`), 87 (`.verdict-chat-bubble` — the prompt says ~89). The documented false positives are real too: lines 128/129 and 155/156 are `width`/`height: 80px` photo thumbs, not layout constants.
- **`App.jsx` line 134 contains an emoji in a toast string** (`'Current listing saved as draft 🔖'`) — F3's "no emoji in `src/`" sweep has at least this one live target.

**The honest summary of the state:** it is a complete, well-persisted shell that knows nothing. Every screen works and no screen is right yet, because nothing real has passed through it. That fact drives §6.

## 4. The Architecture (five pillars, and why)

1. **Sovereign by default.** No server ever stores user data. Client calls Gemini **directly** (their API supports browser CORS) on *Dad's own key*. Where a vendor blocks browsers (eBay, SerpApi send no CORS headers; eBay's token exchange needs the client secret), the answer is **thin stateless edge relays in the app's own repo** (`/api/ebay/*`, `/api/serpapi/*` on the same Vercel deploy) — they hold secrets as env vars, verify NIP-98 signed requests, and store nothing. Precedent: Personal-BLOC's own `api/strike-*.js`.
2. **Identity = a key, not an account.** Nostr Mode C: 128-bit entropy → 12 BIP-39 words → NIP-06 key. At rest: AES-GCM ciphertext whose key material comes from **WebAuthn PRF (Face ID)** — the biometric *produces* the decryption key, it doesn't gate a lookup — with a PIN/PBKDF2 fallback. A freshly generated key **refuses to sync until a 2-word backup quiz passes** (the backup gate). App data syncs as NIP-44-encrypted kind-30078 events to 3 public relays; listing photos to Blossom; shopping photos never leave the device. *This pillar is the subscription product's foundation, not Dad's — see §6.1.*
3. **Vision = one multimodal call.** Photos + notes → Gemini structured output (identification, condition, eBay listing fields, price + confidence, Mercari variant). Pricing truth comes from a labeled ladder: *his own sold history* → SerpApi eBay-sold search → eBay Browse actives → model estimate with a "verify on eBay" link (vision §4, tiers 0→A→B→C). The offline floor is the **pencil verdict**: pure on-device arithmetic inverting the question to "what must it sell for?" ($46.50-style floor) — the app is useful with zero network, zero keys.
4. **eBay = the one real integration.** OAuth "Connect eBay" (tokens at rest per §6.1, ~18-month refresh), outbound one-tap *drafts* (never auto-publish by default), inbound sold orders + views/watchers feeding the Selling tab and the personal-comps flywheel. Floor: E0 copy-assist. Crosslisting to Mercari/Poshmark is **permanently out** — that's Vendoo's business; we feed it via the eBay listing it imports.
5. **Frontend = eBay's language, our skeleton.** Dark eBay grammar (pill buttons, bold prices, red sold-counts, Seller-Hub "Your earnings" panel as the verdict's money table) built as a 14-component `ui/` layer replacing 13 hand-rolled stylesheets. eBay's *marketplace-browser IA is explicitly rejected* — this is a decision instrument. Conventions borrowed, marks never (no eBay logo/wordmark/"Buy It Now" verbatim).

## 5. Superseded Decisions — do not resurrect

n8n on Railway (deleted before ever wired — **the vision and nostr specs were written against it; both now carry a §0 erratum, but treat any surviving "proxy"/"workflow" phrasing in them as the edge relays, never as n8n**) · ImgBB · Google Lens / SerpApi Lens engine · Supabase/Stripe-first subscription plan (payments come later, Lightning/BTCPay-aligned, per the **EH** hosted-tier model — ebay-connect §1) · NIP-49 passphrase unlock (→ PRF) · the paper-tag/warm-graphite theme (frontend v1) · full-screen chat modal on the verdict (→ bubble navigates to the Flip conversation; `previousScreen` handles back) · marketplace form-filling automation · Nostr Step N5 as its own build step (NIP-98 now ships on the edge relays with E1) · pencil-verdict math as A-track work (pulled into V1, §6.1) · **the validate-ship-observe sequencing** (V0 as a gate, V1 ahead of F1, the trip as a mid-build step — adopted and then superseded within the same July 2026 session once the Founder chose to build the whole app before calibrating; V0 survives as a one-hour parallel input, §6.2) · **the five-tab intermediate migration** (F4-migrates-then-A-track-restructures; the build now targets the v3.1 four-tab camera-first structure directly and never constructs the intermediate, §6) · any assumption the eBay dev account is missing (it is approved).

## 6. Build Order & Status

**The organizing principle (Founder decision, July 2026): build the whole app, then calibrate it on real trips.** Dad does not use it mid-build, so the order below is no longer optimised for getting value onto his phone early. It is optimised for **the least total rework** — build the shared layer first, build straight to the final structure, and let every later step assemble rather than migrate.

| Step | What | Status |
|---|---|---|
| — | Full 5-tab UI, storage abstraction, drafts/history/persistence | ✅ Done (`b22906b`) |
| ~~V0~~ | Model check in AI Studio | **Skipped — answered by real-world use** (§6.2). Default model: `gemini-3.6-flash`. Its two remaining checks (anchoring, confidence calibration) moved into V1's verification |
| **F1** | Tokens + `ui/` component layer + layout system + UIKitchen gate | ✅ **Done** (`839fd79`) — post-commit review passed: alias coverage exact, centering pattern on all fixed elements, FlipMode sibling fixed, zero touches outside the plan's file list |
| **F2 + A** | **One step.** Verdict rebuilt **and** the v3.1 four-tab camera-first shell | ✅ **Done** (`223b8aa`) — review passed: reqSeq guards placed as planned, untouchables clean, UIKitchen amendment honored |
| **V1 (+§2.5) + S1** | Real Gemini analyze (3.6-flash, BYOK, structured output), Settings + AI-key screens, real pencil math + Vitest, PWA manifest/icons, JSON export+import, photo-quota guard | ✅ **Done** (`cbebe5e`) — review passed. **Live gates unrun**: `docs/v1-live-check-runbook.md` (5 core items, anchoring, calibration) |
| **H1** | **Live-check harness** (`scripts/live-check.mjs`): automated ID scoring on labeled fixtures, anchoring test, calibration table, SerpApi sold-median ground truth, **grounded-vs-ungrounded pricing experiment** — the data that decides whether Google Search grounding replaces SerpApi as comps tier A | **NEXT — prompt ready** (`claude-code-prompt-H1.md`) |
| **S1** | PWA manifest + icon + `standalone` + `viewport-fit=cover`; **JSON export *and* import**, credential keys excluded; photo-quota guard | With V1 |
| F3 | Chrome: frosted nav/bars, History→Selling rename, emoji→SVG, focus rings | After V1/S1 |
| F4 | Migrate the remaining screens onto `ui/` — Flip, Cart, Listing, Drafts, Selling, Preview, Chat; delete legacy aliases | After F3 |
| V1.5 / E0 | Mercari variant + Copy-for-eBay/Mercari + Vendoo lane documented | ✅ **Done** (`e00fe16`) — cart-boundary fix landed, mock now fallback-only |
| N1-lite → E1 → E2 → V3 → E3 → E4+V4 | Vault, sandbox OAuth, real drafts, real chat + photo store, inbound flywheel + comps tier 0, lifecycle + decommission | ✅ **All done** — final commit `006fc7e`. **THE BUILD IS COMPLETE**: zero mocks, seven standing gates green, every step plan-reviewed and post-commit-reviewed |
| **LIVE PHASE** | Runbook §10's nine founder-run checks + the H1 harness run + Dad's first trips (§6.3) | **NEXT — deliberately no Claude Code prompt.** V2 is the only unwritten code and it waits on H1's data by decision |
| E1–E2 | eBay OAuth connect (sandbox→prod), deletion endpoint, outbound drafts. **Credential-at-rest decision required first** (§6.1) | Config unblocked now; code after V1.5/E0 |
| V2–V4 | Comps provider on `/api/serpapi/comps.js` + Browse fallback + source chip; chat & listing-gen on the direct call; ImgBB decommission | After E1–E2 |
| E3–E4 | Inbound sold/traffic → Selling + comps flywheel (fills tier 0); token lifecycle | After V2–V4 |
| **Calibration** | **Dad, real trips, repeatedly.** The recording protocol and what counts as success: §6.3 | After the build |
| N1–N4, N6 | Identity vault, NostrStore, sync engine, Blossom, relay mgmt | **Deferred — gated on the subscription product, not on Dad** (§6.1) |
| ~~F5~~ | PWA | Absorbed into S1 |
| ~~A-track~~ | Camera-first Buy, 4-tab consolidation | Merged into **F2+A**; no longer a separate gated step |

Recommended sequence (amended after the grounding insight — Dad's Gemini-app workflow is search-grounded, so the app's benchmark is *his current tool*, not "no tool"): **F1 → F2+A → V1+S1 → H1 → grounding decision → F3 → F4 → V1.5/E0 → V3 (real chat — pulled ahead of the E-track: his workflow is conversational, and mock chat sends him back to the Gemini app mid-aisle) → E1–E2 → V2 (shrunk to tier-0 + Browse if grounding wins; SerpApi cancelled) → V4 → E3–E4 → calibrate on real trips → N-track when the business case arrives.**

Off the critical path, do any time: create the sandbox test user, configure the RuName redirect, and stand up the account-deletion endpoint (ebay-connect §2 steps 3, 5–6 and §4). About an hour, blocks nothing, and E1 starts cold without it.

### 6.1 Why this order, and the seams it creates

**This section outranks the companion specs wherever they disagree about *when* something exists.** Each spec was written as if its own track ran first; this is where the interleaving is reconciled.

**How this order was arrived at, and why it flipped twice.** Ordering was always a function of one question — *when does Dad start using it?* An earlier pass put V1 ahead of F1 and inserted a mid-build trip, on the reasoning that a working decision instrument on his phone weeks earlier was worth some rework. The Founder then decided to **build the whole app before handing it over**, which removes that premise entirely: nobody is using it early, so "value on his phone sooner" buys nothing, and the ordering should minimise rework instead. That is what the table above does. Two consequences worth stating plainly, because they reverse earlier text in these documents:

- **F1 goes first again**, and this deletes four seams the interim ordering had created: no hand-rolled pencil render on `VerdictCard` for F2 to delete, no bespoke Settings CSS for F4 to migrate, no explicit-16px workaround for the 15px base (F1 raises it), and no `--t-hero` hardcoding. It also means **`claude-code-prompt-F1.md` is valid exactly as written against `b22906b`** — nothing has moved underneath it, and its re-verification warning has been removed.
- **The five-tab intermediate is never built.** The original plan had F4 migrate five screens onto the component layer and *then* the A-track restructure them into four with a camera-first Buy. Since the destination is already decided — the v3.1 prototype is the reference and camera-first is the direction — F2+A builds the four-tab shell straight from F1's components, and F4 migrates the remaining screens into a structure that has already settled. One migration, not two, and one fewer approval gate.

**Why V0 was skipped (Founder decision, July 2026).** V0 existed to answer one question — can a vision model identify thrift inventory from phone photos, and which model — and the answer arrived from a better source than a staged test: **Dad already uses Gemini 3.6 Flash manually on real items and it identifies them well.** That is the identification test, run repeatedly under real conditions. Consequence: **`gemini-3.6-flash` is the default model**, not the quality-escalation tier — see §6.2 for the cost math (still pennies per trip) and for the two checks V0 covered that daily use does not, both of which now ride with V1's verification instead of being dropped.

**Why the trip moved to the end.** A half-built app produces half-signal. "The form is too much typing standing up" is not a discovery that needs a Saturday — it is already the conclusion that produced the camera-first v3.1 prototype. And the measurement that actually matters, the ninety-day sold data that fills comps tier 0 and reveals whether the estimates were any good, is a months-long instrument no amount of upfront sequencing manufactures early. §6.3 keeps the recording protocol; it just runs after the build rather than inside it.

**Why the N-track is deferred.** Its user-facing benefit for Dad is that his business record survives a lost phone; for that, a JSON export/import pair covers the disaster case, and it ships in S1 before the first trip. The vault, PRF unlock, sync engine and relay reconciliation are the most complex, highest-risk work in the project, and their real justification is the sovereign subscription product: portable identity, no accounts, the pubkey that becomes the billing hook. Sequencing them by the product roadmap rather than by Dad's needs is the change; the architecture is unchanged. **But deferring N1 indefinitely has consequences the first draft of this plan waved through — see "what the deferral costs" below.**

**Sizing V1 honestly.** This plan first described V1's UI surface as "a Settings row, a paste screen, and a pencil state." That was wrong: **there is no Settings screen in the repo at all** (§3). V1 therefore builds:

- a **Settings screen** — reachable from a header entry point, **not a sixth tab**, since the shell is four tabs by the time V1 runs; it joins the lazy-init + persist pattern (§8) or refresh will eject him;
- a **"Your keys" section** with the Verdicts row, plus an **AI-key detail sub-screen** (Test / Replace / Revoke help, and the interim risk note) — a second new sub-view, with its own persistence trap (§8);
- the BYOK paste flow, the direct-Gemini call and schema wiring;
- the pencil arithmetic in `calculations.js` (formula below), feeding the `VerdictBanner variant="pencil"` that F2+A already built;
- Vitest plus specs on `calculations.js`.

Because F1 and F2+A run first, both new screens are **composed from `ui/` components** — `Row`, `Field`, `Button`, `StatusTag` — with no bespoke stylesheets, so F4 has nothing extra to migrate and the pencil needs no interim render. That is the single biggest saving from the reordering: under the earlier sequence these two screens were hand-rolled first and migrated later.

**What V1 must not do.** With F1 and F2+A already in, V1 composes from `ui/` and adds **no screen-level CSS for buttons, cards, inputs, or money rows** — frontend v2 §4's grep rule is live from F1 onward, and V1's screens are the first ones written under it rather than migrated into it. If a V1 plan proposes a new stylesheet with a `border-radius` on an interactive element, that is the tell. Inputs also need no explicit `font-size` workaround: F1 raised the base from 15px to 16px (§3.1), which is what the workaround existed for.

**What the deferral costs — read this before E1.** With N1 unscheduled, four things that were framed as temporary are now open-ended, and they were sized against a horizon that no longer exists:

- **The eBay refresh token is the live one, and it is a re-opened decision (see below).**
- **Three completion gates have no date.** E1's real ciphertext gate, vision §2.5's second-device key check, and nostr §13's N1 gate 5 (both its ciphertext half and its NIP-98 half) all now sit unrun indefinitely. Do not let a build summary claim them as passed.
- **NIP-98 never arrives, so the relays keep the bearer-secret speed bump.** Nostr §8's "NIP-98 prevents using the relay to impersonate" describes a mitigation that will not ship on this timeline. The honest posture: the relays are gated against strangers, not against a determined attacker with the client bundle, and `oauth.js`'s blast radius is the eBay app credentials, which are rotatable from the dashboard.
- **Shopping photos stay base64 in localStorage.** Nostr N4 was going to move them to IndexedDB and "remove the base64-in-localStorage quota dance entirely." N4 is deferred and **T1 — a full trip, 1–3 photos per item — is the first thing that will ever stress it.** localStorage caps around 5MB; a dozen items at three photos each will hit it, mid-aisle, as a write failure. **S1 must ship a guard**: downscale on capture, cap the retained shopping photos, and fail loudly and recoverably rather than silently losing a verdict. Moving shopping photos to IndexedDB does not actually require Nostr — it is the local half of N4 and can be lifted out if the guard proves insufficient.

**✅ DECIDED (Founder, July 2026): Option 1 — N1-lite vault, built as its own step before E1.** E2's photo path is also decided: **photo-less drafts**, Dad adds photos in Seller Hub where he already reviews (ebay §6 amended). Original decision record kept below for the reasoning trail.

**🔶 Re-opened decision — eBay credential storage at E1.** The earlier decision (plaintext under `storageService`, migrated at N1) was made when N1 was roughly ten steps out. It is now unscheduled, which changes the question for the eBay token specifically: the Gemini key is free-tier and revocable in one tap, while an ~18-month eBay refresh token is access to his selling account, and the nostr spec states the asymmetry itself — *"the cost of a stolen cart is a stolen cart, and the cost of a stolen refresh token is his eBay account"* (§4). Three options, in preference order:

1. **"N1-lite" at E1 — recommended.** Build `keyVault.ts` alone: capability probe, WebAuthn PRF (or PIN/PBKDF2 fallback), HKDF → AES-GCM, and the `STORE_ENC_INFO` key — *without* NIP-06 identity, the twelve words, the backup ceremony, the sync engine or relays. Nostr §5.2 already separates the two HKDF labels, so encrypted-credentials-at-rest is genuinely separable from Nostr identity; this is perhaps a third of N1 and it closes the real risk. When the full N-track eventually runs, N1 adds the identity half on top of a vault that already exists.
2. **Accept it indefinitely.** Same posture as today, honestly labelled as permanent rather than interim. Defensible — the phone has a lock screen and the token is revocable from eBay account settings — but it should be a decision, not a default that outlived its premise.
3. **Pull full N1 forward before E1.** Closes everything, costs the Ultracode session before Dad has one-tap drafts. This is the option the original decision rejected, and the reasons still hold.

Decide before E1's prompt is written. Until then, both credentials remain plaintext under `storageService` with the interim risk notes (vision §2.5, eBay §5).

**The remaining seams, in build order:**

- **V0 → V1.** V0's output is a scored table (§6.2), and it feeds V1 directly: the default model, whether `clarifying_question` needs to fire more aggressively, and whether the capture UI needs photo guidance. Write the findings into a short amendment to vision §3 before V1's prompt.
- **V1 — key custody.** The Gemini key is written through `storageService` in plaintext with a `// TODO(N1): migrate to vault STORE_ENC_INFO` marker at the write site, plus the interim risk note (exact copy in vision §2.5's done-state bullet). Vision §2.5's "encrypted under the vault's key" and "synced inside a kind-30078 event" describe a state that is now unscheduled.
- **S1 — export *and* import, credentials excluded.** "Download everything (JSON)" is the whole backup story, and a file nothing can read back is not a backup — so S1 ships the import side too, with a format version field. **Scope both sides to exclude the credential keys**: a naive dump over `storageService` would write the plaintext Gemini key and eBay refresh token into a file in his Files app, which is strictly worse than where they already are. Label it honestly in Settings — *"This file is your only backup. Thrift Flip has no server."* — and prompt for it at the end of a trip.
- **V1 — the pencil formula, derived.** `calculations.js` currently computes profit *forward* (`calcProfit`) and checks the two rules (`checkRules`); there is no inversion. The pencil floor is the smallest sell price satisfying both house rules at once:

  ```
  floor = max( 3 × goodwillPrice ,  (20 + 0.30 + shipping + goodwillPrice) / (1 − 0.1325) )
  ```

  **Shipping must be a real input, not `calcProfit`'s `5.00` default.** The `$46.50` figure used as the canonical example throughout these specs is `goodwillPrice = 8`, `shipping = 12` → `40.30 / 0.8675 = 46.45`, rounded up. Ship the pencil tag with a shipping assumption Dad can see and change, or the headline number will silently disagree with every example in the docs. The render already exists by then — F2+A built `VerdictBanner variant="pencil"` against mock data; V1 supplies the arithmetic behind it.

- **V1 — the one test worth writing now, and what it actually costs.** `calculations.js` is the file that must never be wrong; a bad verdict costs real money on a real purchase. Unit-test `calcProfit`, `checkRules`, and the new pencil inversion against worked examples (including the `$46.50` case above) before T1. **The catch: there is no test runner in the repo** (§3.1) — no `test` script, no vitest. So this is "add Vitest + one config line + a spec file," not "write a test." Still small on Vite, but it breaks the repo's zero-dev-dependency streak and the V1 prompt should say so explicitly rather than letting Claude Code discover it mid-task. (This was previously framed as "the only test this project needs before N1's derivation vector" — with N1 unscheduled, that bound is gone: E1/E2's OAuth and refresh paths deserve their own tests when they land.)
- **F2+A — the one step that carries real product risk.** Merging the verdict rebuild with the four-tab camera-first restructure means committing to a structure without having watched Dad use it. That is the accepted cost of building before calibrating, and it is accepted because the destination was already reasoned to (the v3.1 prototype) rather than guessed. Two mitigations: build it against the prototype rather than improvising, and keep the change reversible in git — if calibration says the form-first flow was better, `git revert` is cheaper than having built both.
- **E1 — relay auth.** Ship `/api/ebay/*` behind a shared bearer secret baked into the client build, and call it what it is: a speed bump against a stranger who finds the URL, not authentication. Never ungated — `oauth.js` holds the eBay client secret. (`/api/ebay/deletion.js` is the deliberate exception; eBay calls it unauthenticated.) With NIP-98 unscheduled, treat this as the posture, not a placeholder.
- **E2 — item ids.** The SKU is the item's **local id**, the one `saveDraft` already upserts by (plan §8), carrying forward unchanged if it ever becomes an event id. eBay §6 already reads this way; do not mint a second identifier.
- **E2 — photos. Open question, resolve before starting.** eBay §6 sources listing photos from Blossom URLs (N4), now deferred indefinitely, which makes this question more urgent rather than less — and vision §6's ImgBB-decommission row carries the same Blossom assumption. Candidates: create drafts photo-less and let Dad add photos in Seller Hub, where he already reviews before publishing (cheapest, zero new surface, and now probably the right answer); the legacy Trading API `UploadSiteHostedPictures`, which takes a binary upload rather than a public URL; or a relay-side upload endpoint. **Not yet researched** — amend eBay §6, do not improvise inside a build prompt.
- **E3 — sold history.** Results go to `thrift-flip-sold-history`, a `storageService` store keyed by item id, joining the d-tag map (nostr §7) if N2 ever happens. V2 wires the tier-0 lookup against that store returning empty; E3 fills it. Note that eBay §1's **EH** tier (hosted keyset) and §8's **E3** (inbound) are different things — the letter collision is why §1's tier was renamed.
- **N1 vs N2, if and when they run.** N1 owns the credential write path; N2 preserves it rather than rebuilding it.

**✅ V2 SHIPPED (2026-07-28) — the comps ladder, with tier A built and dark.**
The ladder is **tier A (eBay sold) → tier 0 (his own sales) → model-only**, and
the seam it creates is worth stating because it is easy to get wrong later:
**only tier A ever re-prices an item.** Tier 0 is already injected into the
analyze request by `buildCompsBlock`, so the model's estimate has *seen* those
sales; overriding the estimate with the same numbers afterwards would count them
twice and present the result as corroboration. Tier 0 keeps its rank for
provenance and informs the question rather than answering it a second time.
Three sold sales (`MIN_SOLD_FOR_PRICING`) is the threshold below which comps are
context rather than a price.

Also shipped with it: the verdict never waits on comps (they attach and upgrade
in place); the Why sheet became a receipt showing the sold median beside the
model's own estimate; velocity answers "do they sell often?" from the sold
window; the confidence word now renders at **every** level on a model-only
verdict, including `high`, because R1 and H2 measured `high` earning 0–67%; and
the daily-quota copy splits off the per-minute one (H2's 20-a-day finding).

**⛔ Tier A has no data source, and this is a Founder-side blocker.** eBay gates
sold/completed search and SerpApi's eBay engine does not get through it —
measured across four sessions and seven queries, all returning 0 rows or a 503,
while the same engine returns 240 rows with the filter removed. The relay is
built, gated, tested and correct; it answers `unavailable` for every query, and
the app is headlessly verified to be indistinguishable from V1 in that state.
Repointing at a working feed replaces one function (`fetchSold`). The candidate
worth filing for is **eBay's own Marketplace Insights API** — last-90-days sold,
official, with real dates for velocity, reusing the OAuth connection and relay
this app already has — which needs an application to eBay. Runbook §13 carries
the measurements and the checks to run if that ever lands.

**🔒 CLOSED (2026-07-29) — there is no compliant automated marketplace pricing
data for an individual seller, and B1-lite is the answer to that.** The candidate
above was chased down and does not open:

- **Marketplace Insights** — closed. Restricted-access, granted per-application
  to approved business partners; a solo seller does not qualify.
- **The Buy APIs** — EPN-gated in production. Browse and its relatives require
  eBay Partner Network membership for a production keyset, which is an
  affiliate-marketing programme, not a research one.
- **Finding and Shopping** — retired.
- **SerpApi's eBay engine** — measured dead on the sold arm (above).

So the automated route is not "blocked pending a form"; it is **closed**. Two
consequences, both now built:

1. **The V2 ladder stays in place, dormant and source-agnostic.** Nothing is
   deleted. `fetchSold` in `api/serpapi/comps.js` is the single swap point, and
   the relay's `unavailable` answer is a tested, indistinguishable-from-V1 path
   rather than a broken one. **Re-check quarterly** — eBay's access tiers move.
2. **The pricing position of record is: model estimate + tier 0 (his own sold
   history) + manual rails.** That is the honest description of what prices an
   item, and it is what the UI now says on every verdict.

**✅ B1-lite SHIPPED (2026-07-29) — the manual sold rails.** eBay's **Product
Research** (ex-Terapeak) is the richest compliant sold source available to him:
free to every seller, **three years** deep, and — the part no API exposes —
including **accepted Best-Offer prices**, which is what thrift inventory actually
sells for. The catch is delivery, not access: on mobile it lives only in the eBay
native app (Selling → Product Research), with no published deep link. Hence a
clipboard hand-off rather than a URL, on both screens where a price is decided.
Deliberately **no `ebay://` scheme** — an undocumented scheme that lands him on
the app's home screen reads as broken software and costs more trust than the tap
saves.

Measured the same day: `https://www.ebay.com/sh/research?keywords=` does **not**
dead-end — with an iPhone user agent it redirects to sign-in with the keywords
preserved intact — so it ships as a third, explicitly desktop-labelled option at
listing time. Whether it renders usably on a signed-in phone is the one part a
scripted client cannot settle; runbook §13 carries it as an on-device check.

**Grounded Gemini is now the sole remaining automated option**, and it is
deferred rather than dismissed: it needs billing enabled (no free tier on 3.x)
and bills per query executed on a BYOK key. **Re-evaluate after the field trip**,
when there is real data on how often the model's own estimate is wrong enough to
be worth paying to correct.

### 6.2 The model decision (V0 skipped) and the two checks that moved to V1

**Decision of record:** V0 is skipped. Dad's sustained real-world use of **Gemini 3.6 Flash** on actual thrift items is stronger evidence of identification quality than a one-hour staged test, so `gemini-3.6-flash` is the **default** in `src/config/gemini.js` from V1 onward. Cost at 3.6-flash pricing ($1.50/$7.50 per 1M): a full item ≈ 2,500–3,300 tokens ≈ **$0.01–0.02**, a 20-item trip well under fifty cents, before any free-tier allowance applies. The old default (`gemini-3-flash-preview`) becomes the *budget fallback*, inverting vision §3's original tiering — that section carries the amendment. `docs/v0-model-check.md` is retained: its §3 system prompt is still the reconstruction of record that V1 ships in `src/config/prompt.js`, and its schema and scoring sheet are reused below.

**Two things Dad's manual use does not test, now riding with V1's verification — do not drop them:**

1. **The anchoring test.** Dad's own Gemini chats never tell the model what he paid; the app does (`analyzeItem` sends `goodwillPrice`). Once V1 works: run one mid-difficulty item through the app **twice**, identical photos and notes, Goodwill price $4 vs $30. If `pricing.estimate` moves meaningfully, the model is pricing off the purchase price and every verdict is circular — telling Dad an item is worth 3× whatever he's about to pay. Fix: stop sending the purchase price to the model at all; it is only needed client-side in `calculations.js`. Two minutes, and nothing else in the plan tests for it.
2. **Confidence calibration.** Dad reads prose and applies judgment; the app reads a structured `confidence` field and stamps a verdict with it. From V1's first ~10 real analyses, check that `confidence: high` answers are actually more accurate than `low` ones (score against eBay's sold filter, ~30 seconds each — sheet in `docs/v0-model-check.md` §6). If they aren't, V1 treats every estimate as low-confidence in the UI until V2's real comps arrive.

   **Resolved at V2 (2026-07-28), on the evidence there was.** R1 and H2 graded a handful of items and *every* one claimed `high`, scoring 0–67%. `n` is far too small to prove `high` is worthless, but it is more than enough to retire the assumption that it is worth hiding behind: the banner used to suppress the confidence word whenever the model said `high` and show a multiplier instead. It now names the model and its confidence at **every** level on a model-only verdict. The word disappears only when sold data has replaced it with something checkable. The calibration pass stays worth running; it no longer gates the UI decision.

**🔶 Grounding shelved as comps tier A (V2 decision, dated 2026-07-28).** Google
Search grounding lost on structural grounds, and none of them are about answer
quality: its ToS couples grounded results to a display requirement the app does
not meet, it has **no free tier on Gemini 3.x**, and it bills per query executed
on every BYOK key — which on a bring-your-own-key app means Dad pays $14/1,000
queries for a feature he did not choose. H1's grounded-vs-ungrounded comparison
was never measurable: the grounded arm returned `quota` on all five items in R1
and again in H2, executing zero queries, because a key without billing cannot
reach it at all. Recorded in `docs/live-check-results.md`. Not deleted from the
harness — if billing is ever enabled, the arm runs and the comparison finally
happens.

### 6.3 Calibration — the trips, after the build

This runs once the app is complete through E3–E4. Set the recording up before the first trip, or it produces impressions instead of data — and since the build no longer pauses to collect feedback, these trips are the *only* mechanism that turns Dad's experience into changes.

Per item he considers, record: what it was, the Goodwill price, whether the ID was right, the app's estimate and verdict, what he actually did, and — the important one — **why, whenever he overrode it.** Also count the items he did *not* bother opening the app for; that number is the honest measure of whether it is fast enough to be worth pulling out a phone in an aisle.

Watch for the four failure modes the specs already half-predict: identification collapsing on unbranded goods, an estimate that is confidently wrong, the flow being too slow to use at shopping pace, and the form being too much typing standing up — that last one is the camera-first signal, and it is the specific observation the A-track is waiting on. Watch also for the one the *repo* predicts: a storage-quota failure partway through the trip (§6.1).

Then, ninety days later, the only accuracy test that really counts: of the items he bought on the app's say-so, how many sold, at what price, and how long they took. That data feeds comps tier 0 anyway, so capturing it is not overhead.

**The comparison bar (amended after the grounding insight):** Dad already has a working tool — the Gemini app, search-grounded. On the first trip, run a few items through *both* the app and his usual Gemini chat. **"It worked" means: faster than his current flow with prices that agree or better, and he reaches for it unprompted on the next trip.** Beating nothing is not the test; beating his habit is.

## 7. Working Conventions (how this project is actually run)

- **Division of labor:** this chat/Cowork session = diagnosis, design, spec, plan review. **Claude Code (VS Code extension)** = implementation, fed complete prompts.
- **The loop (amended July 2026):** feed prompt → Claude Code returns a *plan* → Cowork reviews the plan against spec + repo (catch scope creep, wrong assumptions) → approve with *"This plan looks good. Please implement it exactly as written."* (plus any single amendment) → **Cowork issues the git block immediately with the approval** → Founder implements via Claude Code, runs the numbered verification steps, commits → Founder says it's committed → **Cowork reads the actual code in the connected folder and reviews it post-commit**, flagging anything that needs a follow-up fix (which becomes its own small commit). No implementation summaries pass through the Founder — the post-commit code review replaces them.
- **Git block — standing instruction (Founder, July 2026).** Issued with every plan approval and after every doc change, as a complete copy-pasteable block in exactly this three-line form with a precise, concise message — never a description of what to commit, never a lone `git commit` line:
  ```
  git add .
  git commit -m '[commit message]'
  git push
  ```
  Applies to doc-only changes (`docs/`, specs, prompts) as well as code. The Founder runs it only after implementation + verification pass; issuing it early is a convenience, not permission to skip verification.
- **Model/effort (amended July 2026, post-F2+A):** Claude Code via VS Code = **Opus 5 · Max thinking effort for all build prompts** from V1+S1 onward (token efficiency directive). Ultracode remains reserved for the vault (N1/N1-lite). Cowork replies to the Founder: precise and concise; Claude Code prompts delivered in full, as markdown snippets.
- **Practical:** emoji cannot be pasted into Claude Code — use HTML entities (`&#128278;`) in prompts. Prompts should cite exact file:line targets and include explicit do-not-touch lists and false-positive warnings — **and any prompt written against a specific commit must be re-verified if the repo moved underneath it** (the F1 prompt is the live example, §6.1).
- **Every build prompt opens by reading §6.1.** The specs are internally consistent but each assumes its own track ran first; §6.1 is where the interleaving is reconciled.
- **Standing directive (Founder, July 2026): Cowork always states its lean.** On every new feature, decision point, or vision question, the Cowork session gives its recommendation and the reasoning — flagged as a lean, distinguishing decisions that are data-gated (wait for the experiment) from decisions that are safe to take now.

## 8. Hard-Won Repo Gotchas (do not relearn these)

- **iOS input zoom:** any focused input under 16px zooms the page — *and so does one at the current 15px base.* Until F1 raises the base, every new input needs an explicit `font-size: 16px`.
- **Flex height chains:** `min-height: 0` required at *every* level, and an explicit height anchor at the top (`100dvh`) — `height: 100%` against `min-height`-only parents resolves to `auto`. This burned six passes on the verdict screen.
- **Fixed positioning:** the app is a centered 390px column — fixed elements use `left: 50%; transform: translateX(-50%); max-width: var(--column)`, never `left:0; right:0`.
- **Blob URLs:** only revoke object URLs for photos with a live `File` (`file !== null`) on unmount; restored base64 photos have none.
- **localStorage quota:** photos are base64 in localStorage and the cap is ~5MB. Nothing has ever filled it because nothing has ever run a real trip. S1 ships the guard (§6.1).
- **Chat scroll:** scroll the container (`scrollTop = scrollHeight`), never `scrollIntoView` (scrolls the whole page).
- **Persistence:** every new screen/sub-view must join the lazy-init + persist pattern or refresh will eject the user (this bit Preview, Drafts, Flip chat, and previousScreen in turn — and V1's Settings screen and key sub-screen are next).
- **Drafts:** `saveDraft` upserts by id; `handleClearListing({skipAutoSave:true})` when sending to eBay so sends don't create duplicate drafts. That id is also the eBay SKU and the future event id — one identifier, three lives.

## 9. Immediate Next Actions

1. ~~F1~~ — **done and reviewed** (`839fd79`).
2. **Run `claude-code-prompt-F2A.md`** in Claude Code (Fable 5, Extra High): the verdict rebuilt as `VerdictBanner + ListingPreviewCard + Panel` (go/skip/pencil, data-driven), the four-tab Buy/Cart/List/Selling shell per the v3.1 prototype, camera-first capture via file-input (explicitly **no getUserMedia** — the live-readout viewfinder is V1+ AI territory), Flip demoted from tab to routed screen, Why sheet on the tapnums. Screen ids unchanged; still all mocks; Cart/Listing/History internals untouched until F4.
3. **V1 + S1** in one prompt, sized per §6.1: Settings screen behind a header entry point plus the AI-key detail sub-screen, both composed from `ui/` and both on the persistence pattern; `analyzeItem` wired to direct Gemini — **default model `gemini-3.6-flash`** (§6.2) — with the structured schema, and the system prompt from `docs/v0-model-check.md` §3 landing in `src/config/prompt.js`; BYOK row with interim localStorage custody and the risk note; pencil floor math per §6.1's formula feeding the existing pencil banner; **Vitest added** plus specs for `calcProfit` / `checkRules` / the pencil inversion; PWA manifest/icon/standalone and the `index.html` viewport + `theme-color` edit; JSON export **and** import excluding credential keys; the photo-quota guard. **V1's verification includes §6.2's two checks: the anchoring test and the first confidence-calibration pass.**
5. **F3, then F4** — chrome and focus rings, then migrate Flip, Cart, Listing, Drafts, Selling, Preview and Chat onto `ui/` and delete the legacy aliases.
6. **V1.5/E0 → E1–E2 → V2–V4 → E3–E4.** Off the critical path and worth doing now: create the sandbox test user, configure the RuName redirect, build the deletion endpoint (ebay-connect §2 steps 3, 5–6 and §4).
7. Before E1's prompt: settle the re-opened credential-storage decision (§6.1).
8. **Then Dad, and the trips** (§6.3).
