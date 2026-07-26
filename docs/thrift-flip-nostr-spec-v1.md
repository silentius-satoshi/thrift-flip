# Thrift Flip — Nostr Integration Spec
### Mode: Native — Nostr keypair is the only identity; relays are the only remote data layer
### Roadmap Placement: Steps N1–N6 — **DEFERRED (July 2026).** Gated on the subscription product, not on Dad's daily use. See `thrift-flip-plan.md` §6.1
### Version: 1.2 (§0 erratum + deferral note)
### Repo: `silentius-satoshi/thrift-flip`

---

## 0. Read First — two corrections and a deferral

### 0.1 Erratum — n8n is dead, and old N5 moved house

**This spec was written when the AI compute layer was an n8n instance on Railway. That component was deleted before it was ever wired.** Every reference has been corrected in place; this table is the translation of record, and it wins over any phrasing that survived below.

| Old (do not build) | Current |
|---|---|
| n8n stateless proxy holds the Gemini key and forwards analyze/chat/listing requests | **The client calls Gemini directly** on Dad's own BYOK key — Google's API serves CORS headers, so no server sits in the path at all (`thrift-flip-vision-pipeline-v1.md` §0, §2) |
| **Step N5 — NIP-98 auth on the n8n webhooks** | **N5 as a standalone step is retired.** NIP-98 verification belongs to the thin edge relays that *do* exist — `/api/ebay/*` and `/api/serpapi/*` in the app's own repo — specced in `thrift-flip-ebay-connect-v1.md` §3. The client helper in §9 below is still exactly right; only the thing it authenticates to changed |
| "no server exists" | **"no server holds user data"** — the honest form of the principle. eBay and SerpApi serve no CORS headers and eBay's token exchange needs a client secret, so a stateless relay is unavoidable for a web app. It stores nothing, logs no bodies, and deploys from the same repo |

### 0.2 The deferral — this whole track is parked

**As of the July 2026 resequencing, N1–N6 have no scheduled position in the build order.** The order is now V0 → V1+S1 → T1 (a real thrift-store trip) → V1.5/E0 → F1 → F2 → A-track → F3 → F4 → E1–E2 → V2–V4 → E3–E4, and this track sits after all of it, gated on the subscription product becoming real rather than on Dad needing it. The reasoning is in `thrift-flip-plan.md` §6.1: for Dad's actual risk — losing the business record with the phone — a JSON export/import pair ships in S1 and covers the disaster case, while the vault, PRF unlock, sync engine and relay reconciliation are the highest-risk work in the project and exist mainly to serve portable identity, no-accounts billing, and multi-device. Those are product-roadmap needs on a different clock.

**Nothing in this spec is retracted.** The architecture stands and the completion gates stand; only the date is gone. But treat every timing claim below as stale unless it agrees with plan §6.1 — including §1's "when to begin," §2's ordering, and §15's start row, all of which have been updated to match but which predate the deferral in spirit.

**Two consequences to carry, because they are live *now*:**

- **Credentials stay in plaintext for as long as this track is parked.** The AI key (vision §2.5) and the eBay OAuth tokens (ebay-connect §5) are both specced to live under this spec's `STORE_ENC_INFO` key. They ship long before it. Plan §6.1 has **re-opened that decision** for the eBay token specifically — an ~18-month refresh token is account access, not a free-tier API key — and names an **"N1-lite"** option: build `keyVault.ts` alone (capability probe, PRF/PIN, HKDF → AES-GCM, the `STORE_ENC_INFO` label) with **no** NIP-06 identity, no twelve words, no backup ceremony, no sync. §5.2's two HKDF labels already make that separation clean. If that option is taken, it lands at E1 and full N1 later adds the identity half on top of a vault that already exists.
- **NIP-98 on the relays does not arrive on this timeline.** §9's client helper is written and correct, but the relays ship behind a shared bearer secret instead (ebay-connect §3), and §8's "NIP-98 prevents using the relay to impersonate" describes a mitigation that is not currently scheduled. Read that row as aspirational.

---

## 1. Why This Spec Exists

Thrift Flip currently stores every byte of Dad's business — cart, drafts, listing edits, conversation history, trip history — in a single browser's localStorage. One cleared cache, one lost phone, and the business record is gone. Nostr replaces that with a portable identity (one keypair) and censorship-resistant storage (encrypted events on public relays) with **zero accounts, zero database, zero server that holds user data**. Dad's iPhone and the desktop see the same cart because they hold the same key, not because a company's server sits between them.

This spec implements **Mode C: Native** integration. There is no existing auth to bridge — `UserContext` is a hardcoded stub (`local-user-001`) built explicitly to be replaced, and `storageService.js` was built as the exact seam this spec plugs into. Native mode is the only mode that satisfies the stated constraint: *no reliance on central servers to store data*.

**What this spec does NOT cover:**
- The Gemini vision pipeline — see `thrift-flip-vision-pipeline-v1.md` (companion spec)
- The visual redesign — see `thrift-flip-frontend-spec-v2.md` (companion spec; v1 is superseded)
- The eBay integration and the edge relays — see `thrift-flip-ebay-connect-v1.md` (companion spec)
- Payments/subscriptions (Lightning/NIP-57, BTCPay) — future spec; this architecture is deliberately compatible with it, and is now sequenced *with* it (§0.2)
- Publishing anything publicly to the Nostr social graph — all Thrift Flip data is private, encrypted to self

**Provenance of the custody design:**
§5 is ported from `silentius-satoshi/Personal-BLOC` — a shipped, iOS-verified implementation of exactly this problem (Face ID/WebAuthn-PRF unlock, PIN fallback, BIP-39 recovery words, backup gate). It is not designed here. The same pattern is now captured as `references/key-custody.md` in the `nostr-spec-generator` skill so every future Native-mode spec starts from it.

