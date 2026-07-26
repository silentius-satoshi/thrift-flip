# Thrift Flip — Front-End Design Spec v2
### eBay design language, dark mode, built as a component layer — not a reskin
### Supersedes v1 (warm graphite / paper tag). Reference prototype: `thrift-flip-design-v3-1-ebay.html`
### Repo: `silentius-satoshi/thrift-flip` · Target: iOS Safari PWA, 390pt column
### §3, §4, §6, §8, §10 amended July 2026 for the resequencing — **the whole F-track now runs after V1 and after the first real trip** (`thrift-flip-plan.md` §6)

---

## 1. Design Thesis

**The app dresses like the platform he sells on.** Dad reads eBay Seller Hub every week; his mental models for "a listing," "an earnings breakdown," and "a sold item" are already formed. v1's paper-tag direction was distinctive; this direction is *familiar*, and for a 60-something single user making money decisions at arm's length, familiar wins. The learning curve becomes zero because the numbers look like the numbers he already trusts.

**Adopt the language, refuse the skeleton.** eBay's visual grammar — pill buttons, bold prices, red sold-counts, hairline-divided panels — comes over wholesale. eBay's information architecture does not: their app is a marketplace *browser* (search-first, feeds, infinite listings, built for buyers); Thrift Flip is a *decision instrument* (camera → verdict → cart → list → selling, built for one seller). Same clothes, different body.

**The deeper honesty:** the vision pipeline returns the full listing fields at analyze time, so the verdict rendered as a listing preview isn't styling — it's the interface telling the truth. What he sees in the aisle *is* the draft he'll send.

**Trademark line (keep it clean):** we borrow *conventions* — pill buttons, an earnings-panel layout, red social-proof counts. We never use eBay's marks: no logo, no "Buy It Now" verbatim on our controls, no eBay logotype colors as a wordmark. The four-dot header mark is dots, not their logo. Conventions aren't ownable; marks are.

---

## 2. Token System

Drop-in `:root` for `src/index.css`. Everything below is referenced by name in §4–§6. **None of it exists until F1**, which now runs after V1 — so anything V1 ships is hand-rolled in the old idiom and folded in later (§10).

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
- **Inputs stay 16px** (`--t-body`) — the iOS focus-zoom rule is unchanged and non-negotiable. **Until F1 raises the 15px base, every new input needs an explicit `font-size: 16px`** — an input left at the current base zooms the page just as surely as a smaller one. V1's BYOK paste field is the first to hit this.
- The four logo-colored dots (`--red --blue --yellow --green`, 6px) appear as a header mark **at most once per screen**.

---

## 3. The Signature — two panels he already knows

v1 spent its boldness on a paper price tag. v2 spends it on recognition:

**A. The listing-preview verdict.** The analyze result renders as an eBay search-result card: photo strip, plain-weight title, `Pre-owned · Good`, bold price with *or Best Offer*, shipping line, and the red `12 sold in the last 30 days` — which doubles as the tap-target for provenance. He is literally previewing his own future listing while deciding whether to buy the item.

**B. The "Your earnings" panel.** The profit math is laid out exactly as Seller Hub's earnings breakdown: label/amount rows in `--fg-2`/`--fg`, hairline divider, then **You'd keep** with the total in `--t-earnings` green. The 3×/$20 rule checks sit under it as green checks. This is the panel eBay shows him *after* a sale; Thrift Flip shows it *before* the purchase. That inversion is the product, and the styling makes it legible instantly.

The pencil (offline) state reuses panel B with a dashed no-color banner ("Your call for now — figured on this phone") and the inverted question: **What it must sell for — $46.50 or more.** Same component, `variant="pencil"` — **at F2. V1 ships this state first, hand-rolled on the existing `VerdictCard` with no `ui/` component and no tokens** (§10), because the pencil math was pulled forward and the component layer was pushed back. F2 is where the two meet.

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

**Two notes the resequencing adds.** First, **F1 is the F-step that moved** — from first in the whole plan to after V1 and T1 (plan §5 lists "F1-first sequencing" as superseded); F2/F3/F4 kept their positions relative to it, and the A-track moved *inward* to sit between F2 and F3 (§10). Second, that reordering is safe precisely because **this inventory is structure-agnostic**: every component above is a primitive that serves the current five-tab app and the four-tab camera-first app equally, so F1 can be built before the structural question is answered. The migration that follows it is what must wait for the answer. Note also that F4 now has two screens to migrate that this table did not originally anticipate — the Settings screen and the AI-key detail sub-screen, which V1 builds (plan §6.1); both are `Row`- and `Field`-shaped and need no new components.

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

**These redlines describe the app's current structure, and whether that is still its structure by migration time is an open question with a scheduled answer.** The v3 structural moves (camera-first Buy, 4 tabs) are gated on the first real trip, T1 (`thrift-flip-plan.md` §6.3) — which happens *before* any of this migration. If T1 endorses camera-first, the A-track lands between F2 and F3 and this table is re-cut before F4 runs; if it doesn't, the table stands. Either way the composition per screen barely changes, because the components are the same ones either structure is assembled from. *(The pencil verdict was formerly listed among the A-track structural moves; its math and an interim render now ship at V1 — see §10.)*

---

## 7. Motion

eBay's app is nearly motionless, and that's correct here too. Keep: screen cross-fade 240ms, sheet slide-up 300ms, button press `scale(.97)`, verdict banner one 300ms scale-in on arrival (first arrival only). Nothing else. `prefers-reduced-motion` collapses all of it. The v1 stamp-spring and band-strike are retired with the paper tag.

---

## 8. Platform / PWA

Manifest (`display: standalone`, `background_color/theme_color: #0F0F0F`), apple-touch-icon, `black-translucent` status bar, `viewport-fit=cover`. Icon: the four-dot mark on `--bg`.

