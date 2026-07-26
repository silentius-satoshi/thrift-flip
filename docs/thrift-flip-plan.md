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
| `claude-code-prompt-F1.md` | The F1 build prompt | **Correct as of `b22906b`, and V1/S1 will invalidate parts of it — re-verify before running** (§6.1) |
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

n8n on Railway (deleted before ever wired — **the vision and nostr specs were written against it; both now carry a §0 erratum, but treat any surviving "proxy"/"workflow" phrasing in them as the edge relays, never as n8n**) · ImgBB · Google Lens / SerpApi Lens engine · Supabase/Stripe-first subscription plan (payments come later, Lightning/BTCPay-aligned, per the **EH** hosted-tier model — ebay-connect §1) · NIP-49 passphrase unlock (→ PRF) · the paper-tag/warm-graphite theme (frontend v1) · full-screen chat modal on the verdict (→ bubble navigates to the Flip conversation; `previousScreen` handles back) · marketplace form-filling automation · Nostr Step N5 as its own build step (NIP-98 now ships on the edge relays with E1) · pencil-verdict math as A-track work (pulled into V1, §6.1) · **F1-first sequencing** (the design-system refactor ahead of any working feature — superseded by §6's validate-ship-observe order; the F1 *prompt* is still substantively right but its file:line targets go stale at V1, §6.1) · any assumption the eBay dev account is missing (it is approved).

## 6. Build Order & Status

**The organizing principle:** the app currently has a complete UI and no validated behavior. So the order below spends the next three steps buying information — does the model work, does the app help, does the flow match how he actually shops — and only then spends a week on the component layer, which is easier to build correctly once the answers are in. Nothing in the specs is discarded; the *sequence* changed.

| Step | What | Status |
|---|---|---|
| — | Full 5-tab UI, storage abstraction, drafts/history/persistence | ✅ Done (`b22906b`) |
| **V0** | **Model validation — no code, no repo change.** 10–15 real thrift items through AI Studio on the actual system prompt + `responseSchema`; score identification, pricing, and calibration | **NEXT** — §6.2 |
| **V1 (+§2.5)** | Real Gemini analyze, structured output, **the first Settings screen + AI-key detail sub-screen**, BYOK onboarding, **pencil floor math + interim render**, `calculations.js` unit tests — built on the **current** theme | After V0 — scope detail in §6.1 |
| **S1** | Trip prep, rides with V1: PWA manifest + icon + `standalone` + `viewport-fit=cover`; **JSON export *and* import**, credential keys excluded; photo-quota guard | With V1 |
| **T1** | **The first real trip.** Dad uses it at Goodwill; structured observation per §6.3 | After V1/S1 |
| V1.5 / E0 | Mercari variant + Copy-for-eBay/Mercari + Vendoo lane documented — the after-trip listing half, informed by what he actually bought | After T1 |
| F1 | Tokens + `ui/` component layer + layout system + UIKitchen gate. **Re-verify the prompt against the post-V1 repo first** (§6.1) | After V1.5/E0 |
| F2 | Verdict rebuilt: VerdictBanner + ListingPreviewCard + earnings Panel (go/skip/pencil) | After F1 |
| **A-track** | Camera-first Buy, 4-tab consolidation — **gate is T1, and it runs BEFORE the bulk migration** | After F2, if T1 endorses it |
| F3 | Chrome: frosted nav/bars, History→Selling rename, emoji→SVG, focus rings | After the structure settles |
| F4 | Migrate remaining screens onto `ui/`, into the settled structure; delete legacy aliases | After F3 |
| E1–E2 | eBay OAuth connect (sandbox→prod), deletion endpoint, outbound drafts. **Credential-at-rest decision required first** (§6.1) | Config unblocked now; code after F4 |
| V2–V4 | Comps provider on `/api/serpapi/comps.js` + Browse fallback + source chip; chat & listing-gen on the direct call; ImgBB decommission | After E1–E2 |
| E3–E4 | Inbound sold/traffic → Selling + comps flywheel (fills tier 0); token lifecycle | After V2–V4 |
| N1–N4, N6 | Identity vault, NostrStore, sync engine, Blossom, relay mgmt | **Deferred — gated on the subscription product, not on Dad** (§6.1) |
| ~~F5~~ | PWA | Absorbed into S1; leftovers ride with F3 |

Recommended sequence: **V0 → V1+S1 → T1 → V1.5/E0 → F1 → F2 → A-track → F3 → F4 → E1–E2 → V2–V4 → E3–E4 → N-track when the business case arrives.**

Off the critical path, do any time: create the sandbox test user, configure the RuName redirect, and stand up the account-deletion endpoint (ebay-connect §2 steps 3, 5–6 and §4). About an hour, blocks nothing, and E1 starts cold without it.

### 6.1 Why this order, and the seams it creates

**This section outranks the companion specs wherever they disagree about *when* something exists.** Each spec was written as if its own track ran first; this is where the interleaving is reconciled.

**Why V0 is first.** Every line of the five specs rests on one untested empirical claim: that a vision model can identify thrift inventory from three phone photos in bad light and price it usefully. It has never been checked once. It is checkable in under an hour with no code — which makes it the highest information-per-hour action available. If IDs come back at 2/5 instead of 4/5, the fix is upstream (a clarifying-question loop, 3.6-flash as default, a photo protocol) and you want that news before a week of component work.

**Why V1 precedes F1.** The standard argument for the design system first is that you avoid migrating screens twice, and it loses here on magnitude — but by less than the first draft of this section claimed, so size V1 honestly (below). What the swap buys is a working decision instrument on his phone weeks earlier, and — via T1 — the information that makes F1 through F4 build the right thing once.

**Why the trip is a build step.** The plan previously deferred all user feedback to the A-track, at the very end, for an app with exactly one user who is available on Saturdays. Worse, it sequenced F4 (migrate five screens onto the component layer) *before* the A-track (restructure those same screens into four tabs). Running T1 early fixes both: the A-track's gate becomes T1, the structural decision lands before the bulk migration, and F4 migrates once. If T1 says the five-tab form-first flow is fine, the A-track is dropped and nothing was lost.

**Why the N-track is deferred.** Its user-facing benefit for Dad is that his business record survives a lost phone; for that, a JSON export/import pair covers the disaster case, and it ships in S1 before the first trip. The vault, PRF unlock, sync engine and relay reconciliation are the most complex, highest-risk work in the project, and their real justification is the sovereign subscription product: portable identity, no accounts, the pubkey that becomes the billing hook. Sequencing them by the product roadmap rather than by Dad's needs is the change; the architecture is unchanged. **But deferring N1 indefinitely has consequences the first draft of this plan waved through — see "what the deferral costs" below.**

**Sizing V1 honestly.** This plan first described V1's UI surface as "a Settings row, a paste screen, and a pencil state." That was wrong: **there is no Settings screen in the repo at all** (§3). V1 therefore builds:

- a **Settings screen** — a new tab or a header entry point, joining the lazy-init + persist pattern (§8) or refresh will eject him;
- a **"Your keys" section** with the Verdicts row, plus an **AI-key detail sub-screen** (Test / Replace / Revoke help, and the interim risk note) — that is a second new sub-view, and sub-views have their own persistence trap (§8);
- the BYOK paste flow, the direct-Gemini call and schema wiring;
- the pencil arithmetic in `calculations.js` plus its interim render;
- unit tests on `calculations.js`.

That is a real chunk of work, not an afternoon. It is still the right thing to do before F1 — the screens are simple and F4 migrates them like any other — but budget it as such, and note that these two new screens are the *only* new screens F4 has to migrate that the original plan didn't foresee.

**What "don't touch the theme" precisely means at V1.** V1 ships on the current tokens and the current 13 stylesheets. That means: do not introduce the new `:root` block, do not retokenize existing rules, do not rename variables, do not restyle any screen. It does **not** mean V1 writes no CSS — it necessarily adds pencil-state rules to `ShoppingMode.css` and new stylesheets for the two new screens, in the existing idiom. F1 absorbs all of it.

**Three F1-era rules V1 must honor early, because it ships new UI before F1 exists:**

1. **Every input V1 adds gets an explicit `font-size: 16px`.** The base is still 15px until F1 raises it, and an input at the base zooms the page on focus (§8). The BYOK paste field is the one that will bite.
2. **The pencil render cannot use F1 tokens.** `--t-hero`, the `.money` tabular-figures rule, and the `:focus-visible` ring all arrive with F1's `:root`. Hardcode the equivalents at V1 and let F2 tokenize them when it rebuilds the verdict.
3. **S1 owns `viewport-fit=cover` and `theme-color`, not F1.** Both are listed in F1's prompt (Part 1) and in frontend §5/§10. S1 ships them first; F1's step becomes a verify-and-skip.

**The F1 prompt goes stale at V1 — re-verify before running it.** This plan previously asserted the prompt was "unchanged and still correct." It is substantively right and its token/alias work self-heals via its own re-grep step, but four things in it are pinned to `b22906b` and V1/S1 will move them: the file:line targets in Part 3 (`ShoppingMode.css` ~35/~61/~72/~89 — the same file V1 edits), the `valid` screen array in Part 4 (V1 adds `'settings'` and the key sub-view), the "all 7 screens reachable" check in Verification step 2, and Part 1's `index.html` viewport/theme-color edit (now S1's). Re-run the greps against the post-V1 repo and update those five spots before feeding it.