**Relationship to other specs / build steps:**
AI compute is **not a server** — the client calls Gemini directly on Dad's key (vision spec §2). The only remote code we run is the pair of thin stateless edge relays that exist because eBay and SerpApi refuse browser calls; they hold API secrets as env vars and store nothing. `thrift-flip-ebay-connect-v1.md` §3 defines them; §9 below defines how they would be signed once a key exists.

**When to begin:** not on a technical trigger — on a product one. The old precondition ("confirm the vision model choice first") existed because N5 wired NIP-98 into the AI webhooks; with AI calls going direct from the client, that coupling is gone. The gate now is `thrift-flip-plan.md` §6.1: **the paid tier becoming real, or a second device genuinely mattering.** The partial exception is the N1-lite vault (§0.2), which may be pulled forward to E1 on its own.

---

## 2. Roadmap Context

| Step | Feature | Status |
|---|---|---|
| — | Five-tab UI (Shop / Flip / Cart / Listing / History) with mock data | ✅ Complete |
| — | `storageService.js` abstraction over localStorage | ✅ Complete |
| — | `UserContext` stub (`local-user-001`) | ✅ Complete |
| **N1** | **Identity: NIP-06 words, Face ID/PRF vault, backup gate + ceremony, and the AI-key/eBay-token migration into the vault** | ⏸ **Deferred** (§0.2) — the vault half may arrive early as N1-lite |
| **N2** | **NostrStore: kind-30078 encrypted event layer behind `storageService`** | ⏸ Deferred |
| **N3** | **Sync engine: local-first cache + relay reconciliation + multi-device** | ⏸ Deferred |
| **N4** | **Photos: Blossom uploads for listing photos; local-only shopping photos** | ⏸ Deferred — **but its local half is now urgent, see below** |
| ~~N5~~ | ~~NIP-98 auth on the n8n AI proxy~~ — **retired; see §0.1** | ➡️ Moved to the edge relays |
| **N6** | **Relay management UI + optional personal relay (Railway)** | ⏸ Deferred |
| — | Lightning zaps / paid tier (NIP-57 + BTCPay) | ⬜ Future spec — **and now the gate for everything above** |

Internal dependencies are unchanged: N2 requires N1, N3 requires N2, N4 is independent after N2, N6 is polish after N3.

> **N4's local half is separable and may be needed sooner.** N4 bundles two unrelated things: Blossom uploads for *listing* photos (needs a Nostr key, genuinely deferred) and moving *shopping* photos from base64-in-localStorage to IndexedDB (needs nothing). The second is the fix for a live problem — the ~5MB localStorage cap has never been stressed because no real trip has ever run, and T1 is about to run one (plan §6.1, §8). S1 ships a downscale-and-cap guard first; if that proves insufficient, lift the IndexedDB half of N4 out and ship it alone. It has no Nostr dependency at all.

---

