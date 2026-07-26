# Thrift Flip — eBay Connect Spec v1
### "Sign in with eBay": the two-way pipeline — **developer account approved; config unblocked, code sequenced later**
### Companion to `thrift-flip-vision-pipeline-v1.md` and `thrift-flip-nostr-spec-v1.md`
### Repo: `silentius-satoshi/thrift-flip`

---

## 0. Where We Actually Stand (corrected July 2026)

**The eBay developer account is APPROVED.** This section originally read "there is no approved eBay developer account yet — every earlier note assuming one is void," which was true when the spec was written and is now itself the void note. §2 below is the record of what the application involved and what still has to be configured.

**Outstanding setup — do it now, it blocks nothing and takes about an hour** (§2 steps 3, 5, 6):
1. A **sandbox test user** on sandbox.ebay.com to connect against.
2. The **RuName redirect** mapped to `https://<app-domain>/ebay/callback`, plus its sandbox equivalent.
3. The **Marketplace Account Deletion endpoint** (§4) live and responding to eBay's challenge — ~30 lines, and the one thing that actually blocks hobbyists.

**But E1's code is not next.** The July 2026 resequencing (`thrift-flip-plan.md` §6) puts model validation, a working AI verdict, a real thrift-store trip, and the front-end component layer ahead of it: **E1–E2 run after F4.** Doing the three setup items above now means E1 starts cold when it arrives, which is the whole reason they are off the critical path rather than on it.

The invitation-only wall people hit is **Marketplace Insights** (sold-price data), which this architecture already routes around (vision spec §4) and never depends on.

**Sequencing note — this spec assumes a Nostr layer that is now deferred.** `thrift-flip-plan.md` §6.1 is the authority and outranks this document wherever they disagree about *when* something exists. Three places matter:

- **§5's "wrapped into the vault"** — the vault is Nostr N1, now unscheduled. §5 step 2 carries the interim inline. **Plan §6.1 has re-opened this decision** for the eBay token specifically, since an ~18-month refresh token is account access rather than a revocable free-tier key; its recommended option is an **"N1-lite" vault** (WebAuthn PRF/PIN → AES-GCM, no Nostr identity) shipped at E1. **Settle that before E1's prompt is written.**
- **§8's E1 gate** — "tokens visible only as ciphertext" cannot pass without a vault; the substitute is inline, and the real gate has no date.
- **§3's NIP-98** — no Nostr key means no signed requests; the relays ship behind a bearer secret. Treat that as the posture, not a placeholder.

§6's Blossom photo URLs and §7's history-event storage were amended in place and no longer need reading around.

---

## 1. The Tier Ladder (nothing blocks on eBay)

Same shape as the vision pipeline's ladder — each tier fully useful, each upgrade optional:

| Tier | What "Send to eBay" means | Dependency |
|---|---|---|
| **E0 — Copy-assist (the floor)** | "Copy for eBay" builds a clipboard package (title, description, specifics, price) + deep-links to eBay's own Sell flow; Dad pastes. Also the existing "Copy for Mercari" (vision spec V1.5) | None |
| **E1 — Sandbox** | Full OAuth + draft creation against `sandbox.ebay.com` before pointing at production | Free dev signup ✅ done |
| **E2 — His keyset, production** | One-tap real drafts; sold orders and views/watchers flow back into Selling | Approved production keyset ✅ done |
| **EH — Hosted keyset (future business)** | Paying customers connect through *our* keyset and skip all setup — the Personal-BLOC ch.17 split | The subscription product |

> **Naming note:** this tier was called "E3" and has been renamed **EH**, because §8's build order also has an **E3** (inbound orders and traffic) and the two were being cited interchangeably across four documents. EH = *hosted*. Anywhere the plan says "the EH hosted-tier model," it means this row; anywhere it says "E3," it means §8's inbound step.

Dad runs E2. The app is complete at E0.

---

## 2. The Developer Account (record of what was done, and what's left)