**What the deferral costs — read this before E1.** With N1 unscheduled, four things that were framed as temporary are now open-ended, and they were sized against a horizon that no longer exists:

- **The eBay refresh token is the live one, and it is a re-opened decision (see below).**
- **Three completion gates have no date.** E1's real ciphertext gate, vision §2.5's second-device key check, and nostr §13's N1 gate 5 (both its ciphertext half and its NIP-98 half) all now sit unrun indefinitely. Do not let a build summary claim them as passed.
- **NIP-98 never arrives, so the relays keep the bearer-secret speed bump.** Nostr §8's "NIP-98 prevents using the relay to impersonate" describes a mitigation that will not ship on this timeline. The honest posture: the relays are gated against strangers, not against a determined attacker with the client bundle, and `oauth.js`'s blast radius is the eBay app credentials, which are rotatable from the dashboard.
- **Shopping photos stay base64 in localStorage.** Nostr N4 was going to move them to IndexedDB and "remove the base64-in-localStorage quota dance entirely." N4 is deferred and **T1 — a full trip, 1–3 photos per item — is the first thing that will ever stress it.** localStorage caps around 5MB; a dozen items at three photos each will hit it, mid-aisle, as a write failure. **S1 must ship a guard**: downscale on capture, cap the retained shopping photos, and fail loudly and recoverably rather than silently losing a verdict. Moving shopping photos to IndexedDB does not actually require Nostr — it is the local half of N4 and can be lifted out if the guard proves insufficient.

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

  **Shipping must be a real input, not `calcProfit`'s `5.00` default.** The `$46.50` figure used as the canonical example throughout these specs is `goodwillPrice = 8`, `shipping = 12` → `40.30 / 0.8675 = 46.45`, rounded up. Ship the pencil tag with a shipping assumption Dad can see and change, or the headline number will silently disagree with every example in the docs.

