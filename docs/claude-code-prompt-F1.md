# Claude Code Prompt — F1: Tokens + UI Component Layer
<!-- Model: Fable 5 · Effort: Extra High · Verified against repo @ b22906b -->

> ## ⚠ RE-VERIFY BEFORE RUNNING — this prompt is pinned to commit `b22906b`
>
> The build order was resequenced in July 2026 (`thrift-flip-plan.md` §6). **F1 is no longer next**: V0 (model validation), V1+S1 (real Gemini, first Settings screen, pencil floor, PWA manifest, JSON export/import) and T1 (a real thrift-store trip) all run first. The substance of this prompt is unchanged and still correct — the token block, the component inventory, the layout system and the UIKitchen gate all stand. But **five things below are pinned to the pre-V1 repo and V1/S1 will move them.** Re-check each against the actual repo before feeding this to Claude Code:
>
> 1. **Part 3's file:line targets.** `src/App.css` ~3/~83, `ShoppingMode.css` ~35/~61/~72/~89, `ListingMode.css` ~223. V1 edits `ShoppingMode.css` to add the interim pencil-verdict styling, so those line numbers will drift. Re-grep and re-anchor.
> 2. **Part 4's `valid` screen array.** It currently reads `['shop','flip','cart','listing','history','drafts']`. V1 adds a Settings screen and an AI-key detail sub-view; the real array will be longer.
> 3. **Verification step 2's "all 7 screens."** There will be more than seven.
> 4. **Part 1's `index.html` edit.** `viewport-fit=cover` and `<meta name="theme-color">` are now shipped by **S1**, before this prompt runs. That step becomes verify-and-skip, not an edit.
> 5. **New CSS that didn't exist at `b22906b`.** V1 adds stylesheets for the Settings screen and the key sub-screen, plus pencil rules in `ShoppingMode.css`. They are written in the *old* idiom deliberately (plan §6.1) and F1 must fold them in like any other legacy file — add them to the alias/retoken sweep rather than leaving them behind.
>
> Part 1's own instruction to re-run `grep -rhoE 'var\(--[a-z0-9-]+' src | sort -u` before finalizing the alias list already self-heals token drift. Nothing self-heals items 1–4.

Implement F1 of the Thrift Flip front-end redesign: a new design token system (eBay dark language) plus a shared UI component layer. This is architectural — NO business logic, storage, webhook, context, or flow changes. All existing screens must work identically after this change, just wearing the new palette. The tab structure stays exactly as is. Do not touch `src/utils/*`, `src/hooks/useGemini.js`, `src/hooks/useCart.js`, or `src/contexts/*`.

---

## PART 1 — Token system (`src/index.css`)

Replace the current `:root` token block with the new set, then add a legacy alias block so all existing CSS keeps working without edits.

```css
:root{
  /* Surfaces — eBay dark */
  --bg:#0F0F0F; --card:#1B1B1B; --card-2:#242424;
  --line:#2E2E2E; --line-2:#3E3E3E;
  /* Text */
  --fg:#F7F7F7; --fg-2:#A8A8A8; --fg-3:#6E6E6E;
  /* Brand + meaning. Blue = action only. Green = profit. Red = sold/skip. Yellow = pending. */
  --blue:#3665F3; --blue-lt:#6592FD;
  --green:#86B817; --red:#E9403B; --yellow:#F5AF02;
  --green-wash:rgba(134,184,23,.14); --red-wash:rgba(233,64,59,.14);
  --yellow-wash:rgba(245,175,2,.14); --blue-wash:rgba(54,101,243,.16);
  /* Type */
  --font:"Market Sans",-apple-system,BlinkMacSystemFont,"Helvetica Neue","Segoe UI",Arial,sans-serif;
  --t-label:11px; --t-sub:13px; --t-body:16px; --t-title:21px;
  --t-price:26px; --t-earnings:22px; --t-hero:34px;
  /* Shape */
  --r-pill:24px; --r-card:12px; --r-chip:20px; --r-input:8px;
  /* Layout — single source of truth for the bottom chrome */
  --nav-h:56px; --bar-h:64px;
  --safe-b:env(safe-area-inset-bottom,0px);
  --nav-total:calc(var(--nav-h) + var(--safe-b));
  --gutter:16px; --column:390px;
  /* Motion */
  --ease:cubic-bezier(.32,.72,0,1); --fast:150ms; --base:240ms;
}

/* LEGACY ALIASES — bridge for un-migrated screen CSS. Delete in F4.
   This list was generated from actual var(--…) usage in the repo. */
:root{
  --bg-base:var(--bg); --bg-primary:var(--bg); --bg-card:var(--card); --bg-input:var(--card-2);
  --border:var(--line); --border-mid:var(--line-2);
  --text-primary:var(--fg); --text-secondary:var(--fg-2); --text-muted:var(--fg-3);
  --amber:var(--yellow); --amber-bg:var(--yellow-wash); --amber-border:rgba(245,175,2,.35);
  --green-bg:var(--green-wash);  --green-border:rgba(134,184,23,.35);
  --red-bg:var(--red-wash);      --red-border:rgba(233,64,59,.35);
  --blue-bg:var(--blue-wash);    --blue-border:rgba(54,101,243,.45);
  --radius-input:var(--r-input); --radius-card:var(--r-card); --radius-pill:var(--r-pill);
}
```

Notes:
- `--green`, `--red`, `--blue`, `--amber`→`--yellow` are name-collisions on purpose: old CSS referencing them simply picks up the new eBay values. Only names absent from the new set get aliases.
- Before finalizing, re-run `grep -rhoE 'var\(--[a-z0-9-]+' src | sort -u` and confirm every name found is defined in one of the two blocks. If anything new appears, extend the alias block. Nothing may reference an undefined variable. **This sweep is what catches the V1-era stylesheets (see the warning above).**

Then update the base styles in the same file:
- `html, body`: `background: var(--bg)`, `color: var(--fg)`, `font-family: var(--font)`, `font-size: var(--t-body)` (this raises the 15px base to 16px — intended, it is the iOS focus-zoom fix). **V1 will have set explicit 16px on its own inputs to work around the old base; those declarations become redundant but harmless — leave them or fold them into the `ui/` components, do not hunt them.**
- `#root`: `max-width: var(--column)`; background follows the alias automatically.
- Add global rules:
```css
* { -webkit-tap-highlight-color: transparent; }
:focus-visible { outline: 2px solid var(--blue-lt); outline-offset: 2px; border-radius: 4px; }
.money { font-variant-numeric: tabular-nums; }
.lbl { font-size: var(--t-label); letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); font-weight: 700; }
input, textarea, select { font-size: var(--t-body); } /* Safari zooms the page below 16px */
```

In `index.html`: **verify** the viewport meta reads `content="width=device-width, initial-scale=1, viewport-fit=cover"` and that `<meta name="theme-color" content="#0F0F0F">` is present. S1 ships both; only add them if they are missing.

---

## PART 2 — Component layer (`src/components/ui/`)

Create 14 components, each as `Name.jsx` + `Name.css` in `src/components/ui/`. Rules: components own all their styling and variants; accept `className` passthrough and spread remaining props; no imports from outside `ui/` except React. In F1 these are BUILT but existing screens are NOT migrated onto them (that is F4) — the only consumers are the shell (Part 3) and UIKitchen (Part 4).

**Positioning convention:** this app is a centered 390px column — `#root` is `max-width: var(--column); margin: 0 auto`. Any `position: fixed` component (NavBar, ActionBar) must use the repo's existing centering pattern: `left: 50%; transform: translateX(-50%); width: 100%; max-width: var(--column);` — NOT `left:0; right:0`.

1. **`Button.jsx`** — props `variant: 'primary'|'outline'|'danger'` (default primary), `full`, `size: 'md'|'sm'`, native button props. CSS: min-height 46px (sm 38px), padding 12px 22px (sm 8px 16px), border-radius var(--r-pill), font-weight 700, font-size 15px (sm 13px), inline-flex centered gap 7px, `transition: transform var(--fast) var(--ease)`, `:active{transform:scale(.97)}`, `:disabled{opacity:.4}`. primary: bg var(--blue), #fff. outline: transparent, 1px solid var(--line-2), var(--fg). danger: transparent, 1px solid rgba(233,64,59,.45), var(--red). full: width 100%.
2. **`Chip.jsx`** — props `selected`, `onPress`. Pill: padding 8px 15px, radius var(--r-chip), 13px/600, 1px solid var(--line-2), color var(--fg-2), min-height 38px. selected: border-color var(--fg), color var(--fg), bg var(--card-2).
3. **`StatusTag.jsx`** — props `tone: 'green'|'red'|'yellow'|'blue'|'mute'`. 3px 10px, radius 99px, 11px/700. Each tone: its wash bg + its color (blue text uses var(--blue-lt); mute: var(--card-2) + var(--fg-2)).
4. **`Card.jsx`** — bg var(--card), 1px solid var(--line), radius var(--r-card), padding 16px. Prop `flush` removes padding (keeps overflow:hidden).
5. **`Panel.jsx`** exporting `Panel`, `PanelRow`, `PanelTotal` — the Seller-Hub earnings layout. Panel: Card surface + optional `title` (15px/700, margin-bottom 10px). PanelRow: `label`,`value` — flex space-between baseline, padding 5px 0, 14px; label var(--fg-2); value 600 with class `money`. PanelTotal: `label`,`value`,`tone:'green'|'red'` — border-top 1px solid var(--line), margin-top 8px, padding-top 11px; label 15px/700; value var(--t-earnings)/800, class `money`, color var(--green) or var(--red).
6. **`VerdictBanner.jsx`** — props `verdict:'go'|'skip'|'pencil'`, `label`, `detail`. Radius var(--r-card), padding 13px 16px, flex space-between center; label 16px/800; detail 12px/600 opacity .85. go: bg var(--green), color #0B0F02. skip: bg var(--red), #fff. pencil: transparent, 1.5px dashed var(--line-2), var(--fg-2).
7. **`ListingPreviewCard.jsx`** — props `photos` (nodes for the strip), `title`, `condition`, `price`, `obo`, `shipping`, `soldLine`, `onSoldTap`, `struck`. Card flush → photo strip (flex, gap 2px, height 150px, children flex-fill) → body padding 14px 16px: title 15px lh 1.35; condition 13px var(--fg-2) mt 3px; price 26px/800 `money` mt 8px, + " or Best Offer" 13px/400 var(--fg-2) when `obo`; when `struck`: line-through 3px var(--red), color var(--fg-2); shipping 13px var(--fg-2) mt 2px; soldLine 13px/700 var(--red) mt 7px — a `<button>` with dashed underline when `onSoldTap`, plain text otherwise.
8. **`Sheet.jsx`** — props `open`, `onClose`, `title`, children. Fixed inset dim rgba(0,0,0,.6), click = onClose; sheet fixed bottom (centered-column pattern), bg var(--card), 1px solid var(--line) minus bottom, radius 18px 18px 0 0, padding 10px 20px calc(26px + var(--safe-b)); handle 36×4 var(--line-2) centered mb 16px; title 17px/800; slide-up 300ms var(--ease); z-index 200; swipe-down >80px closes (touchstart/touchend deltaY).
9. **`Row.jsx`** — props `thumb`, `title`, `sub`, `trailing`, `onPress`. Flex gap 12px center, padding 12px 0, min-height 64px; `.ui-row + .ui-row { border-top: 1px solid var(--line); }`; title 15px/600 ellipsis; sub 13px var(--fg-2) mt 3px. Renders button when onPress, div otherwise.
10. **`Field.jsx`** exporting `Field`, `Input`, `TextArea` — Field: label via `.lbl` + optional right-aligned `hint`, column gap 6px. Input/TextArea: bg var(--card), 1px solid var(--line-2), radius var(--r-input), var(--fg), padding 12px 13px, font-size var(--t-body), min-height 46px; focus: outline none, border-color var(--blue). TextArea: min-height 78px, resize none, lh 1.5.
11. **`StatGrid.jsx`** exporting `StatGrid`, `Stat` — grid 2 cols gap 8px. Stat: Card surface padding 13px 14px; value 22px/800 `money` (prop `tone:'green'` optional); label 11px var(--fg-3)/600 mt 3px.
12. **`NavBar.jsx`** — props `tabs:[{id,label,icon,badge,badgeDot}]`, `active`, `onSelect`. Fixed bottom (centered-column pattern), height var(--nav-total), padding-bottom var(--safe-b), bg rgba(15,15,15,.86), backdrop-filter + -webkit- blur(20px), border-top 1px solid var(--line), z-index 100. Tab buttons: flex 1, column, gap 3px, 11px/500 var(--fg-3); active: var(--blue-lt), 700; `aria-current="page"` on active. Icon slot 23px in a relative wrap. badge: red numeric pill (bg var(--red), #fff, min-width 17px, height 17px, 10px/700, top −5px right −9px). badgeDot: 8px var(--blue) dot.
13. **`ActionBar.jsx`** — children. Fixed, bottom var(--nav-total) (centered-column pattern), height var(--bar-h), flex gap 8px, padding 9px var(--gutter), bg rgba(15,15,15,.92), backdrop blur(20px), border-top 1px solid var(--line), z-index 45; direct children flex 1.
14. **`FourDotMark.jsx`** — inline-flex gap 3px; four 6px circles: var(--red), var(--blue), var(--yellow), var(--green); `aria-hidden="true"`.

---

## PART 3 — Layout system migration (the shell)

1. **Nav adapter:** rewrite `Nav.jsx` to render the new `<NavBar>` — same tabs, same SVG icons, same props from App.jsx (`cartCount` → numeric badge on Cart, `hasActiveListing` → dot on Listing). Nav.css shrinks to nothing (delete it and its import) — NavBar owns all styling. Visual deltas expected and intended: cart badge turns red (was amber), safe-area padding appears, background frosts.
2. **Retoken every hardcoded bottom-chrome constant.** Targets below were verified at `b22906b` — **re-grep and re-anchor them first** (see the warning at the top; V1 edits `ShoppingMode.css`):
   - `src/App.css` line ~3, `.screen`: `padding: 16px 16px 80px` → `padding: 16px var(--gutter) calc(var(--nav-total) + 16px)`
   - `src/App.css` line ~83, toast container: `bottom: 140px` → `bottom: calc(var(--nav-total) + var(--bar-h) + 16px)`
   - `src/components/ShoppingMode.css` ~35: `min-height: calc(100dvh - 80px)` → `calc(100dvh - var(--nav-total))`
   - `ShoppingMode.css` ~61, `.verdict-page`: `padding: 12px 16px 130px` → `padding: 12px var(--gutter) calc(var(--nav-total) + var(--bar-h) + 20px)`
   - `ShoppingMode.css` ~72, `.verdict-action-bar`: `bottom: 60px` → `bottom: var(--nav-total)`; set `height: var(--bar-h)`; add the frosted treatment (bg rgba(15,15,15,.92) + backdrop blur + border-top var(--line))
   - `ShoppingMode.css` ~89, `.verdict-chat-bubble`: `bottom: calc(60px + 56px + 16px)` → `bottom: calc(var(--nav-total) + var(--bar-h) + 12px)`; keep the existing `right: max(...)` but swap literals for `var(--gutter)` and `var(--column)`
   - `src/components/ListingMode.css` ~223 (listing action bar): `bottom: 60px` → `bottom: var(--nav-total)`; same height + frost treatment
   - **Any equivalent constants in the V1-era Settings / key-detail stylesheets** — they were written in the old idiom on purpose; sweep them the same way.
   - **False positives — do NOT touch:** `DraftsMode.css` ~108 (`padding: 80px 32px` is empty-state spacing), `ShoppingMode.css` thumb sizes (`width/height: 80px`), all `margin-bottom` hits, `ListingMode.css` ~52 (`bottom: 0` inside a modal), `PreviewMode.css` padding-bottom 32px (no nav on preview).
   List every file:line changed in your summary.
3. No other screen restyling — the aliases handle the recolor automatically.

---

## PART 4 — UI Kitchen (the F1 gate)

Create `src/components/UIKitchen.jsx` (+ css): a scrollable screen rendering EVERY ui/ component in EVERY variant with realistic thrift data — Buttons (3 variants × md/sm, one full, one disabled), Chip selected/unselected, all 5 StatusTag tones, Card, a complete earnings Panel titled "Your earnings" (rows: Item price $94.50 / Selling costs −$12.82 / Shipping −$12.00 / Paid at Goodwill −$8.00; PanelTotal "You'd keep" $61.68 green), all 3 VerdictBanner verdicts, ListingPreviewCard twice (normal with a CSS-gradient div as photo, `soldLine="12 sold in the last 30 days"` tappable; and `struck` skip variant), Sheet behind an "Open sheet" button, 3 Rows with gradient thumbs + StatusTag trailings, Field+Input+TextArea, StatGrid with 4 Stats (one green), FourDotMark, and one ActionBar at the bottom with outline + primary buttons.

Register it in `src/App.jsx`:
- Add `'uikit'` to the `valid` array in the `currentScreen` lazy initializer. **Read the array from the repo rather than assuming it** — at `b22906b` it was `['shop','flip','cart','listing','history','drafts']`, and V1 will have added Settings and the key sub-view.
- Render `{currentScreen === 'uikit' && <UIKitchen />}` alongside the other screens; nav stays visible.
- No visible navigation to it — dev route is `localStorage.setItem('thrift-flip-screen','uikit')` + refresh, using the existing screen-persistence mechanism.

---

## Constraints recap

Do not touch: `src/utils/*` (storageService, stores, webhooks/ai, calculations), `src/hooks/useCart.js`, `src/hooks/useGemini.js`, `src/contexts/*`, any handler logic, the screen flow, or the tab structure. `npm run build` must pass; zero console errors at runtime.

## Verification (run after implementing)

1. `grep -rhoE 'var\(--[a-z0-9-]+' src | sort -u` — every name is defined in index.css (new set or alias block)
2. App boots → **every screen** reachable and functionally identical, recolored to the eBay dark palette (count them from the repo; it was 7 at `b22906b` and V1 added more)
3. Nav: cart badge red with count; listing dot blue; active tab var(--blue-lt); frosted background visible when content scrolls under it
4. Verdict phase: action bar flush against nav, chat bubble above it, last content scrolls fully clear
5. Toasts appear above the action bar, not behind it
6. `localStorage.setItem('thrift-flip-screen','uikit')` + refresh → UIKitchen renders every component; Sheet opens and swipe-dismisses
7. Focused inputs do not zoom the page (16px verified) — including the BYOK paste field V1 added
8. `npm run build` clean