1. **developer.ebay.com → Register** — free; his (or your) normal eBay credentials or a fresh developer login. ✅
2. **Sandbox keyset** (App ID / Cert ID / Dev ID) — issued immediately on signup. ✅
3. **Create a sandbox test user** (sandbox.ebay.com) — a fake seller account for E1 testing. ⬜ **Do this now.**
4. **Production keys** — requested and granted. The application asks what the app does; the answer that worked is the honest one: *"Personal listing tool for a single household seller: creates draft listings on the seller's own account and reads the seller's own orders and traffic analytics. No third-party data access, no data resale, listings created only with explicit per-item user action."* Single-user self-tooling with `sell.*` scopes is the least controversial category they review. ✅
5. **The account-deletion requirement (§4)** — endpoint (or exemption) must be satisfied. ⬜ **Do this now.**
6. **Configure the redirect (RuName):** eBay's OAuth redirects go to a registered **RuName** mapped to an HTTPS URL — set it to `https://<app-domain>/ebay/callback` (production) and the equivalent for sandbox. Localhost is fine for sandbox development. ⬜ **Do this now.**

---

## 3. Architecture — where "zero servers" honestly bends

Two facts force a thin relay, and it's worth being precise about why:

1. **eBay's REST APIs do not serve CORS headers.** A browser page cannot call `api.ebay.com` directly. (Gemini's API *does* support browser calls — which is why the vision pipeline stays client-direct, with no relay at all. Different vendors, different rules.)
2. **eBay's token exchange requires the client secret** in a Basic-auth header; eBay does not support a PKCE-only public client.

The sovereign-compatible answer — and Personal-BLOC's own precedent (its repo ships `api/strike-*.js`, `api/btc-*.js`: thin Vercel functions relaying third-party APIs that lack CORS) — is **stateless edge relays living in the app's own repo**:

```
/api/ebay/oauth.js      — code→token exchange + refresh (holds EBAY_CERT_ID as env var)
/api/ebay/proxy.js      — forwards Sell API calls, adds CORS, streams response
/api/ebay/deletion.js   — the account-deletion challenge endpoint (§4)
/api/serpapi/comps.js   — (vision V2 rides along: SerpApi has no CORS either)
```

Rules that keep this inside the sovereignty line:
- **Stateless by construction:** no database, no KV, no logging of bodies or tokens. The relay sees tokens in flight and stores nothing. This satisfies the original principle as actually stated — *no server holds user data* — not the stricter "no server exists," which eBay's CORS policy makes impossible for a web app. (A future native/Capacitor wrapper removes the CORS problem and can retire `proxy.js`; `oauth.js` remains for the secret.)
- **Auth on the relay — what ships, and what was specced.** The design is NIP-98: every request carries a signed kind-27235 event, and the relay verifies signature, URL, method, payload hash, a 60s window, and an allowlist of Dad's pubkey (nostr §9 has the client helper and the full checklist). **That needs a Nostr key, and the N-track is deferred (§0), so what actually ships is a shared bearer secret baked into the client build.** Call it what it is: a speed bump against a stranger who finds the URL, not authentication — anyone with the client bundle can read it. Its blast radius is the eBay app credentials in `oauth.js`, which are rotatable from the developer dashboard. Structure the handlers so the NIP-98 checklist drops in as a straight replacement, not a second layer. **Never ship these endpoints ungated.**
- **Deploys with the app:** same repo, same Vercel project, zero extra infrastructure to run or pay for.

Everything else: tokens live wherever §5 and the §0 credential decision settle, and all eBay *state* — drafts, sold history — lives in `storageService`.

---

## 4. The Account-Deletion Endpoint (the hobbyist-blocker, solved)

eBay requires production keysets to receive **Marketplace Account Deletion** notifications (or claim a no-data exemption). Since Thrift Flip's relay stores nothing, the exemption is arguably available — but the endpoint is ~30 lines and removes all review friction, so build it:

- `GET /api/ebay/deletion?challenge_code=X` → respond `200` with JSON `{ "challengeResponse": sha256hex(challenge_code + VERIFICATION_TOKEN + ENDPOINT_URL) }` — hashed **in that exact order**.
- `POST` (an actual deletion notice) → `200` immediately. There is nothing to delete server-side; the client holds no other users' data at all.
- `VERIFICATION_TOKEN` (32–80 chars, self-chosen) and the endpoint URL go into the eBay dashboard alert settings.
- **This endpoint is exempt from the §3 auth gate** — eBay calls it unauthenticated, by design, under both the bearer-secret and NIP-98 schemes. Its own security is the token-hash challenge.

---

## 5. The Connect Flow (what Dad sees)

**Your keys → eBay → "Connect eBay"** — a row under the AI key, in the Settings screen V1 builds (`thrift-flip-plan.md` §6.1).

1. Tap → full-page redirect to eBay's own sign-in (`auth.ebay.com/oauth2/authorize?...&redirect_uri=<RuName>&scope=...&state=<nonce>`). He signs in with his normal seller account and taps **Agree**.
2. eBay redirects to `/ebay/callback?code=…` → the app POSTs the code to `/api/ebay/oauth` → relay exchanges it (Basic `AppID:CertID`) → returns `{ access_token (2h), refresh_token (~18mo) }`.
   - **The design (post-vault):** both are wrapped under `STORE_ENC_INFO` — same Face ID unlock as the AI key — and, once N2/N3 exist, synced as a 30078 event (`d: thrift-flip:ebay-tokens`, NIP-44-to-self) so his other devices inherit the connection.
   - **What ships depends on the §0 decision.** If N1-lite is built at E1, the above is true from day one minus the sync. If not, both tokens are written through `storageService` in plaintext with a `// TODO: migrate to vault STORE_ENC_INFO` marker at the write site. Either way, multi-device inheritance needs N2/N3 and does not exist at E1. And either way: **tokens never appear in a URL, a log line, or an error message.**
3. Row now reads **"Connected as <username> · through <month year>"** with Test, Disconnect (revokes locally + advises eBay-side revoke via account settings), and — from month 17 — a yellow **"Reconnect eBay soon"** nag, same escalation pattern as the backup gate.
   - **While tokens are plaintext:** the row's detail screen carries the interim risk note required by plan §6.1, in the same register as the AI key's (vision §2.5) — *"Your eBay connection is stored on this phone. Anyone who can unlock your phone can use it. Disconnect here, or revoke it in your eBay account settings."* Disconnect must be reachable from that same screen. The note is deleted in the commit that moves the tokens into a vault.
4. Access-token refresh is invisible: on 401, the client calls `/api/ebay/oauth` with the refresh token and retries once.

**Scopes — request the minimum that serves the pipeline:**
```
sell.inventory            → create/replace inventory items + draft offers (outbound)
sell.account.readonly     → read business policies (policy IDs are required fields on offers)
sell.fulfillment.readonly → sold orders: final price, date, buyer region (inbound → comps flywheel)
sell.analytics.readonly   → traffic report: views, watchers per listing (inbound → Selling tab)
```

---

## 6. Outbound — one-tap drafts

`List it on eBay` → client builds from the already-generated listing:
1. `createOrReplaceInventoryItem` — **SKU = the item's id.** That is the local id `saveDraft` already upserts by; if Nostr events ever ship, the same id becomes the event id, unchanged (plan §6.1 — do not mint a second identifier). Photos: see the open question below.
2. `createOffer` (`marketplaceId: EBAY_US`, format `FIXED_PRICE`, price, category, policy IDs from `sell.account`)
3. **Stop.** Unpublished offer = a draft in Seller Hub — Dad reviews on the big screen and publishes there. `publishOffer` stays behind a Settings toggle ("List live directly") that ships **off**; per the earlier product decision, human review is a feature.

