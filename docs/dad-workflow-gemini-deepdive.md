# Dad's Gemini Workflow — Deep-Dive (source of record)

Source: https://gemini.google.com/share/77ab05749bc1 — "Reselling Item Evaluation Criteria", created with **Gemini Flash, July 26 2026, 2:48 PM** (one real Goodwill trip), published July 27. Read in full 2026-07-28. This doc is the calibration reference for prompt/UX decisions; it captures what Dad is *trained on* and therefore what the app must preserve or consciously improve.

## §1 His standing prompt, verbatim

> "I'll be presenting you some items and you will let me know if this item is worth reselling? Consider market demand (i.e. are there several of these items that have currently sold recently), shipping size and logistics (size and weight… actual weight and dimensional weight), and profitability (3x my investment while making at least a $20 profit) in your decision. Keep your answers relatively short but precise. Buy it or leave it on the shelf?
>
> I don't want an Optimized Listing Title or a description drafted…I just want you to consider all the variables I mentioned above and tell me if I should buy the item or leave it on the shelf. Then I want you to wait for the next item I present to you. Do you understand?"

Notable: the 3×/$20 house rules are **his own words to Gemini**, not just the Founder's spec. He explicitly does NOT want listings at shopping time (validates the Buy-screen design: listing rides the same call but never shows in the aisle). He asks for short-but-precise (validates panel-style verdicts).

## §2 The session's shape

- ~35 items in one trip. Turn grammar: **[1–2 photos] + price only** — "6.99", "4.99", "1.99 each", ".99", "Rae Dunn 6.99". Condition qualifiers ride the same message when relevant: "Still wrapped.", "Still sealed. $3.99", "It looks to be intact…no damage.", "The box is a but rough."
- **Several turns had photos and NO price** — Gemini assumed a typical thrift cost range ("Assuming a standard thrift price of $1.99–$3.99…") and evaluated anyway.
- **Verdicts: ~4 BUY / ~31 LEAVE (~90% leave rate).** Buys: Danbury Mint castle $6.99, Gemmy Snoopy $3.99, Pirates of the Caribbean dice game $4.99 (revised to LEAVE after "box is a bit rough"), Wild Wild West DVD set $4.99. The app's dominant job is fast confident NOs.
- Gemini's response template he's habituated to: **Market Demand / Logistics / Profitability → Verdict: BUY IT / LEAVE IT ON THE SHELF**, one-line caveat ("check the discs", "test the batteries"), then "Ready for the next item!"

## §3 Follow-up taxonomy (what he asks after a verdict)

1. **Velocity** — "Do they sell often?" → Gemini: sales speed (3–8 weeks), volume. He cares about sit-time, not just margin.
2. **Condition revision** — "The box is a but rough." → Gemini re-ran the math, "Revised Verdict: LEAVE IT". New info mid-item **changes the verdict**, and he expects that.
3. **Challenge** — "Check the pic again." → Gemini held its ground *with comps* ("sealed copies of this exact set sell $12–$18"). He pushes back and respects a defended answer.
4. **Set/lot strategy** (BTS TinyTAN, 9 figures) — "Do I have all of them?", "Will these sell all together as is?", "How much can I get if I get all 14 pieces?" → lot-vs-complete-set pricing, hold decision ("I'll wait to see if I find the entire collection before posting"). Multi-item lots are a real recurring mode ("1.99 each" books, Sonic plush pair bundle).
5. **Companionship** — "For now…I enjoy the thrill of the hunt. 😄" and Gemini's "Are you wrapping up for the day, or do you have another stop on your thrift route?" — the warm back-and-forth is part of why he uses it.

## §4 Gemini's math vs the app's

- Gemini uses **~13% fees**; app uses exact 13.25% + $0.30. App wins.
- Gemini's "3x ROI benchmark" is **inconsistent** — sometimes 3× cost as *net payout* ($8.99 → "needs $26.97 net"), sometimes as gross sale. The app's `pencilFloor` is one precise definition. App wins, deliberately.
- Gemini frequently nets **"assuming buyer pays shipping"** — flattering. The app subtracts shipping seller-side (conservative). Keep conservative; M2's "Shipping label · AI estimate" line keeps it legible.
- Gemini folds logistics (weight, fragility, dimensional weight, Media Mail eligibility) into every answer — exactly the reasoning M2's `shipping_estimate` description elicits, plus fragility notes surfacing in chat.

## §5 Essence to preserve (already in the app)

Photo+price minimal input · structured short verdict · no listings in the aisle · his own 3×/$20 rules · warm chat (Flip) · multi-photo · caveat lines ("test before listing") ride the rationale.

## §6 Gaps and leans (decided 2026-07-28)

| Finding | Lean | Where |
|---|---|---|
| His vocabulary is "LEAVE IT ON THE SHELF"; app says "SKIP IT" | Rename skip banner to **LEAVE IT** · detail "on the shelf · under your floor". "BUY IT" already matches verbatim. | **W1 (safe now)** |
| He sometimes sends **no price**; a gp=0 3× rule passes trivially | Guard: verdict requires a price; inline ask ("What's on the tag?") | **W1 (safe now)** |
| Condition update **changes the verdict** and he expects a formal revision | "Re-check" on the verdict screen: edit notes → re-run analyze with same photos → banner replaces, marked *Revised* | **W1 (safe now)** |
| "Do they sell often?" — velocity/sit-time | Real velocity comes from sold-comps recency, not model vibes → surface "sells ~X/wk" / "slow mover" from the comps window | **V2 (gated on R1)** |
| Lot mode ("1.99 each", set completion, bundle-vs-set) | Notes field already carries it and the model responds in chat; a structured lot feature is real scope | **Defer** — revisit after Dad's first real trips |
| Challenge mode ("Check the pic again") | Chat already supports; comps injection (V2) is what lets Flip *defend with data* like Gemini did | V2 strengthens it |

## §7 One-line thesis

Dad already invented the app's spec himself, in prose, to Gemini — the app's job is that exact loop with three upgrades he'll feel immediately (one-tap capture instead of app-switching, exact math instead of ~13%, verdicts that remember items into cart/listing/earnings) and zero vocabulary he has to relearn.
