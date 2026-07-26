# Thrift Flip — Front-End Design Spec v2
### eBay design language, dark mode, built as a component layer — not a reskin
### Supersedes v1 (warm graphite / paper tag). Reference prototype: `thrift-flip-design-v3-1-ebay.html`
### Repo: `silentius-satoshi/thrift-flip` · Target: iOS Safari PWA, 390pt column
### §3, §4, §6, §8, §10 amended July 2026 — **F1 runs first, F2 absorbs the A-track's four-tab restructure, and the five-tab intermediate is never built** (`thrift-flip-plan.md` §6)

---

## 1. Design Thesis

**The app dresses like the platform he sells on.** Dad reads eBay Seller Hub every week; his mental models for "a listing," "an earnings breakdown," and "a sold item" are already formed. v1's paper-tag direction was distinctive; this direction is *familiar*, and for a 60-something single user making money decisions at arm's length, familiar wins. The learning curve becomes zero because the numbers look like the numbers he already trusts.

**Adopt the language, refuse the skeleton.** eBay's visual grammar — pill buttons, bold prices, red sold-counts, hairline-divided panels — comes over wholesale. eBay's information architecture does not: their app is a marketplace *browser* (search-first, feeds, infinite listings, built for buyers); Thrift Flip is a *decision instrument* (camera → verdict → cart → list → selling, built for one seller). Same clothes, different body.

**The deeper honesty:** the vision pipeline returns the full listing fields at analyze time, so the verdict rendered as a listing preview isn't styling — it's the interface telling the truth. What he sees in the aisle *is* the draft he'll send.

**Trademark line (keep it clean):** we borrow *conventions* — pill buttons, an earnings-panel layout, red social-proof counts. We never use eBay's marks: no logo, no "Buy It Now" verbatim on our controls, no eBay logotype colors as a wordmark. The four-dot header mark is dots, not their logo. Conventions aren't ownable; marks are.

---

## 2. Token System

Drop-in `:root` for `src/index.css`. Everything below is referenced by name in §4–§6. **F1 is the first build step**, so every later step composes against these tokens rather than working around their absence.

```css
:root{
  /* Surfaces — eBay dark */
  --bg:#0F0F0F; --card:#1B1B1B; --card-2:#242424;
  --line:#2E2E2E; --line-2:#3E3E3E;

  /* Text */
  --fg:#F7F7F7; --fg-2:#A8A8A8; --fg-3:#6E6E6E;

  /* Brand + meaning. Blue = action. Green = profit. Red = sold-counts & skip. Yellow = pending. */
  --blue:#3665F3; --blue-lt:#6592FD;
  --green:#86B817; --red:#E9403B; --yellow:#F5AF02;
  --green-wash:rgba(134,184,23,.14); --red-wash:rgba(233,64,59,.14);
  --yellow-wash:rgba(245,175,2,.14); --blue-wash:rgba(54,101,243,.16);

  /* Type — Market Sans if ever licensed; system stack is the honest default */
  --font:"Market Sans",-apple-system,BlinkMacSystemFont,"Helvetica Neue","Segoe UI",Arial,sans-serif;
  --t-label:11px; --t-sub:13px; --t-body:16px; --t-title:21px;
  --t-price:26px; --t-earnings:22px; --t-hero:34px;

  /* Shape — eBay's pills and cards */
  --r-pill:24px; --r-card:12px; --r-chip:20px; --r-input:8px;

  /* Layout — single source of truth (carried from v1; this system stays) */
  --nav-h:56px; --bar-h:64px;
  --safe-b:env(safe-area-inset-bottom,0px);
  --nav-total:calc(var(--nav-h) + var(--safe-b));
  --gutter:16px; --column:390px;

  /* Motion */
  --ease:cubic-bezier(.32,.72,0,1); --fast:150ms; --base:240ms;
}
```

Rules that ride with the tokens:
- **Money:** bold weight (700–800) in the UI face, `font-variant-numeric: tabular-nums` everywhere a dollar figure appears (columns must align even in proportional type). Sizes: `--t-price` on listing previews, `--t-earnings` on panel totals, `--t-hero` on the pencil floor figure — *hardcode the equivalent at V1, since the token arrives with F1.*
- **Blue is action, never information.** Links, primary buttons, tappable numbers. A blue that isn't tappable is a bug.
- **Red means "sold" or "no."** The sold-count line and skip surfaces only — never decoration, never warnings-in-general (those are yellow).
- **Inputs stay 16px** (`--t-body`) — the iOS focus-zoom rule is unchanged and non-negotiable. The repo's base is 15px today (`index.css` line 41), which zooms the page just as surely as a smaller value; F1's `html, body` rule is what fixes it, and because F1 goes first no later step needs a per-input workaround.
- The four logo-colored dots (`--red --blue --yellow --green`, 6px) appear as a header mark **at most once per screen**.

