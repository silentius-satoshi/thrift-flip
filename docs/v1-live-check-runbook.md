# V1 live checks — the four things a real key has to answer

<!-- Status: UNRUN as of the V1+S1 commit. Nothing below has been executed. -->

V1's mechanical verification is done and green (tests, build, no-key path, error
taxonomy, Settings persistence, backup exclusion, PWA, photo downscale). The
checks in this file need a **real Gemini key and real thrift items**, so they
ride with the first trip rather than the build.

**Do not record V1's gate as passed until §1 and §2 below are filled in.**
Vision §7 makes both part of the gate; plan §6.2 explains why they moved here
when V0 was skipped.

Setup, once: Settings (key icon in the Selling header) → *Add your AI key* →
paste → "Connected — verdicts are live".

---

## 1. The five core items — identification

Shoot each through the app. One item per run, capture → notes → condition →
Goodwill price → **Get the verdict**.

**Gate: at least 4 of 5 correct on brand + model.** Brand right, model wrong
counts as *partial*, not correct.

| # | Item | What it actually is | Model's ID | Correct? | Model confidence |
|---|---|---|---|---|---|
| 1 | Sneaker | | | Y / partial / N | high / med / low |
| 2 | Book | | | Y / partial / N | high / med / low |
| 3 | Tool | | | Y / partial / N | high / med / low |
| 4 | Mug | | | Y / partial / N | high / med / low |
| 5 | Vintage electronics | | | Y / partial / N | high / med / low |

Also worth noting as you go: did any response need cleanup to parse? It should
not — the schema is enforced with `responseMimeType` + `responseSchema`, and
there is no cleanup code anywhere in the path. A parse failure shows as
"Odd reply from the model — try again", and if that appears, capture the item.

---

## 2. The anchoring test — two minutes, and it outranks everything else

Pick **one mid-difficulty item**. Run it twice with **identical photos and
notes**, changing only the stated Goodwill price.

| Run | Stated Goodwill price | `pricing.estimate` shown |
|---|---|---|
| A | $4 | |
| B | $30 | |

**Read it this way:** if the estimate moves meaningfully between A and B, the
model is pricing off what you're about to pay rather than off the market. Every
verdict would then be circular — it would tell you an item is worth 3× whatever
is on the sticker. That is the most dangerous failure mode in this pipeline and
nothing else tests for it.

**If it fails, the fix is one line.** In `src/utils/ai.js`, `buildUserMessage`
ends with the price line, marked:

```js
`Goodwill price: $${Number(goodwillPrice).toFixed(2)}`, // ANCHORING: delete this line if the test fails
```

Delete that line. The price is still used everywhere it matters — `calcProfit`,
`checkRules`, `pencilFloor` are all client-side and never involve the model.

Result: ☐ estimate held steady (pass) ☐ estimate moved → price line removed

---

## 3. First confidence-calibration pass

From the first ~10 real analyses, check that `confidence: high` answers are
actually more accurate than `low` ones. Ground truth is eBay → search the item →
filter **Sold items** → median of the last ~10 comparable sales (~30 seconds
each; the Why sheet's "See sold listings on eBay" button opens exactly that
search for you).

| # | Item | Model estimate | Real sold median | Within range? | Model confidence |
|---|---|---|---|---|---|
| 1 | | $ | $ | Y / N | high / med / low |
| 2 | | $ | $ | Y / N | high / med / low |
| 3 | | $ | $ | Y / N | high / med / low |

*(rows 4–10 the same)*

**What matters is the sort, not the average.** Sort by stated confidence and
check accuracy falls as confidence falls. A model that is wrong and says `low`
is usable — the pencil tag and the eBay link cover it. A model that is wrong and
says `high` is dangerous, because the verdict screen stamps it.

**If `high` is not meaningfully more accurate than `low`,** that finding outranks
the raw accuracy score: the UI should treat every estimate as low-confidence
until V2's comps ladder lands. The banner already carries the confidence word
whenever it isn't `high`, so the change is small.

Result: ☐ calibration holds ☐ does not hold → treat all estimates as low

---

## 4. Kill the key

In [aistudio.google.com/apikey](https://aistudio.google.com/apikey), delete the
key the app is using. Then run one more analysis.

Expected: the pencil tag still renders with its floor, the specific copy
*"That key didn't work — check the paste caught the whole thing"* appears with a
**Check your AI key** button, and Skip / Add to cart both still work. No generic
error, no dead end.

*(This path is verified mechanically against a stubbed 403; this run confirms
Google returns what we assume on a revoked key.)*

Result: ☐ pass ☐ fail — what appeared instead:

---

## What is already verified, so you don't re-run it

Green in the V1+S1 build, headlessly: `npm test` (20 specs on `calcProfit`,
`checkRules`, `pencilFloor` incl. the $46.50 case); the no-key path end-to-end;
all four error codes rendering their specific copy while Add-to-cart keeps
working; Settings and the key sub-view surviving refresh; the key masked to
last-4 and never rendered, logged, or exported; backup excluding
`thrift-flip-ai-key` and import restoring a cart; PWA manifest/icons/metas; a
27MB photo storing at 204KB after downscale.