> **Open question — the photo path. Resolve before E2 starts.** This step originally sourced listing photos from Blossom URLs (Nostr N4), and **N4 is now deferred indefinitely** (§0), which makes the question urgent rather than academic — there is no longer a later step that solves it. Candidates: create drafts photo-less and let Dad add photos in Seller Hub, where he is already reviewing before publishing (cheapest, zero new surface, and now probably the right answer); the legacy Trading API `UploadSiteHostedPictures`, which takes a binary upload rather than a public URL; or a relay-side upload endpoint. **Not yet researched — amend this section, do not improvise inside a build prompt.** (Vision §6's ImgBB-decommission row carries the same Blossom assumption and should be amended with whatever this settles.)

Failure honesty: eBay's category/aspect validation errors are cryptic — surface them mapped to the field they name, and always offer **"Copy for eBay instead"** (E0) as the escape so a validation fight never strands the listing.

---

## 7. Inbound — the flywheel's fuel

On Selling-tab open (+ pull-to-refresh; no background jobs):
- `getOrders` (fulfillment, last 90d) → match SKU→item → mark **Sold**, record final price/date → append to **`thrift-flip-sold-history`**, a `storageService` store keyed by item id. This is the personal-comps dataset that fills tier 0 of the vision spec's comps ladder (vision §4) and that the verdict's provenance sheet ranks first. Until E3 ships, that tier returns empty and the ladder starts at A. *(If Nostr N2 ever lands, this store joins the d-tag map as `thrift-flip:sold-history` with no shape change — nostr §7. The spec previously said "append to the item's history event," which described a post-N2 state.)*
- `getTrafficReport` (analytics) → views/watchers per active listing → the "Live" rows in Selling

Cache verdict-cheap: last pull timestamp in prefs; a manual refresh is always allowed.

---

## 8. Build Order

*(Position in the overall sequence: after F4. See `thrift-flip-plan.md` §6.)*

**E0 — Copy-assist floor (ships with vision V1.5, right after the first trip, zero eBay dependency).** "Copy for eBay" package + deep-link. *Gate:* full listing pastes cleanly into eBay's Sell flow on the phone.

**E1 — Sandbox connect.** Deletion endpoint live, RuName configured, sandbox test user created, `/api/ebay/oauth` + token storage per the §0 credential decision, Connect flow against that test user. *Gate:* sandbox connect round-trips; kill network mid-callback → clean retry, no token loss; an unauthenticated call to `/api/ebay/oauth` is rejected; and **tokens present only in their agreed store, absent from logs, URLs, and error messages.** The original gate — *tokens visible only as ciphertext* — passes here only if N1-lite was built; otherwise it moves to whenever a vault ships, **which is currently unscheduled. Do not record it as passed** (plan §6.1).

**E2 — Outbound drafts (sandbox → production).** Inventory+offer creation; policy fetch; error mapping; the Settings publish-toggle (off). Resolve §6's photo open question first. *Gate:* draft created from the app appears in (sandbox, then real) Seller Hub with specifics and price intact — and photos, by whichever path §6 settles on; a forced validation error surfaces on the named field and Copy-assist remains reachable; **the created draft appears untouched in Vendoo's import screen** (the check deferred from vision §7's V1.5 gate, which needs API draft creation to exist).

**E3 — Inbound.** Orders + traffic → Selling tab; sold results write to `thrift-flip-sold-history`; comps tier 0 goes live and the provenance sheet reads "Your own sales" from real data. *Gate:* a sandbox sale shows as Sold with final price; the next analyze of a similar item cites it as tier 0.

**E4 — Token lifecycle polish.** 401→refresh→retry path, month-17 nag, disconnect. *Gate:* delete the access token manually → next call self-heals. **The multi-device half — sync via the 30078 event, "second device connects nothing and still lists" — needs Nostr N2/N3 and is therefore unscheduled** (plan §6.1); E4 ships the single-device half and that gate waits. It is the same unrun test as nostr §13's N3 gate and vision §2.5's fifth check.

---

## 9. Out of Scope

Auto-publish by default (toggle ships off) · order fulfillment/shipping-label purchase (Seller Hub's job) · messaging buyers · Marketplace Insights API (routed around; apply opportunistically, never depend) · multi-account support (an **EH**-tier business feature, §1) · Mercari/Poshmark automation (permanently out — vision spec V1.5's three-lane distribution stands).
