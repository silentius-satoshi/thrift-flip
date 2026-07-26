# Claude Code Prompt — F2+A: The Verdict + the Four-Tab Camera-First Shell
<!-- Model: Fable 5 · Effort: Extra High · Verified against repo @ 839fd79 (F1 complete) -->

Implement F2+A of the Thrift Flip front-end redesign: rebuild ShoppingMode's flow as the camera-first **Buy** experience and restructure the nav to **four tabs**, both assembled from the `ui/` component layer F1 built. The structural reference of record is `docs/../thrift-flip-design-v3-1-ebay.html` (the v3.1 prototype) — where this prompt and the prototype disagree about layout or flow, **the prototype wins**; where either disagrees about component composition, **frontend spec v2 §6 wins**.

**Scope boundary — as important as the work itself:**
- **Still no real AI.** `analyzeItem`, `sendChatMessage`, `generateListing` remain the existing mocks in `src/utils/webhooks.js`, called exactly as today. V1 replaces them, not this step.
- **Do not touch** `src/utils/*`, `src/hooks/useCart.js`, `src/hooks/useGemini.js`, `src/contexts/*`.
- **Do not restructure Cart, Listing, History, Drafts, Preview, or Flip internals** — they render as-is (recolored by F1's aliases) under the new tab structure. Their migration onto `ui/` is F4.
- **No getUserMedia / live video streaming.** The prototype's viewfinder shows live AI readout chips ("Pendleton wool blanket · $8.00 read from the sticker") — that is a V1+ AI feature on top of streaming vision that does not exist yet. The Buy screen gets the camera-first *structure and chrome* now; capture happens through the native camera via a file input (below). If your plan proposes `navigator.mediaDevices`, it has left scope.
- **Screen ids do not change.** `'shop'`, `'flip'`, `'cart'`, `'listing'`, `'history'`, `'drafts'`, `'uikit'` all keep their ids — tabs and labels change, persistence keys do not. No stored-value migration.

---

## PART 1 — Four tabs (`Nav.jsx` / `App.jsx`)

The prototype's nav (its `NAV_FOR` map) defines the structure:

| Tab | Label | Screen id | Badge |
|---|---|---|---|
| 1 | **Buy** | `shop` | — |
| 2 | **Cart** | `cart` | numeric `cartCount` (red, keep the `>9 ? '9+'` display) |
| 3 | **List** | `listing` | `badgeDot` when `hasActiveListing` |
| 4 | **Selling** | `history` | — |

- Icons from the prototype: Buy = camera, Cart = cart (unchanged), List = tag, Selling = chart. Recreate as inline SVG components in `Nav.jsx`, same stroke conventions as the existing icons.
- **The Flip tab is gone; the `flip` screen is not.** FlipMode (conversation list + ChatThread) stays fully functional and routable: the verdict's chat affordances navigate into it exactly as today (`onGoToFlip` / `previousScreen` / back). With nav visible on the `flip` screen, highlight **Buy** as the active tab (conversations are about items being bought — and the prototype maps its chat screen under `buy`).
- The tab label is **Selling** (prototype) even though the screen id and internals remain `history`/HistoryMode — internals rename at F3/F4. Label only.
- Nav stays hidden on `preview` (existing App.jsx behavior) — extend the same treatment to nothing else new; the Buy screen's camera phase manages its own chrome (Part 2).

## PART 2 — ShoppingMode rebuilt: the Buy flow

Rebuild `ShoppingMode.jsx` (+ its CSS, which should shrink toward layout glue) as a three-phase flow composed from `ui/` components. All phase state joins the existing lazy-init + persist pattern (`// Direct read — sync required for useState lazy init`) — a refresh mid-flow must restore the phase, the photos, the form values, and the verdict. This is the repo's #1 recurring bug class; treat it as a requirement, not a nicety.

### Phase A — Capture (camera-first, per the prototype's `cam` screen)
Full-bleed dark screen (this phase hides the nav — same mechanism as `preview`): framing-bracket chrome, a **74px shutter button** centered at the bottom. The shutter triggers a hidden `<input type="file" accept="image/*" capture="environment">` — on iPhone this opens the native camera directly; on desktop it falls back to a file picker. Left of the shutter: the last captured photo as a 52px round thumb (tap = retake/manage photos, up to 3, reusing the existing `fileToBase64` pipeline and the existing photo persistence). Right of the shutter: a shortcut to Selling (prototype has this).

Below/over the viewfinder, a compact details strip replacing the old full-page form: **notes** (`Input`), **condition** (`Chip` row), **Goodwill price** (`Input`, numeric). Once ≥1 photo exists, a primary **"Get the verdict"** action submits — calling the existing mock `analyzeItem` with the same payload shape as today.

### Phase B — Pending → Pencil (prototype's `pencil` screen)
While `analyzeItem` is in flight (the mock takes 2.4s — a realistic stand-in), show the pencil composition: `VerdictBanner variant="pencil"` ("Your call for now" / "figured on this phone"), then a `Panel` titled **"What it must sell for"** with the floor figure at 34px tabular-bold, rows for *Paid at Goodwill*, *Fees + shipping at that price*, *Your rules — 3× and $20 net*, and the closing question line. `ActionBar`: **Skip it** (danger) / **Add to cart** (primary) — both live immediately; acting before the verdict arrives is a feature, per the prototype's copy.

The floor value comes from a **local stub** in the component:
```js
// TODO(V1): replace with the real inversion in src/utils/calculations.js (plan §6.1 formula)
const pencilFloorStub = (goodwillPrice) => Math.max(goodwillPrice * 3, 46.50);
```
Deliberately not added to `calculations.js` — V1 owns that file's change and its tests. The stub keeps the render data-driven so V1 is a one-line swap.

If `analyzeItem` rejects (offline), stay on the pencil composition with the signal chip ("No signal · the verdict catches up on its own") instead of an error state.

### Phase C — Verdict (prototype's `stamped` / `skip` screens)
When the mock resolves, map `checkRules(estSellPrice, goodwillPrice, netProfit).verdict` to the banner — **note the string mapping: `'buy'` → `variant="go"`, `'skip'` → `variant="skip"`** (`checkRules` predates the design language; do not "fix" `calculations.js`).

Composition, top to bottom, all from `ui/`:
1. `VerdictBanner` — go: "BUY IT" + multiple-over-floor detail; skip: "SKIP IT" + "under your floor".
2. `ListingPreviewCard` — photos = the captured thumbs; title = the notes text (fallback `'Untitled find'`); condition = `Pre-owned · {condition}`; price = `estSellPrice` with `obo`; shipping line = `+$X shipping · sells in ~{avgDaysToSell} days`; `soldLine` = `{soldCount} sold in the last 30 days`, **tappable → the Why sheet**. Skip variant uses `struck`.
3. `Panel` "Your earnings" — Item price (also tappable → Why sheet) / Selling costs · 13.25% + $0.30 / Shipping label / Paid at Goodwill / `PanelTotal` "You'd keep" (green when `'buy'`, red when `'skip'`), with the 3×/$20 check row underneath (green ✓ / muted ✗ per `checkRules`).
4. Advisor `Card` — avatar "F", the mock's `chatHistory[0].text` as the teaser, chat icon button → navigates to the item's Flip conversation (existing `onGoToFlip` wiring, unchanged).
5. `ActionBar` — go: Skip it (danger) / Add to cart (primary); skip: Next item (outline) / Cart anyway (danger, narrower).

"Skip it" / "Next item" resets to Phase A. "Add to cart" keeps today's `onAddToCart` behavior.

**The old verdict internals retire:** `VerdictCard` and `SellVelocity` are no longer rendered by ShoppingMode (their stats fold into the preview card lines and the Why sheet). **Leave both component files in place** — F4 deletes them; removing files now would churn the F4 plan.

### The Why sheet (prototype's `why` screen)
A `Sheet` titled "Where $X comes from", three source rows built with the existing `.src`-style layout composed from plain elements inside the Sheet: **Your own sales** (mock: two prior sales — static placeholder copy is fine, labeled clearly as sample data), **eBay sold listings** (from `soldCount`/`recentSales` mock fields), **Model read** (static line). Footer `Button` outline full: "See these sold listings on eBay" (no-op or `#` for now). Opens from either tapnum; dismisses by scrim tap and swipe (Sheet already does both).

## PART 3 — Housekeeping

- Add `.claude/` to `.gitignore` (it's sitting untracked in the working tree).
- `UIKitchen` and the `uikit` dev route are untouched.
- Run `grep -rhoE 'var\(--[a-z0-9-]+' src | sort -u` after the rebuild — every name must still resolve (F1's rule). New Buy-flow styling must not hand-roll buttons, cards, inputs, or money rows: **if new CSS puts `border-radius` or `padding` on an interactive element, it belongs in `ui/`, not the screen** (frontend v2 §4's grep rule is live).

## Constraints recap

Untouchables: `src/utils/*`, `src/hooks/useCart.js`, `src/hooks/useGemini.js`, `src/contexts/*`. No getUserMedia. No screen-id changes. No internal restructuring of Cart/Listing/History/Drafts/Preview/Flip. `npm run build` clean; zero console errors.

## Verification (run after implementing)

1. `npm run build` clean; app boots with zero console errors.
2. **Four tabs** — Buy / Cart (badge) / List (dot) / Selling — correct active states; `flip` screen still routable with Buy highlighted; `preview` still hides nav.
3. **Buy flow end-to-end on mock data:** capture/pick ≥1 photo → details strip → Get the verdict → pencil composition renders during the 2.4s mock delay with live Skip/Add-to-cart → stamped verdict renders with banner/preview-card/earnings/advisor/action-bar. Force a low estimate (cheap goodwillPrice vs the mock's multiplier can't — instead temporarily assert the skip composition renders by inspecting with `checkRules` returning `'skip'`; both variants must be reachable in code review even if the mock's random multiplier usually returns `'buy'`).
4. Why sheet opens from both tapnums, swipe-dismisses, scrim-dismisses.
5. Advisor chat icon → Flip conversation for that item → back returns to the verdict (previousScreen intact).
6. **Refresh at every phase** — capture with photos taken, pending, pencil, stamped — restores state (the persistence gotcha).
7. Add to cart → Cart tab badge increments; Skip it returns to capture with the form cleared.
8. Offline (DevTools network off) → Get the verdict → pencil composition with signal chip, no error state; Add to cart still works.
9. No new screen-level CSS defines a button/pill/card/input/money row (spot-grep `border-radius` in `ShoppingMode.css` — layout glue only).
10. Final summary lists every file changed with line counts.
