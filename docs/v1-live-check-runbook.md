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

## What is already verified, so you don't re-run it

Green in the V1+S1 build, headlessly: `npm test` (20 specs on `calcProfit`,
`checkRules`, `pencilFloor` incl. the $46.50 case); the no-key path end-to-end;
all four error codes rendering their specific copy while Add-to-cart keeps
working; Settings and the key sub-view surviving refresh; the key masked to
last-4 and never rendered, logged, or exported; backup excluding
`thrift-flip-ai-key` and import restoring a cart; PWA manifest/icons/metas; a
27MB photo storing at 204KB after downscale.

Green in the N1-lite build: the whole wrap/unwrap contract on the PIN path
(round-trip, wrong PIN, the `payloadKind` refusals, the HKDF label); the
migration sweep off plaintext; PIN rate limiting and its escalation; §5.7's
single-flight guard, PIN-aware; a key-less profile prompting for nothing; and
headlessly, the enrolled key absent from both localStorage and IndexedDB in the
clear. **Only §5 above is left, and only because WebAuthn cannot run headless.**
