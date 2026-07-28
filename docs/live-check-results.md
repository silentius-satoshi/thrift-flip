# Live-check results

_Generated 2026-07-28T03:48:01.444Z by `scripts/live-check.mjs` against `fixtures/live/`._
_Model: `gemini-3.6-flash`. Items: 5. Grounded search queries billed: 0._

## Gate — the five core items (v0 §6 sheet, both arms)

**FAIL** — 2/5 core items correct on brand+model (need 4 of 5).

| # | Item | Ungrounded ID | Grounded ID | Condition | Est. (ungrounded) | Est. (grounded) | Real sold median | Within range U/G | Shipping est. | ID confidence | Registers | Search queries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | book | Berkley ISBN 0-425-10181-9 (partial) | error: `quota` | Acceptable | $5.00 | — | ⟵ fill from eBay sold filter | — / — | $4.13 | high | eBay / Mercari | — |
| 2 | electronics | Samsung EJ-B3400UBEGUS (correct) | error: `quota` | Like New | $25.00 | — | ⟵ fill from eBay sold filter | — / — | $6.00 | high | eBay / Mercari | — |
| 3 | mug | error: `bad-response` | error: `quota` | — | — | — | ⟵ fill from eBay sold filter | — / — | — | — | — | — |
| 4 | sneaker | error: `bad-response` | error: `quota` | — | — | — | ⟵ fill from eBay sold filter | — / — | — | — | — | — |
| 5 | tool | Hyper Tough 24-Inch Poly Level (correct) | error: `quota` | Good | $8.00 | — | ⟵ fill from eBay sold filter | — / — | $7.50 | high | eBay / Mercari | — |

Sold-range hit rate — ungrounded **no ground truth yet**, grounded **no ground truth yet**.

**Shipping est.** is `pricing.shipping_estimate` after M2's [4, 100] clamp — the
figure the verdict actually spends now that the capture screen no longer asks
for one. It is **unscored**: the fixtures have no weighed postage to score it
against, so read the column for anything absurd rather than for a percentage.

## Calibration — does stated confidence track accuracy?

What matters is the sort, not the average: accuracy should fall as confidence falls.
If `high` is not meaningfully more accurate than `low`, that finding outranks the
accuracy score and the UI should treat every estimate as low-confidence until V2.

**Ungrounded**

| Stated confidence | correct | partial | wrong | accuracy |
|---|---|---|---|---|
| high | 2 | 1 | 0 | 67% |

**Grounded**

_No successful calls in this arm._

## Anchoring test

_Inconclusive: the run failed with `bad-response`._

## Tier-A decision inputs

**(a) Do the grounded sources point at real sold listings?**
_No sources returned — either the grounded arm did not run, or the model answered without searching._

**(b) Terms-of-service posture.** Grounding's terms require Grounded Results to be
displayed together with the Search Suggestions from `searchEntryPoint`, forbid
modifying or interspersing them, and forbid collecting them by automated means.
Parsing grounded output into the app's own verdict UI is in tension with that.
Two mitigations worth weighing before tier A changes: the Why sheet already has a
natural slot to render `searchEntryPoint` natively, which would satisfy the
display requirement; and this harness is a one-off measurement on the owner's own
key, which is a different posture from shipping it. **Hosted-tier (EH) compliance
is a separate and stricter question than a single user's own key** — a hosted
service redistributing grounded results to other people's screens has to satisfy
the display and no-collection clauses on every one of them.

**(c) Cost.** Grounding has **no free tier** on Gemini 3.x. Paid tier includes
5,000 prompts/month free (shared across all Gemini 3 models), then **$14 per
1,000 search queries** — billed per query executed, not per request, so one item
can burn several. This run executed **0** search queries.
SerpApi credits consumed: **4** (free plan allows 250/month).

## Manual remainder:

- Sold medians were filled automatically; spot-check one against eBay to confirm the query matched the right item.
- **Kill the key** (runbook §4) — delete the key in aistudio.google.com/apikey, then run one analysis in the app. Expect the pencil tag to still render with the "That key didn't work" copy and a working Add to cart. Inherently manual; no harness can revoke a key for you.
- **The comparison bar** (plan §6.3) — run a few of these items through the Gemini app the way you do today. The test is beating that habit, not beating nothing.

---

## Read-out

**This run did not produce the data it was for, and the reason is more useful
than a retry would be.**

**Which arm identified better — unanswerable.** The grounded arm returned
`quota` on all five items and executed **zero** search queries. Section (c)
above says why, and it is not a transient cap: **grounding has no free tier on
Gemini 3.x.** A key without billing enabled for it cannot reach the grounded arm
at all, so re-running tomorrow on this key produces this same table. The
grounded-vs-ungrounded comparison H1 was built for is still unmeasured, and the
blocker is an account setting, not the weather.

**Which arm priced closer to sold reality — also unanswerable.** SerpApi
returned **HTTP 503 four times** and "no results" once, so there are no sold
medians and both hit-rate cells read *no ground truth yet*. Four credits were
spent for nothing. Worth checking whether that account is live before anyone
schedules a repeat.

**Did grounding earn its latency and cost — it never got to try.** The one thing
this run does contribute to the tier-A file is the *precondition*: tier A via
grounding requires paid-tier billing, at $14 per 1,000 queries billed per query
executed rather than per item. That sits beside the ToS posture already recorded
in (b). The decision stays open, and it stays the plan's to make.

### What actually surprised me

