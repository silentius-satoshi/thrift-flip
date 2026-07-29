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
values in the Vercel project. **`SERPAPI_KEY` (V2, the eleventh var) is optional
and changes nothing today** — see §13. Note `EBAY_DELETION_ENDPOINT_URL` — it is **not** in
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

**The build is finished. This table is what is left.** All eleven rows need a
person with a phone, a real key, or a sandbox account; none of them can be
closed by a commit, and none of them has been run. (§§11–12 are numbered after
this index because they arrived after it — the index is §10 and stays there.)

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
| 12 | The viewfinder and the island (M2) | 23 assertions: the stream, the frame grab, the refused-camera fallback, and the shipping estimate clamped and labelled | **UNRUN** — no emulator has a camera permission, a real sensor, or a safe-area inset |
| 13 | The comps ladder (V2) | 57 assertions + 20 headless: shaping, precedence, repricing, the flip, cache spend, the relay gate | **CLOSED, not unrun** — no compliant automated sold source exists for an individual (§13a) |
| 13c-bis | The manual sold rails (B1-lite) | 30 assertions + 7 headless: query construction, URL encoding, the clipboard and its fallback, the coach mark | **UNRUN, and the one worth running** — needs a phone with the eBay app (§13c-bis) |

**Deferred by design, not pending:** multi-device token sync and the
ciphertext-sync gate (Nostr N2/N3), and comps tier B (Browse actives). Those are
not rows in this table because nothing was built for them to verify.

**Comps tier A is built and has its own row (§13).** It was in the sentence
above until V2; the ladder, the relay and the repricing all now exist and are
machine-verified. What does not exist is data to put through them.

**Suggested order.** §2 first — it is two minutes and it outranks everything,
because a circular estimate makes every other check meaningless. **Then §11a,
before anything else touches the phone** — installing after the key is added
strands the key in the wrong storage container, and §5 is one of the steps that
would strand it. Then §5 (the vault, on the actual phone), then §§6→7→9 as one
sandbox sitting, since each depends on the last. §§1, 3, 4 and 8 need only a key
and can be done on any quiet evening. **§12 rides along with §11** — both need the installed app, and
§12c is the same backgrounding trip as §11c.

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

## 12. The viewfinder and the island (M2)

Also on the installed app, so do it in the same sitting as §11. The harness
covers the mechanism — the stream, the frame grab, the fallback, and the
shipping arithmetic — with a fake camera and a zero inset. What it cannot reach
is a real sensor, a real permission dialog, and a real notch.

```bash
node scripts/mobile-check.mjs --camera --shipping
```

**12a — The permission is asked once.** Fresh install, first time the Buy screen
opens. Expected: iOS asks for the camera **once**, and after you allow it the
viewfinder is live — the thing in front of you, moving, inside the rounded card.
Leave Buy and come back: **no second prompt**, and no delay beyond the stream
warming up.

Result: ☐ pass ☐ fail — how many prompts:

**12b — Refusing it costs nothing.** Settings → Thrift Flip → Camera → off.
Reopen Buy. Expected: the grey corner brackets are back, the shutter opens the
**native camera** exactly as it did before M2, and the app says nothing about
permissions — no banner, no nag, no second ask. Take a photo that way and the
verdict still runs.

Result: ☐ pass ☐ fail:

> This is the state the whole fallback exists for, and it is one tap away in
> Settings. If it feels like a degraded app rather than the old app, that is a
> finding worth writing down.

**12c — Backgrounding and coming back.** Camera back on, viewfinder live. Swipe
up to the home screen, wait ten seconds, reopen the app. Expected: the stream
**resumes by itself**. iOS reclaims the camera when an app backgrounds, so a
frozen last frame or a black card means the re-acquire did not fire.

Result: ☐ pass ☐ fail — what the card showed on return:

**12d — A viewfinder photo goes the whole way.** One shutter tap on a real item,
add a note and its Goodwill price, Get the verdict. Expected: the photo appears
in the strip, the analysis identifies the thing you actually pointed at, and the
listing that comes back describes it. The frame grab shares the file input's
downscale, so this is really asking whether the *sensor* path is as good.

