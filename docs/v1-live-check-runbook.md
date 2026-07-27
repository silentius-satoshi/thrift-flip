# V1 live checks — the four things a real key has to answer

<!-- Status: UNRUN as of the V1+S1 commit. Nothing below has been executed. -->

> **§1–§3 are now automated.** `scripts/live-check.mjs` scores identification
> against labeled fixtures, runs the anchoring test, and fills the calibration
> table — plus a grounded-vs-ungrounded arm that H1 added to decide comps tier A.
> `GEMINI_KEY=... node scripts/live-check.mjs --anchor=mug` → `docs/live-check-results.md`.
> §4 (kill the key) stays manual, as does filling sold medians without a `SERPAPI_KEY`.

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

## 5. The vault, on the phone (N1-lite)

**This is the half of nostr §13's gate 2 that no machine here can run.** WebAuthn
does not exist in a headless browser, so the PRF path — the one Dad will
actually use — is verified only by doing it. Everything below the PRF assertion
is shared with the PIN path and is covered by `npm test`; these five checks are
what the tests cannot reach. Until they are ticked, **the PRF half of gate 2 is
unrun, and no build summary may record it as passed** (plan §6.1).

Needs a real iPhone, Safari, and the app served over https. Ten minutes.

**5a — Enrollment.** Fresh profile, no key. Settings → Add your AI key → paste a
Gemini key → Connect. Expected: the "Lock your AI key" sheet appears and asks for
Face ID **twice** in a row — registration returns no PRF output, so an assertion
follows immediately (§5.2). Then "Connected — verdicts are live" and a
*"Protected by Face ID"* row.

Result: ☐ pass ☐ fail — how many Face ID prompts, and what appeared:

**5b — It survives a relaunch, and the unlock is real.** Force-quit Safari
entirely. Reopen the app → Buy → capture → price → Get verdict. Expected: one
"Unlock with Face ID" sheet, one scan, then the verdict runs on the same key. Not
a new key, not a re-paste.

Result: ☐ pass ☐ fail:

**5c — Cancel fails clean.** Same flow, but dismiss the Face ID sheet. Expected:
*"Unlock cancelled — verdicts need your key"* as both a toast and the pencil
banner, the pencil floor still on screen, Skip and Add to cart still working, and
**no retry loop** — it does not ask again on its own.

Result: ☐ pass ☐ fail:

**5d — Ciphertext only.** Safari → Develop → Storage. Expected: **no**
`thrift-flip-ai-key` in Local Storage at all, and in IndexedDB under
`thrift-flip-vault` → `blobs`, an `ai-key` record whose `ciphertext` is bytes and
whose `meta` reads `payloadKind: "credential-blob"`, `scheme: "prf"`. Search the
whole storage pane for the last four characters of the real key: they should
appear only in `meta.hint.last4`, which is deliberate and is what Settings
displays.

Result: ☐ pass ☐ fail — anything found in the clear:

**5e — The PIN fallback, on something that isn't the iPhone.** §13's QA note is
explicit that testing only the happy path is not testing. On a desktop browser
with no platform authenticator (or an iPhone below iOS 18.4): the enrollment
sheet should either lead with the PIN or fall back to it by itself after Face ID
fails, and the copy should say "passkey", never "Face ID". Then: three wrong PINs
→ *"Too many tries — wait 15 seconds."* → wait → correct PIN opens it.

Result: ☐ pass ☐ fail:

> **If 5b fails after an iOS restore or a deleted passkey, that is the designed
> outcome, not a bug.** The ciphertext is unopenable without the enrolled
> credential — that is the property the whole step buys. Settings → the key
> screen → **Can't unlock?** → Start over, then paste a fresh key.

---

## 6. eBay sandbox connect (E1)

**Unrun, and it cannot be run from here.** Every prerequisite is Founder-side:
Vercel env vars, the eBay dashboard registration, and a sandbox test user. Until
these are ticked, ebay §8's E1 gate stays open — **no build summary may record
it as passed** (plan §6.1).

**Prerequisites.** Copy `.env.example` to `.env.local`, fill it, and set the same
values in the Vercel project. Note `EBAY_DELETION_ENDPOINT_URL` — it is **not** in
E1's original prerequisite list and was added during the build: it is the third
input to the deletion challenge hash and must byte-match what is registered with
eBay, or the endpoint is rejected with no diagnostic. In the eBay dashboard:
register the deletion endpoint + verification token, map the RuName to
`https://<domain>/ebay/callback`, and create a sandbox test user.

