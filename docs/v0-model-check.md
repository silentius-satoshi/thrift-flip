# ~~V0 — The Model Check~~ — SKIPPED, but not dead. Read this box.
### **Status (July 2026): the staged AI Studio run was skipped** — Dad's sustained real-world use of Gemini 3.6 Flash on actual thrift items answered the identification question, and `gemini-3.6-flash` is the default model (plan §6.2). **Three parts of this doc are still live:** §3's system prompt is the reconstruction of record and ships in `src/config/prompt.js` at V1 · §5's anchoring test and §6's scoring sheet run as part of **V1's verification** (the app's calls include `goodwillPrice`; Dad's manual chats never did) · §4's schema remains the V0-tier reference alongside vision §5. Everything else below describes a procedure nobody needs to run.

---

## 0. Before you start — two things this doc had to solve

**The original system prompt is gone.** `thrift-flip-vision-pipeline-v1.md` §5 says "the existing three-mode Flip system prompt survives nearly intact," but it is **not in the repo** — `src/utils/webhooks.js` is entirely mocked responses, and the real prompt lived in the n8n workflow that was deleted. §3 below is a reconstruction of **Mode 1 (analyze)** built from the spec's description of it. If you still have the original somewhere — an n8n export, a note, a chat log — use that instead and treat §3 as a diff to check against. If you don't, §3 becomes the prompt of record and should be copied into `src/config/prompt.js` at V1.

**Nothing here tests the verdict.** The 3×/$20 rule stays in the client (`calculations.js`) and is deliberately not in the prompt. The model's job is identification, condition, listing copy and a price estimate; the buy/skip call is arithmetic the app does afterward. Do not add the house rules to the prompt — if the model knows the target it will reverse-engineer a price that clears it, which is exactly the failure §5 is designed to catch.

---

## 1. Shoot the items (~20 min)

**10–15 items** spanning the difficulty range. Five of them are mandatory, because `thrift-flip-vision-pipeline-v1.md` §7's V1 gate re-tests the same five through the app later — one baseline, two tests:

| # | Item | Why it's in the set |
|---|---|---|
| 1 | A **sneaker** | Branded, model-number-bearing, the easy case |
| 2 | A **book** | Text-heavy cover; tests OCR-ish reading |
| 3 | A **tool** | Brand often stamped, not printed |
| 4 | A **mug** | Often unbranded; tests the honest-low-confidence path |
| 5 | **Vintage electronics** | Model plates, era guessing, the hard case |

Then 5–10 more that look like a real trip: unbranded ceramics, a no-label wool coat, Pyrex, a labelled jacket, something with the tag cut out.

**Shoot them the way Dad would.** Handheld, three angles, store or garage lighting, no staging, no white background, no cleaning them up first. A V0 run on beautifully lit studio photos tells you nothing about a Goodwill aisle. Keep each set of 3 photos together and note the real price you'd expect to pay.

---

## 2. Set up AI Studio (~5 min)