**The ungrounded arm — the one that ships — hard-failed on 2 of 5 items.** Mug
and sneaker both came back `bad-response`, which in `ai.js` means the reply was
unparseable, empty, or carried a `blockReason` or a non-`STOP` finish. That is a
**40% failure rate on the app's primary path**, and it outranks the grounding
question that this run was commissioned to answer. Dad would have seen "Odd reply
from the model — try again" twice in five items. Nothing in the build is wrong —
the pencil floor and the error copy are exactly what M1 and V1 designed for — but
a verdict he has to ask for twice is a verdict he stops asking for.

**Every success claimed `high` confidence, and one of them was only partial.**
Three graded items, all stating `high`, scoring 67%. `n = 3` proves nothing on
its own, but it points the same way runbook §3 warns about: if `high` does not
outrank `low`, the UI should treat every estimate as low-confidence until V2's
comps ladder lands. The banner already carries the confidence word whenever it is
not `high` — which, on this evidence, would have been never.

**The book was identified by publisher, not author.** Expected *Judith Kelman —
Where Shadows Fall*; got *Berkley, ISBN 0-425-10181-9*. Correct information off
the same photo, scored partial because it answers a question nobody asked. A
spine shot gives an ISBN more legibly than an author name, so this may be a
fixture-photography finding as much as a model one.

**M2's shipping estimates came out sane** — $4.13 for a paperback, $6.00 for a
keyboard, $7.50 for a level. The paperback sits just above the $4 clamp floor,
which is where Media Mail belongs, and nothing needed clamping. Quiet
confirmation that the schema description is eliciting the reasoning §4 of the
deep-dive says Gemini already does.

### One defect in this report

The **Manual remainder** below states *"Sold medians were filled automatically"*.
They were not — every one failed. That line is unconditional in
`scripts/live-check.mjs` and does not check whether the SerpApi calls succeeded.
Left as-is: R1 permits exactly one source change in this mission, and this is not
it.

### What this run does close

Runbook **§1** has an answer at last, and it is **FAIL — 2 of 5**, against a gate
of 4. **§2 (anchoring) is inconclusive**, not passed: the mug is one of the two
items that hard-failed, so the test never got a pair of estimates to compare, and
the pre-authorised deletion in `ai.js` was correctly not triggered. **§3
(calibration)** has its first three rows and they lean the wrong way.

---

## D1 — diagnosis (2026-07-28)

A targeted re-run of the two items R1 recorded as `bad-response`, with the
harness tapping the wire to see what the collapsed code was hiding.
`--only=mug,sneaker --anchor=mug`.

### The `bad-response` failures did not reproduce

| item | R1 | D1 | attempts needed |
|---|---|---|---|
| mug | `bad-response` | **partial** · $35.00 | 1 |
| sneaker | `bad-response` | **correct** · $45.00 | 1 |

Both succeeded on the first attempt, so the retry never fired and the Failures
appendix holds no ungrounded entry to classify. **The correct classification is
"not deterministic", not "transient"** — one clean run does not prove a cause,
it only rules out a permanent one. Whatever happened at 03:48 was not a property
of these fixtures, this prompt, or this schema.

Notably, sneaker went from `bad-response` to **correct**, which would have taken
R1's gate from 2/5 to 3/5 on identical inputs. The gate verdict above is a
sample of one.

### Anchoring: the line was deleted, and the test is now blind

R1's pre-authorised fix triggered. Both runs, same two photos, same everything
but the stated Goodwill price:

| | $4 → | $30 → | drift | direction |
|---|---|---|---|---|
| **before** the deletion | $35.00 | $55.00 | **57.1%** | higher price → higher estimate |
| **after** the deletion | $42.00 | $30.00 | **28.6%** | higher price → *lower* estimate |

The line is gone from `src/utils/ai.js`, and `buildUserMessage` now returns a
**byte-identical string** for a stated $4 and a stated $30 — verified directly.
So the 28.6% cannot be anchoring: the model was sent the same prompt twice and
answered $42.00, then $30.00.

**That is the finding.** At `temperature: 0`, this model has a run-to-run spread
of at least ~29% on one fixture, and the anchoring test's tolerance is 10%. Its
noise floor is three times its own threshold, so a single pair can never separate
the signal from the variance — and it will keep printing `ANCHORED` forever.
The "before" number was measuring anchoring *plus* this variance, which means
57.1% was never the size of the anchoring effect.

The deletion still stands, on two grounds that do not depend on the arithmetic:
the before-run moved in the direction anchoring predicts while the after-run
moved against it, and sending a pricing model the price you are about to pay is
indefensible whatever the measurement says. The price still reaches every place
that decides anything — `calcProfit`, `checkRules`, `pencilFloor`, `usablePrice`
— all client-side.

**Runbook §2 cannot be marked passed.** It needs a redesign before it can answer:
several pairs rather than one, a control pair that changes nothing to establish
the noise floor, and a tolerance set above it.

### The variance is the bigger news

A ~29% spread on the same photos is not only an anchoring-test problem. The
verdict turns on a $20 net threshold and a 3× rule; an estimate that moves $42 →
$30 between identical calls moves items across both. The Re-check button W1 added
will sometimes "revise" a verdict on no new information at all.


---

## Failures

_Captured 2026-07-28T04:47:32.356Z. `bad-response` in `ai.js` collapses four distinct failures
— unparseable JSON, empty text, a `blockReason`, and a non-`STOP` `finishReason` —
into one code, because nobody in an aisle can act on the difference. The harness
taps the wire to see through it; production is unchanged._

### `mug` · grounded

- **attempt 1 of 1: `quota`**
  - HTTP `429` · finishReason `none` · blockReason `none`
  - envelope parsed: yes · raw 617 chars · text 0 chars
  - tokens — prompt ? · thoughts **?** · candidates ? · total ?

    ```
    {   "error": {     "code": 429,     "message": "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-a
    ```