## 3. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│  Phase N1 — Identity (visible once, then one Face ID per launch)   │
│  First launch → 128b entropy → 12 BIP-39 words → NIP-06 key        │
│  → wrap the ENTROPY: Face ID (WebAuthn PRF) or PIN                 │
│      → HKDF → AES-GCM ciphertext + meta in IndexedDB               │
│  → backup ceremony: reveal → save → 2-word quiz → stamp            │
│      ⛔ sync is GATED until the quiz passes                        │
│  → unlock returns the key in memory only, zeroed after use         │
│  → migrate the AI key + eBay tokens out of plaintext into the      │
│      STORE_ENC_INFO vault (they shipped long before this step)     │
│  [N1-lite = the wrap + STORE_ENC_INFO half of this box, alone]     │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ key unlocked AND backup verified
┌─────────────────────────────────▼──────────────────────────────────┐
│  Phase N2/N3 — Data layer (invisible)                              │
│  storageService.setItem('thrift-flip-cart', …)                     │
│    → write localStorage cache (instant, unchanged UX)              │
│    → queue → NIP-44 encrypt(self) → kind 30078                     │
│      d:"thrift-flip:cart" → publish to 3 relays                    │
│  storageService.getItem(…)                                         │
│    → serve cache → background: fetch 30078, newest created_at wins │
│  Second device: import twelve words → state rehydrates from relays │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│  Phase N4 — Media                                                  │
│  Shopping photos → IndexedDB only (never leave device)             │
│      ↑ this half needs no key and may ship early (§2)              │
│  Listing photos → Blossom PUT (BUD-02, signed auth)                │
│    → sha256-addressed URL, mirrored to 2nd server                  │
│    → URL stored inside the encrypted draft event                   │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│  Signing the edge relays (would ship with E1 — currently a bearer  │
│  secret instead, §0.2)                                             │
│  Gemini: NOT here — direct client call, no relay, no signing       │
│  /api/ebay/* and /api/serpapi/* — the only remote code we run      │
│  Request carries NIP-98 Authorization event (signed, 60s window)   │
│  Relay verifies sig → calls eBay / SerpApi → returns → stores 0    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4. Database / Data Model Changes

**There is no database.** That is the point. The "schema" is the event kind map in §7 plus two local stores:

| Local store | Engine | Contents | Survives device loss? |
|---|---|---|---|
| Cache | localStorage (existing keys, unchanged) | Latest known value of every synced store | No — rebuilt from relays, or from the S1 JSON export until then |
| Vault + media | IndexedDB (`thrift-flip-vault`) | AES-GCM ciphertext of the NIP-06 entropy + `WrapMeta`, the AI key and eBay tokens post-migration, shopping photos, Blossom upload queue | Vault no — recovered by re-typing the twelve words; shopping photos intentionally ephemeral |

**Once the vault exists, credentials never join the plaintext cache.** The AI key and eBay tokens are the one class of synced store whose local copy lives in the vault as ciphertext rather than in localStorage — see §7's table. Everything else (cart, drafts, history) caches in the clear by design, because the cost of a stolen cart is a stolen cart, and the cost of a stolen refresh token is his eBay account. **That asymmetry is exactly why plan §6.1 re-opened the eBay-token decision when this track was deferred (§0.2): until a vault of some kind ships, both credentials are plaintext in the cache.**

**Storage format:** hex pubkey internally; `npub1…` for display only in Settings. A raw `nsec1…` is never rendered at all — recovery is always the twelve words (§5.1), and the wrapped payload on disk is entropy, not a key.

---

## 5. The Identity Layer — Key Custody

Ported from `silentius-satoshi/Personal-BLOC` (`src/lib/nostr/keyVault.ts`, `nip06Key.ts`, `backupGate.ts`, `session.ts`), which is production-verified on iOS Safari. Do not redesign this; adapt only the labels.

Dad is not a Nostr user and never needs to become one. He sees **Face ID** and **twelve words**. The strings `nsec`, `npub`, and `ncryptsec` appear nowhere in the UI outside a Settings detail row.

### 5.1 Generation — entropy, not a raw key

```
128 bits WebCrypto entropy
  → BIP-39 12 words (English wordlist)
  → NIP-06 path m/44'/1237'/0'/0/0, account 0, no passphrase
  → secp256k1 secret key
```

**Wrap the 16 bytes of entropy, not the 32-byte key.** A raw key can only be shown as a 63-character `nsec1…`; entropy can be shown as twelve words Dad writes on an index card and re-types. That is the entire difference between a recovery plan that works for him and one that doesn't.

The derivation path is **pinned by a test against published NIP-06 vectors, and a failure of that test is treated as data loss, not a stale fixture** — if the path ever changed, the same twelve words would silently derive a different key and every card written down would stop opening the shop. Never parameterize it. Pasted phrases are normalized (`trim().toLowerCase().replace(/\s+/g,' ')`) before validation so a phrase copied off paper with a doubled space still works; that normalization is part of the recovery contract, not a convenience.

### 5.2 The wrap — Face ID is key material, not a gate

The naive version calls WebAuthn, and if it resolves, reads the key out of storage. That is theatre — anyone with DevTools skips the check. The correct version uses the **WebAuthn PRF extension**, where the authenticator emits a stable credential-bound secret *only* on successful biometric verification. That secret is the IKM. Without Face ID the ciphertext is not "protected," it is mathematically unopenable.

```
PRF assertion ─┐
               ├→ IKM → HKDF-SHA256(salt, info) → AES-GCM-256 → ciphertext + WrapMeta
PIN → PBKDF2 ──┘   600,000 iterations on the PIN path
```

```ts
// src/lib/nostr/keyVault.ts
export async function probeKeyVaultCapability(): Promise<'prf' | 'pin'> {
  try {
    if (browserSupportsWebAuthn() && await platformAuthenticatorIsAvailable()) return 'prf';
  } catch { /* fall through */ }
  return 'pin';
}
```

- **Always probe, never assume.** PRF on platform authenticators needs iOS Safari 18.4+. Dad's phone qualifies; the PIN path exists for anything that doesn't, and for his desktop browser.
- **Registration does not return PRF output — only an assertion does.** Register, then immediately authenticate to obtain the IKM. This costs an hour to rediscover.
- `residentKey: 'required'` + `userVerification: 'required'` is what makes it a Face ID *unlock* rather than a second-factor tap.
- Isolate `prfRegister` / `prfAuthenticate` behind two functions. WebAuthn can't be tested in jsdom; the PIN path is fully unit-testable and shares every downstream line.

**One Face ID prompt, two independent keys** — vary only the HKDF `info` label:

```ts
const HKDF_INFO      = enc('thrift-flip/keyvault/v1');   // wraps the identity key
const STORE_ENC_INFO = enc('thrift-flip/store-enc/v1');  // encrypts credentials + records at rest
```

The second one matters more here than it did in the source app: Dad's cart, drafts, and trip history are business records sitting in a browser on a phone he carries into a store. Same unlock, cryptographically separate key, no second prompt. **`STORE_ENC_INFO` is also what the AI key and the eBay OAuth tokens migrate into** — and because the two labels are independent, **this whole subsection is buildable without any of §5.1**: that is precisely what "N1-lite" means (§0.2). Credentials-at-rest does not require an identity.

### 5.3 `WrapMeta` and the absent-means-legacy contract

```ts
export interface WrapMeta {
  iv: string; salt: string;                 // base64
  scheme: 'prf' | 'pin';
  credentialId?: string;                    // base64url, PRF only
  /** ⚠ ABSENT MEANS 'sk'. Compatibility contract for anything wrapped before this field existed. */
  payloadKind?: 'sk' | 'nip06-entropy';
}