- **V1 — the one test worth writing now, and what it actually costs.** `calculations.js` is the file that must never be wrong; a bad verdict costs real money on a real purchase. Unit-test `calcProfit`, `checkRules`, and the new pencil inversion against worked examples (including the `$46.50` case above) before T1. **The catch: there is no test runner in the repo** (§3.1) — no `test` script, no vitest. So this is "add Vitest + one config line + a spec file," not "write a test." Still small on Vite, but it breaks the repo's zero-dev-dependency streak and the V1 prompt should say so explicitly rather than letting Claude Code discover it mid-task. (This was previously framed as "the only test this project needs before N1's derivation vector" — with N1 unscheduled, that bound is gone: E1/E2's OAuth and refresh paths deserve their own tests when they land.)
- **T1 → A-track.** If the trip endorses camera-first, the structural change runs after F2 and **before** F3/F4, so the migration happens once. It remains a separately approved step. If the trip is ambiguous, take a second trip rather than guessing.
- **E1 — relay auth.** Ship `/api/ebay/*` behind a shared bearer secret baked into the client build, and call it what it is: a speed bump against a stranger who finds the URL, not authentication. Never ungated — `oauth.js` holds the eBay client secret. (`/api/ebay/deletion.js` is the deliberate exception; eBay calls it unauthenticated.) With NIP-98 unscheduled, treat this as the posture, not a placeholder.
- **E2 — item ids.** The SKU is the item's **local id**, the one `saveDraft` already upserts by (plan §8), carrying forward unchanged if it ever becomes an event id. eBay §6 already reads this way; do not mint a second identifier.
- **E2 — photos. Open question, resolve before starting.** eBay §6 sources listing photos from Blossom URLs (N4), now deferred indefinitely, which makes this question more urgent rather than less — and vision §6's ImgBB-decommission row carries the same Blossom assumption. Candidates: create drafts photo-less and let Dad add photos in Seller Hub, where he already reviews before publishing (cheapest, zero new surface, and now probably the right answer); the legacy Trading API `UploadSiteHostedPictures`, which takes a binary upload rather than a public URL; or a relay-side upload endpoint. **Not yet researched** — amend eBay §6, do not improvise inside a build prompt.
- **E3 — sold history.** Results go to `thrift-flip-sold-history`, a `storageService` store keyed by item id, joining the d-tag map (nostr §7) if N2 ever happens. V2 wires the tier-0 lookup against that store returning empty; E3 fills it. Note that eBay §1's **EH** tier (hosted keyset) and §8's **E3** (inbound) are different things — the letter collision is why §1's tier was renamed.
- **N1 vs N2, if and when they run.** N1 owns the credential write path; N2 preserves it rather than rebuilding it.