1. Go to **aistudio.google.com** and sign in with the Gmail account whose key Dad will eventually use.
2. Start a new chat/prompt.
3. In the **Run settings** panel on the right, set the model to **`gemini-3-flash-preview`** — the default in `thrift-flip-vision-pipeline-v1.md` §3. *(If you can't find that exact string in the picker, note what the closest current Flash model is called and record it; the model list moves and §3 may need amending.)*
4. Set **temperature to 0** — you want the model's honest first answer, not a creative one, and you want re-runs to be comparable.
5. Turn on **structured output** in that same Run settings panel and paste the schema from §4. The control has moved around between AI Studio revisions — it's usually labelled *Structured output*, *JSON mode*, or shown as a `{}` icon near the model settings. **If you genuinely can't find it, don't burn time hunting:** paste the schema into the system instructions instead, ending with *"Return only JSON conforming to this schema."* You lose hard enforcement but the test still works — and if the model can't hold the shape without enforcement, that itself is worth knowing.
6. Paste the system prompt from §3 into **System instructions**.

---

## 3. System instructions — paste this

```
You are the analysis engine inside Thrift Flip, a tool used by one reseller
standing in a thrift store deciding whether to buy an item and resell it on eBay.

You are given 1-3 photographs of a single item plus a short note from the user.

YOU CAN SEE THE PHOTOS. Read the item's condition directly from them — wear,
staining, cracks, missing parts, fading, pilling, scratches on a screen or lens.
Do not ask the user to describe what is visible to you. Where the photographs
and the user's note disagree, say so plainly in notes_conflicts rather than
silently preferring one.

Identify the item as specifically as the photographs support: brand, model,
and era where they are legible or recognisable. Where they are not, say so.
An honest "medium" or "low" confidence with a clarifying_question is far more
useful than a confident guess — a wrong identification that reads as certain
will cause a bad purchase with real money. Only set confidence to "high" when
you can point to something in the image that establishes the identification.

Write the eBay listing as a seller would: a title of 80 characters or fewer,
brand first, keyword-dense, no filler words like "Rare" or "L@@K" unless the
item genuinely warrants them. Fill item_specifics with real values read from
the item; leave a field as an empty string rather than writing
"See description" or "Does Not Apply".

Price to what the item realistically SELLS for on eBay in this condition —
the completed-and-sold price, not the asking price of active listings, and not
what a pristine example would fetch. Give a range wide enough to be honest.
In rationale, state what you based the estimate on and what would change it.

The user's purchase price is context for the write-up, not an input to the
valuation. Estimate what the item is worth on the open market; whether it is
a good buy at their price is arithmetic done elsewhere.
```

---

## 4. Response schema — paste this

`listing_mercari` is deliberately omitted; it's a V1.5 concern and adds output tokens V0 doesn't need. That omission is why this block is **not** a byte-for-byte copy of `src/config/schema.js` — the `pricing` block below matches it exactly, and the rest is V0's deliberate subset.

`pricing.shipping_estimate` arrived at **M2**, when the Ship field left the capture screen: nobody can weigh a lamp standing in a Goodwill aisle. Its instruction rides the `description` rather than the prompt for the same reason `listing_mercari`'s register rules do — the system prompt in §3 is the byte-verbatim prompt of record.

```json
{
  "type": "object",
  "properties": {
    "identification": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "brand": { "type": "string" },
        "model": { "type": "string" },
        "era": { "type": "string" },
        "category_path": { "type": "string" },
        "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
        "clarifying_question": { "type": "string" }
      },
      "required": ["name", "category_path", "confidence"]
    },
    "condition_read": {
      "type": "object",
      "properties": {
        "grade": {
          "type": "string",
          "enum": ["New", "Like New", "Good", "Acceptable", "For Parts"]
        },
        "visible_flaws": { "type": "array", "items": { "type": "string" } },
        "notes_conflicts": { "type": "string" }
      },
      "required": ["grade", "visible_flaws"]
    },
    "listing": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "description_html": { "type": "string" },
        "item_specifics": {
          "type": "object",
          "properties": {
            "Brand": { "type": "string" },
            "Size": { "type": "string" },
            "Color": { "type": "string" },
            "Material": { "type": "string" },
            "MPN": { "type": "string" }
          }
        },
        "condition_description": { "type": "string" }
      },
      "required": ["title", "description_html", "item_specifics", "condition_description"]
    },
    "pricing": {
      "type": "object",
      "properties": {
        "estimate": { "type": "number" },
        "range_low": { "type": "number" },
        "range_high": { "type": "number" },
        "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
        "rationale": { "type": "string" },
        "shipping_estimate": {
          "type": "number",
          "description": "Estimated cost in USD to ship this item domestically, packaging included, at typical USPS/UPS retail rates."
        }
      },
      "required": ["estimate", "range_low", "range_high", "confidence", "rationale", "shipping_estimate"]
    },
    "strategy": {
      "type": "object",
      "properties": {
        "platform": { "type": "string", "enum": ["eBay", "Mercari", "FB Marketplace"] },
        "format": { "type": "string", "enum": ["fixed", "auction"] },
        "rarity_flag": { "type": "boolean" },
        "timing_note": { "type": "string" }
      },
      "required": ["platform", "format", "rarity_flag", "timing_note"]
    }
  },
  "required": ["identification", "condition_read", "listing", "pricing", "strategy"]
}
```

If AI Studio rejects the schema, the usual culprits are `enum` on a non-string, or a `nullable` key (removed here for that reason). Simplify the offending block rather than abandoning enforcement.

---

## 5. Run each item (~25 min)

Per item: attach its 3 photos, then send a user message in the shape the app will actually send:

```
Notes: [what Dad would type — "wool blanket, some pilling, no tag"]
Condition as I see it: [Good]
Goodwill price: $[8]
```

Start a **new chat for each item.** Same-thread runs contaminate each other — the model will pattern-match off the previous item's answer and your accuracy numbers will be flattering and wrong.

### The anchoring test — do this once, it takes two minutes

Pick one mid-difficulty item. Run it normally. Then run it again in a fresh chat with **everything identical except the stated Goodwill price** — say $4 instead of $30.

If `pricing.estimate` moves meaningfully between the two runs, **the model is pricing off the purchase price rather than the market**, and every verdict the app produces would be circular: it would tell Dad an item is worth 3× whatever he's about to pay. That is the single most dangerous failure mode in this pipeline and nothing else in the plan tests for it. If it fails, the fix is to stop sending the purchase price in the analyze call at all and only use it client-side in `calculations.js`.

---

## 6. Score it — the sheet

One row per item. Fill it as you go; scoring from memory afterwards doesn't work.

| # | Item | ID correct? | Condition plausible? | Est. | Real sold median | Within range? | Model's confidence | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | | Y / partial / N | Y / N | $ | $ | Y / N | high/med/low | |

**"Real sold median"** means: eBay → search the item → filter **Sold items** → eyeball the median of the last ~10 comparable sales. Roughly 30 seconds per item and it is the only ground truth available.

**"ID correct"** is brand + model. Brand right, model wrong = *partial*.

---

## 7. What the results mean

**The headline number:** ≥4 of the 5 core items correct on brand+model.

**The number that actually matters: calibration.** Sort your rows by the model's stated confidence and check that accuracy falls as confidence falls. A model that's wrong and says `low` is usable — the app shows the pencil tag and a "verify on eBay" link, and Dad's own judgement fills the gap. A model that's wrong and says `high` is dangerous, because the verdict screen will stamp it and he'll act on it. **If `high` isn't meaningfully more accurate than `low`, that finding outranks the accuracy score**, and V1 should treat every estimate as `low` confidence until the comps ladder (V2) supplies real sold data.

**What a poor result changes** — none of it stops the build, all of it lands in `thrift-flip-vision-pipeline-v1.md` §3 before V1 hardcodes anything:

- Weak IDs on branded goods → promote **`gemini-3.6-flash`** to default and re-test those items.
- Weak IDs on unbranded goods only → expected; make `clarifying_question` fire on `confidence: low` and surface it in the UI as a real question rather than swallowing it.
- Prices consistently high → the model is reading active asking prices, not sold. Tighten the system prompt's pricing paragraph and move V2's SerpApi comps up in priority.
- Anchoring test failed → stop passing the purchase price into the analyze call. Amend §2's pipeline diagram.
- Schema wouldn't hold without enforcement → note it; V1 must use `responseMimeType` + `responseSchema`, not prompt-only instructions.

Write whatever you find into a short amendment to vision §3, then V1's prompt inherits it.