**6a — The deletion endpoint validates.** In the eBay dashboard's alert settings,
save the endpoint URL and token. Expected: eBay marks it validated on the spot.
If it rejects, the usual cause is `EBAY_DELETION_ENDPOINT_URL` disagreeing with
the registered URL by a character.

Result: ☐ pass ☐ fail:

**6b — The relay is gated.** From a terminal:

```
curl -i -X POST https://<domain>/api/ebay/oauth              # → 401
curl -i -X POST https://<domain>/api/ebay/oauth \
  -H "Authorization: Bearer wrong"                           # → 401
```

Result: ☐ pass ☐ fail:

**6c — Connect round-trips.** On the phone: Settings → eBay → Connect eBay. Sign
in as the **sandbox** test user and tap Agree. Expected: you land back in the app,
the unlock sheet appears once, and the row reads *"Connected · through \<month
year\>"* roughly eighteen months out. The address bar shows no `code=`.

Result: ☐ pass ☐ fail — what the row says:

**6d — Test repairs as well as reports.** Tap **Test**. Expected: *"Still
connected — eBay answered"*. This runs a real refresh grant, so it also proves
the refresh token survived storage.

Result: ☐ pass ☐ fail:

**6e — Kill the network mid-callback.** Disconnect first. Start Connect again,
and turn on airplane mode while eBay is redirecting back. Expected: a specific
failure, the row still reading **Connect eBay**, and no half-written connection.
Turn the network back on and connect again — it works.

Result: ☐ pass ☐ fail:

**6f — Ciphertext only.** Safari → Develop → Storage. Expected: no eBay token
anywhere in Local Storage, and in IndexedDB under `thrift-flip-vault` → `blobs`
an `ebay-tokens` record whose `ciphertext` is bytes and whose `meta.hint` holds
only `through`. Search the pane for the first ten characters of the refresh
token: no match.

Result: ☐ pass ☐ fail:

> Once 6a–6f are ticked, ebay §8's E1 gate is closed **except** its multi-device
> half, which needs Nostr N2/N3 and is unscheduled.

---

## 7. The first real draft (E2)

**Unrun, and it cannot be run from here** — same reason as §6, plus one new
prerequisite. Until these are ticked, ebay §8's E2 gate stays open; **no build
summary may record it as passed** (plan §6.1).

**New prerequisite, and it will bite first.** The sandbox test user must have
**business policies opted in** — Seller Hub → Account → Business Policies →
opt in, then create one fulfillment, one payment and one return policy. Policy
IDs are required fields on an offer, and by decision the app **refuses to send**
without them rather than piling up drafts that can never be published. The
refusal names this fix, so if you see it, this is what it means.

**7a — Send one.** With the sandbox user connected (§6), open any listing in the
editor and tap **Send to eBay drafts**. Expected: *"Draft sent — add photos in
Seller Hub when you review"*, the listing clears, and the item appears under
**Selling → Working**.

Result: ☐ pass ☐ fail:

**7b — It is really there, and really photo-less.** In **sandbox** Seller Hub →
Listings → Drafts. Expected: the item, with title, price, condition and item
specifics intact, and **no photos** — that is the design, not a bug. Check the
SKU equals the app's item id.

Result: ☐ pass ☐ fail — what is missing, if anything:

**7c — Add a photo there.** Upload one in Seller Hub. This is the whole
photo-less bet: if this step feels like real friction on a trip, the decision is
worth revisiting (ebay §6 names the Trading API `UploadSiteHostedPictures` as
the fallback).

Result: ☐ friction ☐ fine — how it felt:

**7d — Publishing asks for a location the first time.** Try publishing the draft
in Seller Hub. Expected: eBay asks for an item location before it will go live.
That is expected and is **not** something the app can pre-fill — `merchantLocationKey`
is a publish requirement, and E2 deliberately never publishes. Seller Hub
collects it once and remembers.

Result: ☐ pass ☐ fail:

**7e — Re-send the same item.** Edit the price in the app and send again.
Expected: the **same** draft updates — not a second draft. The app looks the SKU
up before writing precisely so a re-send after an edit lands.

Result: ☐ pass ☐ fail:

**7f — Force a validation error.** Easiest: paste 80 characters of nonsense into
Item Specifics → Brand, or set the price to something eBay refuses. Expected: the
complaint appears **against the named field**, the listing does **not** clear,
and **Copy for eBay instead** is right there. A validation fight must never
strand a listing.

Result: ☐ pass ☐ fail — what it said and where:

---

## 8. The chat can see (V3)

**Unrun. No stub can stand in for this one** — the whole question is whether a
real model, given real photographs, says something true about the item in front
of you. Vision §7's V3 gate is exactly this, and until it is ticked the gate is
open. Needs a real AI key and one real item; five minutes.

**8a — Ask about something visible.** Analyze an item that has a *visible flaw* —
a scuff, a stain, a frayed cuff, a chip. Open Flip and ask about it without
describing it: *"how bad is that mark on the front?"* Expected: an answer that
refers to the actual mark — where it is, how big, whether it matters to a buyer.

Result: ☐ pass ☐ fail — what it said:

> **The failure mode to watch for is a confident non-answer.** "Minor wear like
> that usually knocks 10–15% off" is a sentence about resale in general, not
> about your item. If you get that, the photos are not reaching the model and
> §8b will show it.

**8b — Ask on turn three.** Keep the conversation going — two more questions —
then ask about a *different* detail in the photos. Expected: still answered from
the image. This is the check that the photos ride **every** request, not just
the first: Gemini keeps no session, so the app re-uploads them each turn.

Result: ☐ pass ☐ fail:

**8c — Ask for comps and watch it refuse.** Ask *"what have these sold for
recently?"* Expected: an estimate labelled as an estimate plus the eBay search
to run — **never** a specific figure like "these sell for $60, about 40 a month".
Invented sold data is the single most damaging thing this app could say, because
it sounds exactly like the thing you need.

Result: ☐ pass ☐ fail — quote it:

**8d — List a pencil item.** Take an item to the cart *without* a verdict, then
List it. Expected: a real listing with real item specifics — no "See
description", no "Does Not Apply" — and a price from the model with **"Your
floor at the shelf: $X"** beneath it. If the model's price lands under your
floor, the ✗ marks and the red total are the point, not a bug.

Result: ☐ pass ☐ fail:

**8e — Photos survive the trip.** Capture, then force-quit and reopen. Expected:
the capture strip still shows them. Then Safari → Develop → Storage → Local
Storage: `thrift-flip-shopping-form` holds a `photoCount` and **no image data at
all**. The photos are in IndexedDB under `thrift-flip-photos`.

Result: ☐ pass ☐ fail:

---

## 9. The flywheel closes (E3)

**Unrun, and the longest loop in the book** — it needs a real listing to go live
and a real purchase to complete. Nothing local can stand in for the last step,
which is the whole point of the project: an analysis informed by what *you* sold.
Until it is ticked, ebay §8's E3 gate stays open.

**New prerequisite, and it will stop you first.** A sandbox purchase needs a
**sandbox buyer account** — a second login, separate from the sandbox seller from
§6. Create one in the developer dashboard's sandbox user tool before starting.

**9a — Publish one.** Take a draft the app sent (§7) and publish it in sandbox
Seller Hub. Expected: eBay asks for an item location the first time (§7d) and
then the listing goes live.

Result: ☐ pass ☐ fail:

**9b — The app notices.** Open Selling and tap refresh. Expected: the row gains a
blue **Live** tag. The app never publishes, so this is the only way it learns —
it asked the offer and saw a `listingId` appear.

Result: ☐ pass ☐ fail:

**9c — Buy it.** Sign in as the **sandbox buyer** and purchase the listing.

Result: ☐ pass ☐ fail:

**9d — It comes back as Sold.** Back in the app, tap refresh. Expected: a **Sold**
row with the real final price, the days it took, and a green net. Check the net
against the eBay order: it should use eBay's own fee, not a 13.25% guess. Tap
refresh again — the Sold row must **not** duplicate.

Result: ☐ pass ☐ fail — the net it showed, and what the order says:

**9e — The flywheel.** Analyze a *similar* item — same brand or same kind of
thing. Open the Why sheet. Expected: **"Your own sales"** now reads *"You sold
one for $X in N days"* instead of "None yet". That sentence is the entire point
of E3, and of the comps ladder underneath it.