### 6.2 V0 — the validation pass (the next thing to do)

No repo change, no prompt to Claude Code. Roughly an hour.

Shoot **10–15 items** that look like a real trip's inventory and deliberately span the difficulty range: unbranded vintage ceramics, a no-label wool coat, a piece of Pyrex, a power tool, a book, a labelled jacket, something with the tag cut out. Shoot them the way he actually would — handheld, store lighting, three angles, no staging.

Within that shoot, include **the same five items vision §7's V1 gate names — sneaker, book, tool, mug, vintage electronics** — and score the gate on those five. Using one item set for both means V0 tests the *model* and V1's gate re-tests the *wiring* against a known-good baseline, instead of two different tests with two different denominators.

Run each through AI Studio using the **actual** three-mode system prompt and the `responseSchema` in **`thrift-flip-vision-pipeline-v1.md` §5**, not an ad-hoc prompt. For each item record: identification correct (brand + model), condition grade plausible, price estimate versus what a manual eBay sold-filter search says, and the model's own stated `confidence`. The number that matters most is not accuracy but **calibration** — whether `confidence: high` is actually more accurate than `confidence: low`. A model that is wrong and knows it is usable; one that is wrong and confident is dangerous, because the verdict screen will stamp it.

Gate: **≥4 of the 5 core items** correct on brand+model, price estimates inside a defensible range, and confidence that tracks accuracy across the wider set. Miss it and the fix is upstream — default to `gemini-3.6-flash`, fire `clarifying_question` more aggressively, or add photo guidance to the capture UI — before V1 is written.

### 6.3 T1 — the trip (what to record, and what "it worked" means)

Set this up before going, or the trip produces impressions instead of data.

Per item he considers, record: what it was, the Goodwill price, whether the ID was right, the app's estimate and verdict, what he actually did, and — the important one — **why, whenever he overrode it.** Also count the items he did *not* bother opening the app for; that number is the honest measure of whether it is fast enough to be worth pulling out a phone in an aisle.

