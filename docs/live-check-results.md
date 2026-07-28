# Live-check results

## H2 — 2026-07-28

_Generated 2026-07-28T05:34:51.177Z by `scripts/live-check.mjs` against `fixtures/live/`._
_Model: `gemini-3.6-flash`. Items: 5. Grounded search queries billed: 0._

## Gate — the five core items (v0 §6 sheet, both arms)

_**Not assessed** — 4 of the 5 core items were refused by the account before
reaching the model (`quota`), so they are neither right nor wrong. The 1 item
that ran scored *partial*. Corrected by hand after the run; the harness now
makes this distinction itself._

| # | Item | Ungrounded ID | Grounded ID | Condition | Est. (ungrounded) | Est. (grounded) | Real sold median | Within range U/G | Shipping est. | ID confidence | Registers | Search queries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | book | Berkley ISBN 0-425-10181-9 (partial) | error: `quota` | Acceptable | $6.00 | — | ⟵ fill from eBay sold filter | — / — | $4.13 | high | eBay / Mercari | — |
| 2 | electronics | error: `quota` | error: `quota` | — | — | — | ⟵ fill from eBay sold filter | — / — | — | — | — | — |
| 3 | mug | error: `quota` | error: `quota` | — | — | — | ⟵ fill from eBay sold filter | — / — | — | — | — | — |
| 4 | sneaker | error: `quota` | error: `quota` | — | — | — | ⟵ fill from eBay sold filter | — / — | — | — | — | — |
| 5 | tool | error: `quota` | error: `quota` | — | — | — | ⟵ fill from eBay sold filter | — / — | — | — | — | — |

Sold-range hit rate — ungrounded **no ground truth yet**, grounded **no ground truth yet**.

**Shipping est.** is `pricing.shipping_estimate` after M2's [4, 100] clamp — the
figure the verdict actually spends now that the capture screen no longer asks
for one. It is **unscored**: the fixtures have no weighed postage to score it
against, so read the column for anything absurd rather than for a percentage.

## Variance — the same photos, k times

_5 calls per item, identical inputs, `temperature: 0`. Samples are not
retried: a failed call is data, so this also measures how often `bad-response`
actually happens._

| Item | estimates | median | min–max | spread | shipping min–max | ID stable | failures |
|---|---|---|---|---|---|---|---|
| book | $5.00, $5.00 | $5.00 | $5.00–$5.00 | **0%** | $4.13–$4.13 | yes | 3 (quota) |
| electronics | — | — | —–— | **—** | —–— | — | 5 (quota) |
| mug | — | — | —–— | **—** | —–— | — | 5 (quota) |
| sneaker | — | — | —–— | **—** | —–— | — | 5 (quota) |
| tool | — | — | —–— | **—** | —–— | — | 5 (quota) |

**Median spread across items: 0%.** Worst: `book` at 0%.

### Verdict flips — the number the product decision reads

_Against a stated cost of **$4.99** and the app's own `pencilFloor`, computed per
run from that run's own `shipping_estimate` — which is what the app would have
done with that response. A flip can therefore come from shipping noise as well
as price noise, which is why the shipping range is reported above._

| Item | floor(s) | verdicts across the k runs | stable? |
|---|---|---|---|
| book | $34.00 | LEAVE · LEAVE | yes — LEAVE |
| electronics | — | — | — |
| mug | — | — | — |
| sneaker | — | — | — |
| tool | — | — | — |

**1 of 1 items are verdict-stable.**
An unstable item is one where the same photos, priced the same, would have
sent Dad away with the thing and left it on the shelf on different taps.
## Calibration — does stated confidence track accuracy?

What matters is the sort, not the average: accuracy should fall as confidence falls.
If `high` is not meaningfully more accurate than `low`, that finding outranks the
accuracy score and the UI should treat every estimate as low-confidence until V2.

**Ungrounded**

| Stated confidence | correct | partial | wrong | accuracy |
|---|---|---|---|---|
| high | 0 | 1 | 0 | 0% |

**Grounded**

_No successful calls in this arm._

## Anchoring test

_Inconclusive: 0/3 control and 0/3 anchored pairs completed._

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
SerpApi: **8** live searches, **0** recovered
from the archive (free). Counted client-side, and that count **under-reports**:
SerpApi bills a search that completes server-side even when the client saw a 503
and gave up, which is exactly what happened on the previous run. The dashboard
is the authority, not this line. Free plan allows 250/month.

## Manual remainder:

- Sold medians were filled automatically; spot-check one against eBay to confirm the query matched the right item.
- **Kill the key** (runbook §4) — delete the key in aistudio.google.com/apikey, then run one analysis in the app. Expect the pencil tag to still render with the "That key didn't work" copy and a working Add to cart. Inherently manual; no harness can revoke a key for you.
- **The comparison bar** (plan §6.3) — run a few of these items through the Gemini app the way you do today. The test is beating that habit, not beating nothing.

---

## Read-out — H2

**The run was rationed out of existence at call four, and finding out why is the
result.** A probe of the refusal names the limit exactly:

```
quotaId:    GenerateRequestsPerDayPerProjectPerModel-FreeTier
quotaValue: 20
model:      gemini-3.6-flash
```

**Twenty requests per day.** Not per minute — the id says `PerDay`. H2's own cost
preflight printed **47 Gemini calls** before it started, which is 2.35× the
entire daily allowance for this project. It could not have finished, and neither
could any run of this shape.

That single fact re-reads all three missions:

| run | what we blamed | what it actually was |
|---|---|---|
| R1 | grounded arm "quota" | grounding has no free tier *plus* a 20/day ceiling underneath |
| D1 | small run, worked fine | ~8 calls — comfortably inside 20 |
| H2 | designed for 47 calls | exhausted the day at call 4 |

**Is the variance as bad as the one pair suggested? Unknown, and now honestly so.**
Three estimates survived, all for `book`: **$6.00** on the gate call and
**$5.00, $5.00** on the two variance samples that landed. Within the variance
pair the spread is **0%**; across all three observations it is 20%. Two numbers,
neither of them a distribution, and the 0% is from a sample of two. D1's ~29%
still rests on one pair. **Nothing here confirms or refutes it.**

**Is ID stable while price wobbles?** The one item with data held its
identification across all three calls and moved $6 → $5 → $5. That is the shape
the hypothesis predicts — stable ID, wobbling price — observed once, on the
cheapest item in the set. It is a hint, not a finding.

**Did the control pair make anchoring answerable?** The mechanism is built and
was never allowed to speak: all twelve anchor calls returned 429. The rebuilt
test is the right instrument — same-regime control, three pairs an arm, signal
must beat twice the measured floor — and it is waiting on a budget, not on a
design.

**Did the grounded arm speak? No, for the third time**, and its 429 is a
*different* refusal from the daily cap: grounding has no free tier on Gemini 3.x
at all. Tier A cannot be evaluated on this key under any daily budget.

### What this actually decides

Nothing about the model — and that is the point. It decides something about the
*programme*: **the measurement work is blocked on account state, not on harness
design.** Three missions have now each returned a different account failure, and
each time the instrument got sharper while the data stayed empty.

Two ways forward, both the Founder's call:

1. **Enable billing.** Unblocks the daily ceiling *and* the grounded arm in one
   move, and makes the 47-call H2 design runnable as written.
2. **Ration deliberately.** Twenty calls a day buys, for example, one item at
   k=5 plus a control pair and an anchored pair — four days to a variance
   distribution and an anchoring verdict, at zero cost. `--only` and
   `--variance` already support exactly this, and the non-destructive write
   means four days of partial runs accumulate rather than overwrite.

Option 2 is genuinely viable now in a way it was not before this run, because the
harness stopped overwriting itself.

### Instrumentation notes from this run

- **A 200-character excerpt hid the most important field of the mission.** The
  429 body carried `quotaId` and `quotaValue` past the cut. `diagnose()` now
  extracts them as first-class fields and gives error envelopes 900 characters.
- **The gate said `FAIL — 0/5` for items the model was never asked.** A refusal
  is not a wrong answer. The gate line now reports *not assessed* and names how
  many items the account blocked, rather than recording an account problem as a
  verdict against the model. This run's line was corrected by hand.
- **The cost preflight worked and was ignored — by me.** It printed "≈ 47 Gemini
  calls" and I proceeded without checking that figure against a quota nobody had
  ever measured. The preflight should compare against the known ceiling and say
  so; that is the next harness change, and it would have caught this before a
  single call.


---

## Superseded — 2026-07-28

_Kept for the record. The run above supersedes it; the prompt has changed since._

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

---

## Failures

_Captured 2026-07-28T05:41:59.288Z. `bad-response` in `ai.js` collapses four distinct failures
— unparseable JSON, empty text, a `blockReason`, and a non-`STOP` `finishReason` —
into one code, because nobody in an aisle can act on the difference. The harness
taps the wire to see through it; production is unchanged._

### `mug` · ungrounded

- **attempt 1 of 1: `no-key`** — no response reached the wire (network or thrown before send)

### `mug` · grounded

- **attempt 1 of 1: `no-key`** — no response body was captured for this call