// Read site — test for the NEW kind, never the old one:
if (meta.payloadKind !== 'nip06-entropy') return bytes;   // absent / 'sk' / unknown → legacy path
return deriveSkFromEntropy(bytes);
```

Optional field, absent means original format, **never infer the kind from byte length**, and mirror this warning at both the type definition and the read site — they get edited months apart by different people. *(If N1-lite ships first it will wrap credential blobs rather than entropy; give them their own `payloadKind` value rather than overloading either existing one.)*

### 5.4 The backup gate — refuse to sync

The honest problem with a freshly generated key: until Dad saves those words, **his phone holds the only copy in the world**, and the relays hold ciphertext only that key can open. Phone in a parking lot puddle → the shop is gone. Not "contact support" gone. Gone.

So the app refuses to sync — not a warning, a gate:

```ts
// src/lib/backupGate.ts — pure predicate, zero imports (no cycles)
export function isBackupGateSatisfied(s: {
  keyProvenance: 'generated' | 'imported' | 'external' | null;
  backupVerifiedAt: number | null;
}): boolean {
  return s.keyProvenance !== 'generated' || s.backupVerifiedAt != null;
}
```

Consulted at every publish path **and the sync entry point** — block pulls too, since a pull sets the flags that re-arm publishing. `'imported'` (he typed the words on a second device) and `'external'` (NIP-07/NIP-46) pass by construction. `backupVerifiedAt: 0` counts — test `!= null`, not truthiness.

**The ceremony, four steps:**

1. **Reveal** — twelve words on a blurred grid, tap to show
2. **Save** — download the file, save to a password manager, or scan the QR. Continue requires at least one.
3. **Quiz** — the app asks for two of the twelve, randomly chosen, **re-randomized on every miss**
4. **Stamp** — write `backupVerifiedAt`, the gate opens, first sync runs

> An "I backed it up" checkbox was built in the source app and retired for a stated reason: *an ack is a promise; a verification is proof.*

**"I'll do this later" must not break anything.** The app works fully offline — every tab, every calculation, the whole Goodwill trip. Only sync is off. The app then climbs a ladder: amber badge on Settings → dismissible nag card on Shopping and History (back at next launch) → hard gate on any screen that would create a relay copy. Deliberately loud, because an app that quietly isn't syncing is the dishonest version.

### 5.5 Sign out is not forget

| Action | Keeps | Clears | Weight |
|---|---|---|---|
| **Sign out** | cart, drafts, history, wrapped key, `backupVerifiedAt` | session signer only | neutral |
| **Remove key from this phone** | nothing | identity, provenance, **and all app data** | red |

*Clearing identity fields is not forgetting an identity* — if only the login state cleared, the cart and drafts would still sit in localStorage for whoever opens the tab next. A verified key stays verified across sign-out; signing out must never restart the backup nag. For a key that has **never synced**, the confirm copy warns of permanent deletion and must not claim the data "stays on the relay" — there is no relay copy to stay on.

### 5.6 Memory hygiene

| Representation | Zeroable | Who zeroes |
|---|---|---|
| `sk` (32B) | yes | caller, after the signer takes its copy |
| `entropy` (16B) | yes | caller; intermediates in a `finally` |
| **words (JS string)** | **no** | nobody — lives until GC |

Because the words string can't be zeroed it gets stricter rules: never persisted, never logged, never in an `Error` message, never in React state that outlives the screen showing it. **Error messages are an exfiltration path** — `@scure/base`'s decoder throws `Unknown letter: "<word>"`, interpolating a seed word. Validate before decoding *and* wrap the decode in a try/catch that rethrows a curated error, so the leak is structurally impossible rather than merely avoided.

Two more invariants: the vault module **returns** the unwrapped key and never persists it; and the signing identity is **derived from the payload just wrapped**, never accepted from the caller — otherwise the identity Dad authenticates as can silently disagree with what the ciphertext will later produce, and the wrapped key never unlocks the shop.

### 5.7 Concurrency — WebAuthn allows one ceremony at a time

Two simultaneous ceremonies abort one (`AbortError`) and loop the other (`NotAllowedError`). This app will hit it: a reactive sync can fire while the unlock gate is open. Single-flight the restore at module scope, and make the guard **PIN-aware** — a PIN-bearing call must not join a pinless in-flight restore, or a correct PIN gets reported as a failure by an already-doomed promise. Also re-read live state immediately before the ceremony and bail early if the signing method changed while the restore was queued, so no spurious Face ID prompt fires.

### 5.8 Labels

```ts
export function biometricLabel(): string {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'Face ID' : 'passkey';
}
```

Platform-honest everywhere. And never overclaim: until the `STORE_ENC_INFO` key is actually wired to the store, the copy says the *key* is protected, not the data.

## 6. Auth Phases

### Phase 1 — First-launch onboarding (Step N1)

**What happens:** No wrapped key found → onboarding: (1) "Your shop, your key" explainer, (2) capability probe → *"Use Face ID to unlock Thrift Flip"* or PIN fallback, (3) key minted and wrapped, (4) the backup ceremony (§5.4) — or "I'll do this later," which leaves the app fully working offline with sync gated.
**Trigger:** App mount, no `writerKeyWrapped` in the vault.
**User sees:** One Face ID prompt and twelve words. Existing localStorage data (his cart, drafts, and history — by then a real business record, not mock data) is adopted into the new identity automatically. Any AI key and eBay tokens still sitting in plaintext are swept into the vault in the same pass, and their interim risk notes are deleted with them. *(If N1-lite shipped at E1, the credentials are already wrapped and this step only adds the identity.)*

```javascript
// establishLocalOwner — one path, used by both key-gen and word-import, so they can't drift
const { entropy, words, sk, pubkeyHex } = generatePlanKey()
const { ciphertext, meta } = await wrapSecretKey(entropy, method, pin, keyLabel, 'nip06-entropy')
// ⚠ derive the signer from the payload JUST WRAPPED — never from a caller-supplied sk
vault.setWrapped(ciphertext, meta)
session.setSigner(new NSecSigner(deriveSkFromEntropy(entropy)))
setUser({ id: pubkeyHex, name: 'Dad', isAuthenticated: true, keyProvenance: 'generated' })
entropy.fill(0); sk.fill(0)              // words is a string — transient, never persisted
```

**Integration point:** `UserProvider` in `src/contexts/UserContext.jsx` — replace stub state with vault check + onboarding gate. Nothing else in the tree changes; every component already reads `useUser()`.

### Phase 2 — Session unlock (Step N1)

**What happens:** Wrapped key exists → Face ID assertion → PRF output → HKDF → AES-GCM decrypt → entropy → key, in memory. Same gesture derives the at-rest store key via the second HKDF label.
**Trigger:** App mount with an existing wrapped key.
**User sees:** The Face ID sheet, about a second. On a PIN-scheme device, one PIN field.
**Note:** this replaces the device-bound auto-unlock wrap proposed in v0 of this spec. Face ID every launch is both *faster* than a passphrase and *actually cryptographic* — the biometric produces the key material rather than merely gating access to it.

### Phase 3 — Device link (Step N3)

**What happens:** New device → onboarding offers "I already have a shop" → he types the twelve words → normalized, validated, entropy recovered → wrapped locally behind that device's Face ID → `keyProvenance: 'imported'` (gate satisfied by construction) → `syncEngine.fullPull()` rehydrates every store from the relays.
**User sees:** Twelve fields, then his own cart and history appearing. This is the demo moment — and the reason §5 wraps entropy instead of a raw key.

---

## 7. Data Publishing

Everything in this section describes the **post-N2** world; before then `storageService` is localStorage only and nothing publishes. Stores that ship earlier — the credentials at V1/E1, sold history at E3 — live as plain `storageService` keys and join the map below unchanged if and when N2 lands.

### What Goes Where

| Data Type | Local storage | Encrypted | Signer | When Published |
|---|---|---|---|---|
| Cart | cache + relay | Yes (NIP-44 to self) | local key | debounced 2s after change |
| History entries | cache + relay | Yes | local key | on add/delete |
| Drafts | cache + relay | Yes | local key | on save/auto-save |
| Conversations (Flip) | cache + relay | Yes | local key | debounced 2s after message |
| Listing-in-progress + edits | cache + relay | Yes | local key | debounced 2s |
| Sold history (comps tier 0) | cache + relay | Yes | local key | on eBay inbound pull |
| Screen/view/UI prefs | cache + relay | Yes | local key | debounced 5s (low priority) |
| AI key + eBay tokens | **vault + relay** once a vault exists (plaintext cache until then — §4, §0.2) | Yes | local key | on connect/replace |
| Shopping photos | IndexedDB only *(today: base64 in localStorage — §2)* | — | — | Never leave the device |
| Listing photos | Blossom servers | No (destined for public eBay) | BUD-02 auth event | on attach in Listing Mode |
| Relay list | relay (public) | No | local key | kind 10002, on change |
| Profile (npub display name) | relay (public) | No | local key | kind 0, optional |

**Encryption note (NIP-44 to self):** `conversationKey = getConversationKey(sk, ownPubkeyHex)` — encrypting to your own pubkey. Relays see opaque ciphertext under d-tags; the d-tag names below are the only metadata leaked. Acceptable: they reveal "this pubkey uses Thrift Flip," nothing about the contents. If even that is unacceptable later, N6's personal relay closes it.

### Event Kind Map

All app data uses **kind 30078 (NIP-78 parameterized replaceable)** — same-`d`-tag publish replaces the previous event, which maps 1:1 onto the existing `storageService.setItem(key, value)` semantics. The mapping is mechanical:

| Event | Kind | `d` tag | Encrypted | Trigger |
|---|---|---|---|---|
| Cart | 30078 | `thrift-flip:cart` | Yes | cart change |
| History | 30078 | `thrift-flip:history` | Yes | history change |
| Draft (per item) | 30078 | `thrift-flip:draft:{id}` | Yes | draft save |
| Drafts index | 30078 | `thrift-flip:drafts-index` | Yes | draft add/remove |
| Conversation (per item) | 30078 | `thrift-flip:conv:{id}` | Yes | message |
| Conversation index | 30078 | `thrift-flip:conv-index` | Yes | index change |
| Listing state | 30078 | `thrift-flip:listing` | Yes | listing change |
| Listing edits | 30078 | `thrift-flip:listing-edits` | Yes | edit (debounced) |
| Shopping form/verdict | 30078 | `thrift-flip:shopping` | Yes | change (debounced) |
| **Sold history** | 30078 | `thrift-flip:sold-history` | Yes | eBay inbound pull (E3; ships as a plain store first) |
| UI prefs (screen, flip view) | 30078 | `thrift-flip:prefs` | Yes | change (debounced) |
| AI key | 30078 | `thrift-flip:ai-key` | Yes | on set/replace |
| eBay tokens | 30078 | `thrift-flip:ebay-tokens` | Yes | on connect/refresh |
| Relay list | 10002 | — | No | Settings change |
| Profile | 0 | — | No | Settings change |

Per-item events (drafts, conversations) get their own d-tag rather than one giant blob — keeps each event well under relay size limits (photos are never inside events; Blossom URLs are) and makes deletes cheap (publish empty content + NIP-09 deletion request). Sold history stays a single store keyed by item id: it is append-only, small, and always read as a whole by the tier-0 comps lookup.

**Default relays (used when user has no NIP-65 list):**
```javascript
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
]
```

### The sync engine (Step N3) — the heart of it

```javascript
// src/lib/nostr/nostrStore.js — slots in BEHIND storageService, API unchanged
// write path: cache-first, relay-queued
export async function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value))          // existing behavior
  syncQueue.enqueue(key, value)                             // debounced publish
}
// ⚠ credential keys (ai-key, ebay-tokens) write to the VAULT sink, not localStorage.
//   That routing belongs to whichever step builds the vault (N1, or N1-lite at E1);
//   N2 preserves it rather than rebuilding it. See §4, §7, §0.2.
// publish (worker): NIP-44 encrypt → finalizeEvent(kind 30078, [['d', dTag(key)]]) → pool.publish
// read path: cache is truth for render; reconcile() runs on mount + visibilitychange:
//   fetch all d-tags for pubkey → for each: relay.created_at > cache.updatedAt ? adopt : republish
// conflict rule: last-writer-wins on created_at (single user, two devices — sufficient;
//   per-item d-tags mean a cart edit on the phone never clobbers a draft edit on desktop)
```

The existing "Direct read — sync required for useState lazy init" pattern throughout the codebase keeps working untouched — lazy inits read the localStorage cache synchronously, exactly as today. Only freshness improves.

---

## 8. Security Model

### Explicit Tradeoffs

| Scenario | Consequence |
|---|---|
| Phone stolen, vault built | The wrapped key needs a **successful Face ID assertion to produce its decryption material** — not a check the thief can skip. Without his face, the ciphertext is unopenable. This is the single biggest gain over the v0 device-wrap design |
| **Phone stolen, today** | AI key and eBay refresh token are **plaintext in localStorage**, readable if the phone is unlocked. Mitigations are the phone's own lock screen and one-tap revocation on both vendors. With this track deferred (§0.2) this is the standing posture, not a brief window — and it is why plan §6.1 re-opened the eBay-token decision |
| Face ID unavailable (new browser, desktop) | PIN path, PBKDF2 600k. Weaker than PRF, so the PIN minimum length and rate-limiting are real UI requirements, not polish |
| Recovery words leaked | Full read/write of the business record; attacker can publish as Dad. Rotate: mint a new key, republish every store under it, NIP-09 delete the old events (relays MAY honor) |
| Words lost + all devices lost | Permanent loss (standard Nostr risk) — data remains undecryptable ciphertext on relays |
| Key generated, never backed up, device lost | **Total loss — which is exactly why the backup gate (§5.4) refuses to sync until the word quiz passes.** Nothing was published, so nothing is orphaned |
| **Phone lost today, before any of this** | The S1 JSON export/import pair is the entire recovery story (plan §6.1). If he never exported, the business record is gone. Prompting for the export at the end of a trip is therefore a real safety feature, not a nicety |
| Relay operator malicious | Sees ciphertext + d-tag names + timestamps only. Can withhold/delete events → mitigated by 3-relay redundancy + republish-on-reconcile |
| All 3 default relays vanish | Cache still has everything → republish to new relays. N6 personal relay removes third-party dependence entirely |
| Gemini call intercepted | There is no intermediary to compromise — the browser talks to Google over TLS on Dad's own key |
| Edge relay compromised | Attacker sees eBay/SerpApi requests in flight and the secrets in env vars (eBay Cert ID, SerpApi key). Sees no stored data — there is none. **NIP-98 would prevent using the relay to impersonate, but is not currently scheduled (§0.2)** — today's protection is a bearer secret readable from the client bundle. eBay credentials are rotatable from the developer dashboard |
| Blossom server deletes listing photos | sha256-addressed → re-upload from IndexedDB queue or mirror; BUD-04 mirroring to a second server by default |

### What Is Never Stored
- Raw private key — memory only, zeroed after the signer takes its copy; at rest only as AES-GCM ciphertext of the *entropy*
- The twelve words — a JS string, unzeroable, therefore never persisted, never logged, never in an `Error` message, never in state that outlives the screen showing it
- The PIN — transient input to PBKDF2, never persisted, never held at module scope (the single-flight guard stores a boolean, not the PIN)
- Anything server-side — the edge relays are verified-stateless (no database, no KV, no body or token logging in any handler)
- Shopping-mode photos on any remote system
- **In the S1 JSON export: the credential keys.** A naive dump over `storageService` would write the plaintext Gemini key and eBay refresh token into a file in the Files app. Scope the export away from them (plan §6.1)
- Once a vault exists: the AI key or eBay tokens in the plaintext localStorage cache (§4, §7)

### Key Exposure Warning Copy (recovery sheet)

> **These twelve words are your shop.**
>
> They open your cart, drafts, history, and conversations on any phone. Anyone who has them has all of it. Thrift Flip has no company server and cannot reset or recover them for you.
>
> Write them on paper. Don't screenshot them.
>
> [ Continue ]   [ I'll do this later ]

The second button is not a dismissal — it defers the ceremony and leaves sync gated (§5.4). The button that *closes* the gate appears only after the two-word quiz.

---

## 9. Signing the Edge Relays (NIP-98)

No accounts, no database, no JWT — the two edge relays gain one verification step. **This section was written as "Step N5" against n8n webhooks; the client helper is unchanged, and the verification belongs in `/api/ebay/*` and `/api/serpapi/*` (see `thrift-flip-ebay-connect-v1.md` §3). It is not currently scheduled** — with the N-track deferred there is no key to sign with, so the relays ship behind a bearer secret instead (§0.2). Gemini needs none of this either way; that call is direct and carries Dad's own key.

```javascript
// src/lib/nostr/nip98.js
import { finalizeEvent } from 'nostr-tools/pure'
export function buildAuthHeader(sk, url, method, payloadSha256Hex) {
  const ev = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method], ['payload', payloadSha256Hex]],
    content: '',
  }, sk)
  return `Nostr ${btoa(JSON.stringify(ev))}`
}
```

Relay side (first lines of every handler):

**Verification checklist:**
- [ ] Event kind is 27235 and signature valid (`verifyEvent`)
- [ ] `u` tag exactly matches this endpoint's URL (no path confusion)
- [ ] `method` tag matches
- [ ] `payload` tag matches sha256 of the received body (request tamper-proofing)
- [ ] `created_at` within a 60-second window (replay prevention)
- [ ] Optional allowlist: pubkey ∈ {Dad's pubkey} until the app is multi-user — a one-line free tier gate

This is also the future billing hook: when subscriptions arrive, "pubkey has an active zap receipt / BTCPay invoice" replaces the allowlist. No accounts, ever. **Note the circularity the deferral creates: the billing hook lives in the track that is gated on billing existing.** Whichever arrives first should not assume the other.

**What ships instead:** a shared bearer secret baked into the client build — a speed bump against a stranger who finds the URL, not authentication. Structure the handlers so this checklist drops in as a straight replacement, not a second layer. `/api/ebay/deletion.js` is exempt in both eras — eBay calls it unauthenticated by design.

---

## 10. State Management

`UserContext` — the stub's shape barely changes, which is why it was built:

```javascript
{
  id: pubkeyHex,               // was 'local-user-001'
  npub: 'npub1…',              // display identity
  name: 'Dad',                 // kind 0 profile name, editable
  isAuthenticated: true,       // key unlocked this session
  plan: 'unlimited',           // unchanged until billing spec
  sync: 'synced' | 'syncing' | 'offline' | 'error' | 'gated',  // NEW — 'gated' = backup not verified
  relayCount: 3,               // NEW — Settings display
  keyProvenance: 'generated' | 'imported' | 'external' | null,  // NEW — backup gate input
  backupVerifiedAt: number | null,                              // NEW — backup gate input
  unlockMethod: 'prf' | 'pin',                                  // NEW — drives Face ID vs PIN copy
}
```

`keyProvenance: null` is the legacy/grandfathered case and must be satisfied structurally — the persist merge fills the absent field on every rehydrate. Deliberately no migration.

`sync` drives one small UI element (a dot in the nav or Settings row) — never a blocking spinner. The app is local-first; relay state is ambient information.

No new context providers. `syncEngine` is a module singleton, same pattern as `conversationStore`.

---

## 11. NIP-44 Layer Disambiguation

| Place in Thrift Flip | You have | Use |
|---|---|---|
| All 30078 store encryption/decryption | Local privkey `Uint8Array` | `encrypt(getConversationKey(sk, ownPubkeyHex), plaintext)` — **key first** |
| If NIP-07 extension present (desktop nicety) | Extension | `window.nostr.nip44.encrypt(ownPubkeyHex, plaintext)` — **pubkey first** |
| Event signing (30078, 27235, 24242, 10002, 0) | Any signer | `finalizeEvent(tpl, sk)` / `window.nostr.signEvent(tpl)` — **not NIP-44** |
| Key vault at rest | PRF output or PIN | `HKDF(ikm, salt, info)` → `AES-GCM` via WebCrypto — **not NIP-44, not NIP-49**. A separate scheme entirely; NIP-49's scrypt/`ncryptsec` is replaced by the PRF path because a passphrase Dad has to remember is strictly worse than his face |

The two argument orders are the classic silent failure. `nostrStore.js` and `nip98.js` are the only two files allowed to import crypto primitives — everything else goes through them.

---

## 12. New Dependencies

**Verify existing transitive deps first:**
```bash
npm ls nostr-tools @noble/hashes @noble/curves @scure/base
```
(At `b22906b`, `package.json` has none of these — React 19 + Vite 8 only. Re-check before starting; the versions below were verified July 2026 and this track may not begin for a long time, so treat them as a starting point to re-confirm, not as pinned truth.)

| Package | Version (verified July 2026) | Purpose | Added in Step |
|---|---|---|---|
| `nostr-tools` | `2.23.8` | keys, NIP-19/44/49, finalizeEvent, SimplePool | N1 |
| `@noble/hashes` | `2.0.1` (transitive) | sha256 for NIP-98 payload + Blossom | N1 |
| `@nostr-dev-kit/ndk` | `2.18.1` | optional — only if N3 outgrows SimplePool (subscriptions, outbox) | N3 (deferred) |
| `@nostr-dev-kit/ndk-blossom` | `0.1.32` | Blossom BUD-01/02/04 upload + mirroring + URL healing | N4 |
| `@simplewebauthn/browser` | `^13.3.0` | WebAuthn PRF registration/assertion (Face ID unlock) | N1 — **or N1-lite, which needs only this one** |
| `@scure/bip39` | `2.0.1` | entropy ⇄ 12 recovery words | N1 |

Only `@simplewebauthn/browser` is needed client-side — the `/server` package is for relying-party verification, which this app has no server to do. **N1-lite's dependency footprint is exactly one package**, which is part of why it is the cheap option.

Start with `nostr-tools` alone. SimplePool + 30078 replaceables is a small, auditable surface; pull NDK in only if N3's reconcile logic demands subscriptions.

---

## 13. Build Order

*(Sequence-free — these are dependency relationships, not dates. The whole track's start is gated per §0.2.)*

### Step N1 — Identity, vault, and the backup gate
Deliverables: `src/lib/nostr/nip06Key.ts` (generate/derive/normalize/validate, `InvalidSeedWordsError`), `src/lib/nostr/keyVault.ts` (capability probe, PRF register/assert, PIN PBKDF2, HKDF→AES-GCM wrap/unwrap, `WrapMeta`), `src/lib/nostr/establishOwner.ts` (the single identity-establish path shared by key-gen and word-import), `src/lib/backupGate.ts` (pure predicate), `src/lib/biometricLabel.ts`, `src/lib/vault.js` (IndexedDB), onboarding + word grid + quiz ceremony, Settings key section (reveal behind Face ID, sign out, remove key), `UserContext` rewrite, localStorage-adoption migration, **and the credential migration: AI key + eBay tokens moved from plaintext into `STORE_ENC_INFO`, their writes routed to the vault sink, their interim risk notes deleted.**

> **N1-lite** (§0.2) is `keyVault.ts` + `vault.js` + the `STORE_ENC_INFO` half of the credential work, with none of `nip06Key.ts`, `establishOwner.ts`, `backupGate.ts`, the ceremony, or the `UserContext` rewrite. Its gate is gate 2 plus the credential half of gate 5. Everything else here waits.

**Completion gates — all five:**
1. **Derivation pinned.** A test asserts the published NIP-06 vectors for `m/44'/1237'/0'/0/0` and that `deriveSkFromEntropy(entropyFromWords(w)) === skFromWords(w)`. Mark it in the repo as *failure = data loss, not a stale fixture*.
2. **The unlock is real.** Fresh profile → onboard with Face ID → force-quit → reopen → Face ID prompt → same pubkey. Then, in DevTools, confirm the stored value is AES-GCM ciphertext and that **no code path returns a key without a successful PRF assertion**. Cancel the Face ID sheet → unlock fails cleanly, no key in memory.
3. **Recovery round-trips.** Write down the twelve words → clear IndexedDB → import them → same pubkey, and a phrase re-typed with a doubled space and mixed case still works.
4. **The gate holds.** Generate a key, skip the ceremony → `nak req -a <pubkey>` against all three relays returns nothing, and no publish fires. Complete the quiz → first sync runs. Fail the quiz twice → different words asked each time.
5. **The interim is closed.** Grep localStorage after migration → no plaintext AI key, no plaintext eBay token anywhere; both round-trip through the vault. Plus, if NIP-98 ships here: the relays reject a request bearing the old shared secret and accept a signed one. **Both halves of this gate are currently unrun and will stay that way while the track is parked — do not let any build summary claim them as passed** (plan §6.1).

**QA notes:** iOS Safari caps IndexedDB in Private Browsing — detect and warn. PRF needs iOS Safari 18.4+, so test the PIN fallback on an older device or a desktop browser without a platform authenticator, not just the happy path. Registration does not return PRF output — assert immediately after registering.

### Step N2 — NostrStore
Deliverables: `src/lib/nostr/nostrStore.js`, d-tag map (including `thrift-flip:sold-history`, which ships as a plain store at E3), NIP-44-to-self helpers, rewire `storageService` internals (public API unchanged), per-item event split for drafts/conversations. **The credential→vault routing belongs to N1/N1-lite; N2 preserves it, not rebuilds it.**
**Completion gate:** Add a cart item → within 3s, `nak req -k 30078 -a <pubkey> wss://relay.damus.io` returns an event with `d=thrift-flip:cart` whose content is ciphertext; decrypting locally yields the cart JSON byte-identical to localStorage.

### Step N3 — Sync engine + device link
Deliverables: `syncEngine` (queue, debounce, reconcile on mount/visibility/online), conflict rule, sync status in `UserContext`, "Link a device" flow.
**Completion gate:** Device A adds 2 cart items + 1 draft → Device B (fresh, twelve-word import) shows both within 10s of onboarding. Edit cart on B, kill network on A, reopen A online → A adopts B's cart (newer created_at) without touching A's unsent draft edits. Second device inherits the AI key and eBay connection with nothing re-entered. *(This last check is also vision §2.5's deferred fifth gate and eBay §8's E4 sync gate — all three are the same unrun test.)*

### Step N4 — Blossom media (and the local half that need not wait)
Deliverables: `src/lib/nostr/media.js` (BUD-02 auth event kind 24242, sha256 upload, BUD-04 mirror), Listing Mode photo section rewired, upload queue in IndexedDB, **shopping photos migrated to IndexedDB** — the last of which has no Nostr dependency and may be lifted out early if S1's quota guard proves insufficient (§2).
**Completion gate:** Attach 3 listing photos → each returns `https://<server>/<sha256>` reachable logged-out in a clean browser; draft event contains URLs, no base64; second Blossom server returns the same hashes. If E2 shipped an interim photo path (plan §6.1), this step retires it.

### ~~Step N5~~ — retired
NIP-98 verification belongs to the edge relays (§0.1, §9), and is not currently scheduled. Nothing to build here as a separate step.

### Step N6 — Relay management + personal relay (optional)
Deliverables: Settings → Relays (list, add/remove, health dots), kind 10002 publish, one-page Railway guide for a `strfry` personal relay, "republish everything" button.
**Completion gate:** Add personal relay → publish → `nak req` against it returns the full d-tag set; remove a default relay → sync status stays `synced`.

---

## 14. What Is Explicitly Out of Scope

- **Social features** (posting listings publicly to Nostr, marketplace kinds like NIP-15/99) — Thrift Flip data is private business data; a public "storefront on Nostr" is a separate product decision
- **NIP-46 bunker as primary signing** — offered opportunistically, not built as the main path; iOS PWA reality
- **Payments** (NIP-57 zaps, Cashu, BTCPay) — future spec; §9's pubkey gate is the designed hook, with the circularity noted there
- **Multi-user collaboration** (Dad + you sharing one cart) — possible later via shared key or NIP-44 DMs; not v1
- **Key rotation automation** — manual procedure documented in §8; tooling later
- **Passphrase-based unlock (NIP-49 `ncryptsec`)** — superseded by PRF + PIN in §5.2. A passphrase Dad must remember is slower to enter *and* weaker than his face; NIP-49 remains the right answer only for cross-app key portability, which is out of scope
- **Multi-language BIP-39 wordlists** — English only in v1; widening later is additive and never re-derives an existing key
- ~~Reverse migration~~ — **no longer out of scope.** This spec previously said "there is nothing to migrate back to; export = Settings → Download everything (JSON)." With the track deferred, that export became the *entire* backup story, and an export with no import is not a backup. **S1 ships both halves**, with a format version field and the credential keys excluded (plan §6.1)

---

## 15. Summary

| Dimension | N1 | N2–N3 | N4 | N6 |
|---|---|---|---|---|
| User-visible | Face ID + twelve words + quiz | Nothing (then: multi-device magic) | Faster photos, no quota errors | Settings → Relays |
| Signing | local key (PRF-unwrapped) | same | BUD-02 events | kind 10002 |
| Data layer | IndexedDB vault (ciphertext) | cache + 3 relays | + Blossom | + personal relay |
| Sync state | **gated until backup verified** | open | open | open |
| Server holding user data | None | None | None (content-addressed blobs) | Optionally yours |
| Risk to current data | Zero (adoption migration) | Zero (cache-first) | Zero | Zero |
| Start condition | **The paid tier, or a second device that matters** (§0.2) — *not* "now" | After N1 | After N2 | After N3 |

---

*Security review note before handing to Claude Code: (1) in the relay verification handler, the pubkey/identity must come from the verified NIP-98 event — never from the request body; (2) NIP-44 low-level is `encrypt(conversationKey, plaintext)` — key first — while `window.nostr.nip44.encrypt(pubkey, plaintext)` is pubkey first. Both are silent-failure classics.*