Watch for the four failure modes the specs already half-predict: identification collapsing on unbranded goods, an estimate that is confidently wrong, the flow being too slow to use at shopping pace, and the form being too much typing standing up — that last one is the camera-first signal, and it is the specific observation the A-track is waiting on. Watch also for the one the *repo* predicts: a storage-quota failure partway through the trip (§6.1).

Then, ninety days later, the only accuracy test that really counts: of the items he bought on the app's say-so, how many sold, at what price, and how long they took. That data feeds comps tier 0 anyway, so capturing it is not overhead.

**"It worked" means:** he reaches for it unprompted on the next trip. Nothing else is evidence.

## 7. Working Conventions (how this project is actually run)

- **Division of labor:** this chat/Cowork session = diagnosis, design, spec, plan review. **Claude Code (VS Code extension)** = implementation, fed complete prompts.
- **The loop:** feed prompt → Claude Code returns a *plan* → review the plan against spec + repo (catch scope creep, wrong assumptions) → approve with *"This plan looks good. Please implement it exactly as written."* (plus any single amendment) → run the numbered verification steps → commit.
- **Git block — standing instruction (Founder, July 2026).** After *every* change approved for commit, the Cowork session issues a complete, copy-pasteable block in exactly this three-line form, with a real message in place of the placeholder. Not a description of what to commit, not a single `git commit` line — the whole block, every time, unprompted:
  ```
  git add .
  git commit -m '[commit message]'
  git push
  ```
  Applies to doc-only changes (`docs/`, specs, prompts) as well as code. Still issued *after* the change is approved and any verification steps pass — never as a suggestion to commit something unreviewed.
- **Model/effort per task:** Fable 5 · Extra High for foundational/cross-cutting work (V1, F1, E1 OAuth); **Ultracode reserved for the vault** (N1, or N1-lite if §6.1's option 1 is taken); Sonnet 5 · High for mechanical migrations (F4) and single-file fixes.
- **Practical:** emoji cannot be pasted into Claude Code — use HTML entities (`&#128278;`) in prompts. Prompts should cite exact file:line targets and include explicit do-not-touch lists and false-positive warnings — **and any prompt written against a specific commit must be re-verified if the repo moved underneath it** (the F1 prompt is the live example, §6.1).
- **Every build prompt opens by reading §6.1.** The specs are internally consistent but each assumes its own track ran first; §6.1 is where the interleaving is reconciled.

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

1. **Run V0** (§6.2). No code. Shoot the item set — including the five core items — and run it through AI Studio on the real prompt and the vision spec's §5 schema. Score ID / condition / price / calibration.
2. Write the V0 findings into a short amendment to vision §3 (default model, escalation rule, any photo guidance the capture UI needs).
3. **Then V1 + S1** in one Claude Code prompt (Fable 5, Extra High), sized per §6.1 and citing §3.1's verified line numbers: Settings screen + AI-key detail sub-screen, both on the persistence pattern, both added to `App.jsx`'s screen array at line 22; `analyzeItem` wired to direct Gemini with the structured schema; BYOK row with interim localStorage custody and the risk note; **every new input at explicit `font-size: 16px`** (base is 15px until F1); pencil floor math per §6.1's formula plus its interim `VerdictCard` render with hardcoded (not tokenized) values; **Vitest added** plus specs for `calcProfit` / `checkRules` / the pencil inversion; PWA manifest/icon/standalone and the `index.html` viewport + `theme-color` edit; JSON export **and** import excluding credential keys; the photo-quota guard. Do-not-touch: the `:root` token block in `index.css`, existing variable names, and any restyling of existing screens — new CSS in the existing idiom is expected and fine (§6.1).
4. **Then take him to Goodwill** (§6.3), with the recording sheet set up beforehand.
5. In parallel whenever convenient, off the critical path: create the sandbox test user, configure the RuName redirect, build the deletion endpoint (ebay-connect §2 steps 3, 5–6 and §4).
6. After T1: V1.5/E0 for the listing half. Then **re-verify `claude-code-prompt-F1.md` against the post-V1 repo** (§6.1) before running F1, and take the A-track decision.
7. Before E1's prompt: settle the re-opened credential-storage decision (§6.1).