Result: ☐ pass ☐ fail:

**12e — The island.** On a Pro-model iPhone, in the installed app, on **every**
screen: Buy, Cart, List, Selling, Flip, Drafts, Preview, Settings. Expected: no
control, no title and no text sits under the notch or the Dynamic Island. The
viewfinder card starts below it. Every emulator resolves the inset to 0, so this
is the only place `--safe-t` is ever really tested.

Result: ☐ pass ☐ fail — anything clipped, and on which screen:

**12f — The shipping line says whose number it is.** Any verdict. Expected: the
Earnings panel reads **"Shipping label · AI estimate"** with a figure that suits
the item — a mug is not $40 to post. On the pencil screen with no signal it
reads **"Fees + shipping (est. $12)"** instead, because nothing estimated it.
Then open the listing editor: the Shipping section shows that same number in an
editable field, marked *✦ AI estimate* until you change it.

Result: ☐ pass ☐ fail — what the model guessed, and what the label actually was:

> **12f is the one to watch over a few trips.** The estimate is clamped to
> \$4–\$100, which stops an absurd number from deciding a buy — but it cannot
> stop a *plausible* wrong one. If it is consistently light on heavy things,
> that is a prompt problem, and the fix is the schema description, not the code.

---

## 13. The comps ladder (V2) and the manual rails (B1-lite)

**This section is different from every other one in this runbook.** The others
are unrun because they need a phone, a sandbox account or a human. The automated
half of this one is **closed**: it was run, and the answer was that no compliant
data source exists for an individual seller — SerpApi's sold arm is dead,
Marketplace Insights is restricted-access, the Buy APIs are EPN-gated in
production, and Finding/Shopping are retired.

**The manual rails in §13c-bis are the part that still needs a human**, and
since they are now how sold data reaches him at all, they are the highest-value
check left in this document.

### 13a — What was measured, and why it closes the question

On 2026-07-28, against a healthy SerpApi account (Free Plan, 250 searches a
month, 235 remaining) and a healthy eBay engine:

| request | result |
|---|---|
| `_nkw=nike air force 1`, **no filter** | HTTP 200, **240 results** |
| `show_only=Sold,Complete` | HTTP 200, **0 results** |
| `show_only=Sold` | HTTP 503, archive `status: Error` |
| `popular_filters=LH_Sold=1&LH_Complete=1` | HTTP 200, **0 results** |
| `show_only=Sold,Complete`, `_nkw=pyrex bowl`, minimal params | HTTP 200, **0 results** |

The request is not wrong. SerpApi echoes `show_only` back in
`search_parameters`, and an illegal value is refused outright — `show_only=Sold
Items` returns HTTP 400 *"Unsupported option"*. So `Sold,Complete` is the
correct string, which confirms rather than overturns the H1 finding. The engine
answers; only the sold arm is empty.

That reproduces **every** sold lookup this project has made: R1 (5 queries), D1
(2), H2 (5) and this session (2), across four sessions and several days. The
conclusion is that **eBay gates sold/completed search and SerpApi's scraper does
not get through it.** No amount of retrying, waiting or re-querying changes it,
and the archive confirms the 503s are genuine failures rather than slow searches.

### 13b — What shipped anyway, and why

The ladder, the relay, the repricing, the receipt and the spend discipline are
all built and machine-verified (57 unit assertions, 20 headless). Pointing tier
A at a working sold feed later replaces one function, `fetchSold`, and nothing
else. Until then the relay answers `unavailable` and the app is
**indistinguishable from V1** — which is itself one of the headless assertions,
not a hope.

Nothing on screen ever claims sold data it does not have.

### 13c — If a sold source is ever wired, check these

Only meaningful once §13a is no longer true. Set `SERPAPI_KEY` (or repoint the
relay), then:

- **A real payload's `sold_date` parses.** The format is the one thing the
  fixtures could not capture, so `parseSoldDate` was written to return null
  rather than guess. If a live payload produces `windowDays: null` on rows that
  clearly carry dates, the parser needs the real format — the prices will still
  be right, and only velocity goes quiet. Result: ☐ pass ☐ fail: ______