---

## 3. The Signature — two panels he already knows

v1 spent its boldness on a paper price tag. v2 spends it on recognition:

**A. The listing-preview verdict.** The analyze result renders as an eBay search-result card: photo strip, plain-weight title, `Pre-owned · Good`, bold price with *or Best Offer*, shipping line, and the red `12 sold in the last 30 days` — which doubles as the tap-target for provenance. He is literally previewing his own future listing while deciding whether to buy the item.

**B. The "Your earnings" panel.** The profit math is laid out exactly as Seller Hub's earnings breakdown: label/amount rows in `--fg-2`/`--fg`, hairline divider, then **You'd keep** with the total in `--t-earnings` green. The 3×/$20 rule checks sit under it as green checks. This is the panel eBay shows him *after* a sale; Thrift Flip shows it *before* the purchase. That inversion is the product, and the styling makes it legible instantly.

The pencil (offline) state reuses panel B with a dashed no-color banner ("Your call for now — figured on this phone") and the inverted question: **What it must sell for — $46.50 or more.** Same component, `variant="pencil"`. **F2 builds it against mock data; V1 later supplies the arithmetic behind it** (plan §6.1 carries the derived formula, and the $46.50 example is `goodwillPrice = 8, shipping = 12` — not `calcProfit`'s $5 default).

---

## 4. The Real Overhaul — a component layer, not thirteen stylesheets

The current repo has ~13 per-component CSS files, each hand-rolling buttons, pills, cards, and its own guess at layout constants — which is why the verdict-screen bugs took six passes. F1 does not restyle those files; it **replaces them underneath** with a shared layer, then screens migrate onto it.

`src/components/ui/` — the complete inventory, mapped to the prototype:

| Component | Props (shape) | Used by |
|---|---|---|
| `<Button>` | `variant: primary\|outline\|danger`, `full`, `size` | everywhere |
| `<Chip>` | `selected`, `onPress` | condition picker, distribution row, filters |
| `<StatusTag>` | `tone: green\|red\|yellow\|blue\|mute` | cart states, ledger states, drafts |
| `<Card>` | padded container, `--r-card`, hairline border | everywhere |
| `<Panel>` / `<PanelRow>` / `<PanelTotal>` | the earnings layout | verdict, pencil, listing "You'd keep", skip |
| `<ListingPreviewCard>` | `photos, title, condition, price, obo, shipping, soldLine, onSoldTap` | verdict, skip, (later) drafts |
| `<VerdictBanner>` | `verdict: go\|skip\|pencil`, `detail` | verdict, pencil, skip |
| `<Sheet>` | bottom sheet: handle, dim, slide-up | provenance, save-draft, conflict modal |
| `<Row>` | thumb + title/sub + trailing slot, 64px min | cart, ledger, **settings**, flip list |
| `<Field>` / `<Input>` / `<TextArea>` | label + control, 16px, focus ring | shopping form, listing, **BYOK** |
| `<StatGrid>` / `<Stat>` | 2×2 metrics | selling overview, sell velocity |
| `<NavBar>` | tabs, badges, frosted, safe-area | app shell |
| `<ActionBar>` | fixed above nav, frosted | verdict, listing |
| `<FourDotMark>` | the header mark | headers |

Rules:
- **No screen-level CSS may define a button, pill, card, input, or money row.** Grep-enforceable: after migration, `border-radius` and `padding` on interactive elements exist only under `ui/`.
- Components own their variants; screens own composition only.
- The old per-screen CSS files shrink to layout glue and are deleted where empty.

This is a ~1-day investment that converts every future screen (and the aisle restructure) from CSS archaeology into assembly.

**Why F1 goes first, and why that is safe.** The inventory above is deliberately **structure-agnostic**: every component is a primitive that serves the current five-tab app and the four-tab camera-first app equally well. That is what lets F1 be built before anything structural happens — and it is why F2 can then assemble the *new* shell from these parts rather than restyling the old one. Two later screens land on this layer without needing new components: the Settings screen and the AI-key detail sub-screen that V1 adds (plan §6.1) are `Row`-, `Field`- and `Button`-shaped, and because they are written *after* F1 they compose rather than migrate.

---

## 5. Layout System

Carried from v1 verbatim in spirit — it was correct and unbuilt:
`--nav-total` as the single bottom constant; `.screen` / `.screen--barred` padding derived from it; `<ActionBar>` at `bottom: var(--nav-total)`; toast above the bar; hairlines rendered at 0.5px via `transform: scaleY(.5)`; frosted `backdrop-filter` on NavBar/ActionBar. Every hardcoded `60px/80px/130px/140px` in the repo dies in F1 — **including any that V1's new stylesheets introduce**, since they are written in the old idiom on purpose. `viewport-fit=cover` is the exception: S1 ships it before F1 (§8), so F1 verifies rather than adds it.

---

## 6. Screen Redlines (the app as it stands, on the new layer)

| Screen | Composition |
|---|---|
| Shopping (form phase) | `Field`×3 + photo thumbs + `Button primary full` — unchanged flow, new skin |
| Shopping (verdict) | `VerdictBanner` + `ListingPreviewCard` + `Panel(earnings)` + SellVelocity as `StatGrid`+sold `Row`s + advisor card + `ActionBar` (Skip = danger outline, Add to cart = primary) |
| Flip | `Row`s with 36px avatar, `StatusTag` trailing; swipe actions keep v1 mechanics, colors → `--red`/`--fg-3` |
| Chat | bubbles: me = `--blue`, AI = `--card` + hairline; composer 46px, blue circular send |
| Cart | `Card` of `Row`s, "List it" = outline pill; trip total as `PanelTotal` |
| Listing | `Field`s + "You'd keep" `PanelTotal` + distribution `Chip` row (eBay · Copy for Mercari · Vendoo) + `ActionBar` (Preview outline / **List it on eBay** primary) |
| Preview | stays an inversion — light surface, since it renders the buyer's view; reuse `ListingPreviewCard` at full width on `#FFF`/`#F7F7F7` |
| Drafts | `Row`s + `StatusTag` (Saved = blue, Auto-saved = yellow), Remove keeps double-tap with `--red-wash` pending fill |
| **Settings** *(new — built at V1)* | `Row`s under section headers; "Your keys" section with the Verdicts row and, later, the eBay row |
| **AI-key detail** *(new — built at V1)* | `Field` + `Button`s (Test / Replace), `Row` for revoke help, plus the interim risk note while the key is plaintext |
| History → **Selling** | rename the tab. `StatGrid` (90-day: Listed / Earnings / Sold / Avg-to-sell) + Sold `Row`s with green `+$` trailing + Working section |
| Toasts | `--card` + hairline; success/error tint via wash tokens |

**These redlines describe the five-tab app, which is not the app being built.** The Founder chose to build straight to the destination: **F2 assembles the v3.1 four-tab camera-first shell** from F1's components, and the five-tab intermediate is never constructed (`thrift-flip-plan.md` §6). Read the table as a per-screen composition reference — *what a Cart row is made of, what the Listing editor is made of* — not as an IA. The four-tab mapping comes from `thrift-flip-design-v3-1-ebay.html`, which is the structural reference of record; where this table and the prototype disagree about **where** a screen lives, the prototype wins, and where they disagree about **what it is built from**, this table wins. Settings and the AI-key detail screen are additions V1 makes behind a header entry point, not tabs. *(The pencil verdict was formerly listed among the A-track structural moves; F2 builds its render and V1 supplies the math — §10.)*

---

## 7. Motion

eBay's app is nearly motionless, and that's correct here too. Keep: screen cross-fade 240ms, sheet slide-up 300ms, button press `scale(.97)`, verdict banner one 300ms scale-in on arrival (first arrival only). Nothing else. `prefers-reduced-motion` collapses all of it. The v1 stamp-spring and band-strike are retired with the paper tag.

---

## 8. Platform / PWA

Manifest (`display: standalone`, `background_color/theme_color: #0F0F0F`), apple-touch-icon, `black-translucent` status bar, `viewport-fit=cover`. Icon: the four-dot mark on `--bg`.

**This is split across two steps.** `viewport-fit=cover` and `theme-color` are part of **F1**'s `index.html` edit, because the layout system in §5 depends on the viewport meta and F1 is where that system lands. The rest — manifest, icons, `standalone`, the `black-translucent` status bar — ships with **S1** alongside V1 (`thrift-flip-plan.md` §6), early enough that Dad launches the finished app from his home screen rather than hunting for a Safari tab. It was formerly F5 at the very end of the F-track; nothing is gained by waiting. The icon uses the four-dot mark on `#0F0F0F`, a constant either way.

---

## 9. Accessibility Floor

Carried from v1 with palette-specific checks:
- `--fg-2 #A8A8A8` on `--card #1B1B1B` ≈ 7.9:1 ✓ · `--fg-3 #6E6E6E` on `--card` ≈ 3.9:1 — **use `--fg-3` at ≥13px only**, labels at 11px take `--fg-2`
- `--green #86B817` on `--card` ≈ 5.6:1 ✓ for the earnings total; `--blue-lt` (not `--blue`) for text links on dark
- `vb-go` banner: `--green` bg with near-black text ✓; `vb-skip`: `--red` bg + white — pair every banner with its verdict word, never color alone
- 16px inputs, 44px targets, `:focus-visible` ring in `--blue-lt`, `aria-current` on nav, `role="status"` toasts, tabular figures for all money
- **The focus ring is an F1 global**, so every screen built after F1 — including V1's Settings and key-detail screens — inherits it for free.

---

## 10. Build Order

**F1 is the first build step in the whole project** (`thrift-flip-plan.md` §6), and the A-track has been folded into F2. Nothing below changed in content; two things changed in shape — the PWA work split between F1 and S1 (§8), and the four-tab restructure stopped being a separate gated step.

**F1 — Tokens + component layer.** New `:root`, `ui/` inventory complete (§4 table), layout system (§5), the `index.html` viewport + `theme-color` edit (§8). No screen visually migrated yet beyond what the shell forces. Safe to build before anything structural because the components are structure-agnostic (§4). **`claude-code-prompt-F1.md` is valid exactly as written** — every file:line target in it was re-read out of the working tree at `b22906b` (plan §3.1).
*Gate:* a scratch route renders every `ui/` component in all variants; nav clears the home indicator on-device; inputs don't zoom; `grep -rn "60px\|80px\|130px\|140px" src/components/*.css` returns nothing layout-related.

**F2 + A — The verdict, and the shell it lives in. One step.** The verdict phase rebuilt as `VerdictBanner + ListingPreviewCard + Panel` (go/skip/pencil, all data-driven against mock data), **and** the v3.1 four-tab camera-first structure, both assembled from F1's components. These merged because they are the same work: the verdict is the payoff screen of the camera-first flow, and building it inside the old five-tab form-first shell would mean building it twice. **Build against `thrift-flip-design-v3-1-ebay.html`**, not from improvisation — it is the structural reference of record (§6).
*Gate:* four tabs, camera-first Buy reaching a rendered verdict end-to-end on mock data; verdict screen contains zero bespoke CSS for buttons/cards/money rows; skip state readable in greyscale (banner word + struck price, not hue alone); the pencil variant renders from data with the arithmetic still stubbed — V1 supplies it later.

**F3 — Chrome.** NavBar/ActionBar frosted + safe-area, History→Selling rename, four-dot mark, all emoji→SVG (`App.jsx` line 134 has a live one).
*Gate:* tab through every screen with visible focus; no emoji in `src/` (`grep -P "[\x{1F300}-\x{1FAFF}]"` empty).

**F4 — Screen migration.** Every remaining screen onto the layer per §6 — Flip, Cart, Listing, Drafts, Selling, Preview, Chat — into the structure F2+A settled; per-screen CSS reduced to layout glue; legacy aliases deleted. V1's Settings and key-detail screens need no migration: they were composed from `ui/` when they were written.
*Gate:* the §4 grep rule holds repo-wide; visual pass on-device against the v3.1 prototype.

**~~F5 — PWA.~~** Split: viewport and `theme-color` into F1, manifest and icons into S1 (§8).

**~~A-track.~~** Merged into F2+A above. It is no longer a separate approval gate — the trade-off, and its one risk, are recorded in plan §6.1.

**Not in the F-track: the pencil verdict math.** F2+A builds the pencil *render*; the arithmetic lands with **V1** (`thrift-flip-plan.md` §6.1 carries the derived formula), because vision §2.5's no-key gate depends on it. There is no interim render and nothing to delete later — the ordering was changed specifically to remove that step.

---

## 11. Out of Scope

Light mode (Preview's buyer-view inversion is the only light surface) · Market Sans licensing (system stack is the ship default) · component library imports (the `ui/` layer *is* the library — 14 small files, zero deps) · the A-track structural changes (specced, gated on T1 and approved separately) · any eBay mark, logotype, or verbatim product name on controls.