**This ships early, not late.** It was F5, at the end of the F-track; it moved to **S1**, alongside V1 and before the first trip (`thrift-flip-plan.md` §6), for a plain reason — he needs to launch this from his home screen like an app, not hunt for a Safari tab in a Goodwill aisle. **S1 therefore owns the `index.html` viewport and `theme-color` edits, and F1's corresponding step becomes verify-and-skip.** The icon uses the four-dot mark on `#0F0F0F` even though the eBay-dark palette formally arrives at F1; the value is a constant either way, so nothing has to be redone.

---

## 9. Accessibility Floor

Carried from v1 with palette-specific checks:
- `--fg-2 #A8A8A8` on `--card #1B1B1B` ≈ 7.9:1 ✓ · `--fg-3 #6E6E6E` on `--card` ≈ 3.9:1 — **use `--fg-3` at ≥13px only**, labels at 11px take `--fg-2`
- `--green #86B817` on `--card` ≈ 5.6:1 ✓ for the earnings total; `--blue-lt` (not `--blue`) for text links on dark
- `vb-go` banner: `--green` bg with near-black text ✓; `vb-skip`: `--red` bg + white — pair every banner with its verdict word, never color alone
- 16px inputs, 44px targets, `:focus-visible` ring in `--blue-lt`, `aria-current` on nav, `role="status"` toasts, tabular figures for all money
- **The focus ring is an F1 global.** V1's new screens should hand-roll a visible focus style rather than shipping none and waiting.

---

## 10. Build Order

**The whole F-track now runs after V1 and after the first real trip** (`thrift-flip-plan.md` §6). Nothing below changed in content; the sequence around it did, and one step moved out of it in each direction — the PWA manifest moved *earlier* (§8), the pencil math moved *earlier still* (to V1), and the A-track moved *inward*, ahead of the bulk migration.

**F1 — Tokens + component layer.** New `:root`, `ui/` inventory complete (§4 table), layout system (§5). No screen visually migrated yet beyond what the shell forces. Safe to build before the structural question is answered, because the components are structure-agnostic (§4).

> ⚠ **Re-verify `claude-code-prompt-F1.md` before running it.** The prompt is substantively correct and its token/alias work self-heals via its own re-grep step, but it is pinned to commit `b22906b` and **V1/S1 will move five things in it**: the `ShoppingMode.css` file:line targets (V1 edits that file for the pencil render), the `valid` screen array (V1 adds Settings and the key sub-view), the "all 7 screens" verification count, Part 1's `index.html` viewport/theme-color edit (now S1's, §8), and the V1-era stylesheets that need folding into the alias sweep. The prompt itself carries this warning at the top. Earlier drafts of the plan asserted it was "still correct line-for-line" — that was wrong.

*Gate:* a scratch route renders every `ui/` component in all variants; nav clears the home indicator on-device; inputs don't zoom; `grep -rn "60px\|80px\|130px\|140px" src/components/*.css` returns nothing layout-related.

**F2 — The verdict.** ShoppingMode verdict phase rebuilt as `VerdictBanner + ListingPreviewCard + Panel` (go/skip/pencil variants all render). Now informed by T1 — if the trip showed the verdict is unreadable at arm's length or that he only looks at one number, fix that here rather than shipping the redline unexamined.
*Gate:* verdict screen contains zero bespoke CSS for buttons/cards/money rows; skip state readable in greyscale (banner word + struck price, not hue alone); the pencil variant renders from the same data V1's interim render used, and **V1's hand-rolled pencil styling is deleted in this step**.

**A-track — the structural decision (conditional, runs here or not at all).** Camera-first Buy and the 4-tab consolidation, assembled from the F1 components. **Its gate is T1** — no longer "post-migration." It sits between F2 and F3 for one reason: F4 migrates every screen onto the component layer, and migrating them into a structure the trip already showed to be wrong means doing that work twice. Decide here, migrate once. Still separately approved before it starts.
*Gate:* the four-tab shell and camera-first Buy run on real data end-to-end; a second trip confirms it beats the current form-first flow, or it is reverted. If T1 was ambiguous, take another trip rather than guessing.

**F3 — Chrome.** NavBar/ActionBar frosted + safe-area, History→Selling rename, four-dot mark, all emoji→SVG. Plus any PWA leftovers not covered by S1 (§8).
*Gate:* tab through every screen with visible focus; no emoji in `src/` (`grep -P "[\x{1F300}-\x{1FAFF}]"` empty).

**F4 — Screen migration.** Every remaining screen onto the layer per §6 — in whatever structure the A-track settled, and including V1's Settings and key-detail screens; per-screen CSS reduced to layout glue.
*Gate:* the §4 grep rule holds repo-wide; visual pass on-device against the v3.1 prototype.

**~~F5 — PWA.~~** Absorbed into S1, before the first trip (§8). Leftovers ride with F3.

**Not in the F-track: the pencil verdict math.** It was A-track work and has been **pulled forward into V1** (`thrift-flip-plan.md` §6.1), because vision §2.5's no-key completion gate depends on it. V1 ships the arithmetic plus a hand-rolled pencil state on the *existing* `VerdictCard` — no `ui/` component and no tokens, since **V1 now runs before F1 and neither exists yet**. F2 replaces that render and deletes the interim styling.

---

## 11. Out of Scope

Light mode (Preview's buyer-view inversion is the only light surface) · Market Sans licensing (system stack is the ship default) · component library imports (the `ui/` layer *is* the library — 14 small files, zero deps) · the A-track structural changes (specced, gated on T1 and approved separately) · any eBay mark, logotype, or verbatim product name on controls.