- **A 35-item Saturday costs ≤ 35 credits.** Check `plan_searches_left` on
  serpapi.com before and after. The query-keyed cache should make repeats free;
  a count materially above the item count means the cache key is not matching.
  Result: ☐ before ______ ☐ after ______
- **The median is sane against eBay's own sold filter.** Open the Why sheet's
  "See sold listings on eBay" link on three items and eyeball the app's median
  against the page. Result: ☐ pass ☐ fail: ______
- **A flip is legible in an aisle.** Force one (an item whose sold median is
  below its floor) and confirm the toast is readable before it clears.
  Result: ☐ pass ☐ fail: ______

### 13c-bis — The manual sold rails (B1-lite)

**This is the one to actually run, and it needs only a phone with the eBay app.**
Since §13a closed the automated route, these rails are how sold data reaches him
at all.

- **The aisle rail.** Analyze an item → open the Why sheet → tap **Research
  solds in the eBay app**. Expected: a toast confirms the copy and the coach
  mark shows *"Copied — eBay app → Selling → Product Research → paste."*
  Then switch to the eBay app, Selling → Product Research, paste, and **real
  sold data appears for the right item.** Result: ☐ pass ☐ fail: ______
- **What got copied is worth reading.** It is the model's identification,
  normalized — not the long generated listing title. If the paste returns
  nothing, note what was on the clipboard: that is a query-construction finding,
  not a rail failure. Copied text: ______________________
- **The listing rail.** Same three buttons in the listing editor's pricing
  block, built from the title as edited. Result: ☐ pass ☐ fail: ______
- **`Product Research (desktop)` on the phone.** The open question a scripted
  client cannot answer. Measured 2026-07-29: the URL redirects to eBay sign-in
  with the keywords preserved, so it does not dead-end. **Unknown: what a
  signed-in phone gets after that** — the real Product Research tool, a desktop
  layout that is merely awkward, or a bounce back to the app. Whichever it is,
  the button is labelled `(desktop)` so the answer is never a surprise. If it
  bounces outright, drop the third button and leave the pair.
  What actually rendered: ______________________
- **Copy on a non-secure origin.** If the app is ever opened over plain `http`
  on the LAN, `navigator.clipboard` is undefined and the `execCommand` fallback
  carries it. Worth one tap to confirm, since that is how a demo happens.
  Result: ☐ pass ☐ fail: ______

### 13d — The daily-cap copy (H2's product finding)

Independent of comps, and testable today. H2 measured free-tier Gemini keys
stopping at `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, **20 requests a
day**, against a Saturday of ~35 items.

- Run 20 analyses on a free-tier key and confirm the 21st says *"Daily AI limit
  reached — verdicts return tomorrow"* rather than the generic quota copy.
  Result: ☐ pass ☐ fail: ______

> **Enable billing on the Gemini key before a real trip.** At 3.6-flash pricing
> a full item is roughly \$0.01–0.02, so a 35-item Saturday is well under a
> dollar — and the alternative is the app going dark two thirds of the way
> through the day. The daily cap is not a rate limit that clears if he waits.

---

## What is already verified, so you don't re-run it

Green in the V1+S1 build, headlessly: `npm test` (20 specs on `calcProfit`,
`checkRules`, `pencilFloor` incl. the $46.50 case); the no-key path end-to-end;
all four error codes rendering their specific copy while Add-to-cart keeps
working; Settings and the key sub-view surviving refresh; the key masked to
last-4 and never rendered, logged, or exported; backup excluding
`thrift-flip-ai-key` and import restoring a cart; PWA manifest/icons/metas; a
27MB photo storing at 204KB after downscale.

Green in the M2 build, headlessly: the viewfinder streaming from a fake device
and one shutter tap landing jpeg bytes in the photo store and analyzing through;
a refused camera falling back to the brackets, the native-camera shutter and no
nag; and the shipping estimate spent, clamped at both bounds, labelled by
provenance, with the pencil floor still $46.50. The sweep now runs at 360×800,
375×667, 390×844 and 430×932. **§12 is what none of that reaches.**

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