Result: ☐ pass ☐ fail — quote the row:

> **If 9e says "None yet" while 9d showed a sale, the matcher declined** — it is
> deliberately conservative, because a false match tells you a $12 lamp is worth
> $95 and you buy it. Check the two titles share at least two real words beyond
> "vintage"/"used"/a size. A miss here is the designed failure; a false hit is
> not.

---

## 10. The index — what "done" means from here

**The build is finished. This table is what is left.** All ten rows need a person
with a phone, a real key, or a sandbox account; none of them can be closed by a
commit, and none of them has been run. (§11 is numbered after this index because
it arrived after it — the index is §10 and stays there.)

The second column matters as much as the third. Each step shipped with real
headless verification, so "unrun" describes the *live* half specifically — not
the whole check, and not the code beneath it.

| § | Check | Machine-verified | Live |
|---|---|---|---|
| 1 | Five core items — identification accuracy | harness wired (`scripts/live-check.mjs`), scoring built | **UNRUN** — needs a key + fixture photos |
| 2 | Anchoring — does a stated price move the estimate? | the one-line fix site is marked in `ai.js` | **UNRUN** — outranks everything else here |
| 3 | First confidence-calibration pass | — | **UNRUN** |
| 4 | Kill the key — revoked-key behaviour | 403 path tested against a stub | **UNRUN** — confirms Google's real response |
| 5 | The vault on the phone (N1-lite) | whole PIN path, migration, rate limit, ciphertext-only storage | **UNRUN** — WebAuthn/PRF cannot run headless |
| 6 | eBay sandbox connect (E1) | 33 assertions: state, custody, mid-callback kill, refresh preservation | **UNRUN** — needs dashboard config + sandbox user |
| 7 | The first real draft (E2) | 27 assertions: SKU, no `imageUrls`, re-send updates, field-mapped rejection | **UNRUN** — needs business policies opted in |
| 8 | The chat can see (V3) | photos on every request, retry state, no base64 in localStorage | **UNRUN** — only a real model can be photo-grounded |
| 9 | The flywheel closes (E3) | 18 assertions: real fee, dedupe, throttle, comps injected + cited | **UNRUN** — needs a sandbox **buyer** account too |
| 11 | Installed on the phone (M1) | 60 assertions: offline boot + the pencil flow with the network off, cache discipline, the deploy purge, and a 390×844 sweep of every screen | **UNRUN** — an emulator cannot install to a home screen |

**Deferred by design, not pending:** multi-device token sync and the
ciphertext-sync gate (Nostr N2/N3), and comps tiers A and B (V2). Those are not
rows in this table because nothing was built for them to verify.

**Suggested order.** §2 first — it is two minutes and it outranks everything,
because a circular estimate makes every other check meaningless. **Then §11a,
before anything else touches the phone** — installing after the key is added
strands the key in the wrong storage container, and §5 is one of the steps that
would strand it. Then §5 (the vault, on the actual phone), then §§6→7→9 as one
sandbox sitting, since each depends on the last. §§1, 3, 4 and 8 need only a key
and can be done on any quiet evening.

---

## 11. Installed on the phone (M1)

Everything here needs the app **installed to the home screen** on a real iPhone.
The harness covers the parts a viewport can prove — offline boot, the caching
rules, the deploy purge, and a 390×844 sweep of all thirteen screen states —
but an emulator has no home screen, no Face ID, no real safe-area inset and no
software keyboard, so none of the below has been run.

Re-run the machine half any time with:

```bash
npm i --no-save playwright-core
node scripts/mobile-check.mjs
```

**11a — Install FIRST, before the key or any data. Read this before you tap
anything.** Safari → the app's URL → Share → **Add to Home Screen**. Do this
**before** you add the AI key, connect eBay, or capture a single item.

> iOS gives a home-screen app **its own storage container**, separate from
> Safari's. Nothing you did in Safari follows it in — not the encrypted key, not
> the cart, not the drafts. Enrol the key in Safari first and the installed app
> will act like a fresh install while Safari still holds everything, which reads
> as data loss and is not.
>
> **If it already happened:** open the app in *Safari*, Settings →
> `Download everything`, then open the *installed* app and import that file. The
> AI key is deliberately excluded from the backup (V1), so re-paste it after.

Result: ☐ pass ☐ fail — installed before any data was added:

**11b — It looks installed.** Expected: the four-dot icon on the home screen, a
dark status bar, **no Safari address bar or toolbar**, and the bottom nav
sitting clear of the home indicator rather than under it. That last one is the
only real test of the `env(safe-area-inset-bottom)` chain — every emulator
resolves it to 0, so the harness can prove the chain collapses cleanly and
nothing more.

Result: ☐ pass ☐ fail — how much clearance under the nav:

**11c — Offline boot.** Airplane mode **on**. Launch from the home screen.
Expected: the app opens (this is the whole of M1), then the pencil flow runs
end-to-end — capture a photo, enter a Goodwill price, Get the verdict, and land
on the floor with *"No signal · the verdict catches up on its own"* above it.
Add to cart works. Drafts open. Nothing white-screens.

Result: ☐ pass ☐ fail — what the banner said:

**11d — The shutter is the camera.** Still installed, network back on. Buy → the
shutter. Expected: the **native camera opens directly**, not a photo picker with
a camera option. `capture="environment"` is what asks for this and standalone
mode is where it behaves differently from a tab.

Result: ☐ pass ☐ fail:

**11e — Face ID works in the installed app.** This is §5 again, in the container
that matters: WebAuthn and its PRF extension behave differently in a home-screen
app than in a Safari tab, and Dad only ever uses one of them. Enrol the key,
force-quit, relaunch, run a verdict. Expected: one Face ID prompt, the same key.

Result: ☐ pass ☐ fail — and whether §5's results still hold here:

**11f — The eBay round trip returns.** Settings → eBay → Connect. Expected: the
consent page opens, and after you approve, **you come back inside the installed
app** with "Connected". A full-page OAuth redirect out of a standalone app is
the step most likely to drop you into Safari and leave the app blank behind it.

Result: ☐ pass ☐ fail — where you landed:

**11g — Copy-assist survives the trip.** On the List screen: *Copy for eBay*,
then *Copy for Mercari*. Expected: the clipboard actually takes it from a tap
(iOS refuses clipboard writes that are not user-gestured), the marketplace page
opens, and coming back leaves the editor exactly as you left it — same title,
same price, nothing regenerated.

Result: ☐ pass ☐ fail:

**11h — The keyboard.** Tap into the title field, then the price field.
Expected: **no zoom** on focus (every input is ≥16px for exactly this reason),
and the action bar is either pushed above the keyboard or scrolled away — never
stranded floating in the middle of the screen over the content.

Result: ☐ pass ☐ fail — what the action bar did:

> **11a is the only one that costs something to learn the hard way.** The rest
> fail visibly and recover by themselves. Installing in the wrong order looks
> exactly like losing your data, at the moment you are least inclined to believe
> it is recoverable.

---

## What is already verified, so you don't re-run it

Green in the V1+S1 build, headlessly: `npm test` (20 specs on `calcProfit`,
`checkRules`, `pencilFloor` incl. the $46.50 case); the no-key path end-to-end;
all four error codes rendering their specific copy while Add-to-cart keeps
working; Settings and the key sub-view surviving refresh; the key masked to
last-4 and never rendered, logged, or exported; backup excluding
`thrift-flip-ai-key` and import restoring a cart; PWA manifest/icons/metas; a
27MB photo storing at 204KB after downscale.

Green in the M1 build, headlessly, at 390×844 with touch: the app booting with
the network off and the pencil flow running through it to a floor and a cart;
nothing under `/api/` and nothing cross-origin ever entering the cache; a
deploy installing, waiting, then purging its predecessor on the next launch;
zero horizontal overflow and zero sub-44px tap targets across thirteen screen
states; the nav and action bar seated correctly and their `calc()` chains
collapsing cleanly at inset 0; the sheet dismissing by both swipe and Escape;
and landscape not breaking. **§11 is what none of that reaches.**

Green in the N1-lite build: the whole wrap/unwrap contract on the PIN path
(round-trip, wrong PIN, the `payloadKind` refusals, the HKDF label); the
migration sweep off plaintext; PIN rate limiting and its escalation; §5.7's
single-flight guard, PIN-aware; a key-less profile prompting for nothing; and
headlessly, the enrolled key absent from both localStorage and IndexedDB in the
clear. **Only §5 above is left, and only because WebAuthn cannot run headless.**
