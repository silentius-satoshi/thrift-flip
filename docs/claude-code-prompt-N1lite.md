# Claude Code Prompt — N1-lite: The Credential Vault
<!-- Model: Opus 5 · Effort: Max thinking · Verified against repo @ e00fe16 (V1.5+E0 complete) -->
<!-- This is the security-critical build of the project. The nostr spec's §5 custody design is production-verified source material — adapt it, do not redesign it. -->

Implement N1-lite per `docs/thrift-flip-nostr-spec-v1.md` §0.2, §5.2, §13's N1-lite box: **the credential vault alone** — WebAuthn PRF (Face ID) or PIN → HKDF → AES-GCM encryption for the AI key now and the eBay OAuth tokens at E1. **None of the identity layer ships**: no NIP-06, no twelve words, no backup gate/ceremony, no relays, no `nostr-tools`. One new dependency: `@simplewebauthn/browser` (spec pins `^13.3.0` — re-verify current at install).

**Non-negotiables, from the spec's hard-won list:**
- **PRF output is key *material*, not a gate** (§5.2). The biometric assertion's PRF secret is the HKDF IKM; without it the ciphertext is mathematically unopenable. Any design where WebAuthn merely guards a lookup is the "theatre" the spec forbids.
- **Registration does not return PRF output — only an assertion does.** Register, then immediately authenticate to obtain the IKM (§5.2's costs-an-hour note).
- `residentKey: 'required'`, `userVerification: 'required'`.
- **Always probe, never assume** (`probeKeyVaultCapability(): 'prf' | 'pin'`); PIN fallback = PBKDF2, 600k iterations, min length 6, attempt rate-limiting (real UI requirements per §8, not polish).
- HKDF `info` label exactly `'thrift-flip/store-enc/v1'` (`STORE_ENC_INFO`). Do **not** create the identity label — that's full N1's.
- `WrapMeta` per §5.3 — `{ iv, salt, scheme, credentialId?, payloadKind }` with a **new** `payloadKind: 'credential-blob'` (the spec explicitly says don't overload `'sk'`/`'nip06-entropy'`; mirror the absent-means-legacy warning at type and read site).
- **Single-flight the unlock, PIN-aware** (§5.7): concurrent unlock attempts must not double-prompt, and a PIN-bearing call must not join a pinless in-flight restore.
- Isolate `prfRegister`/`prfAuthenticate` behind two functions — WebAuthn is untestable in CI; the PIN path shares every downstream line and is fully unit-tested.

## Part 1 — The vault (`src/lib/keyVault.js`, `src/lib/vault.js`)

- `vault.js`: IndexedDB `thrift-flip-vault` — stores `{ ciphertext, meta }` blobs by name. Detect iOS-Private-Browsing IndexedDB failure and surface a specific error (§13 QA note).
- `keyVault.js`: capability probe; PRF register+assert; PIN → PBKDF2(600k); both → HKDF-SHA256(salt, `STORE_ENC_INFO`) → AES-GCM-256 via WebCrypto; `wrap(bytes, method, pin?)` / `unwrap(meta, ciphertext, pin?)`. All crypto through `crypto.subtle`; no crypto imports anywhere else (§11's two-files rule adapts: `keyVault.js` is the only crypto-primitive importer).
- `src/lib/biometricLabel.js` per §5.8 — "Face ID" on iOS, "passkey" elsewhere. Platform-honest copy everywhere; never overclaim what's protected.

## Part 2 — Credentials move in (`src/utils/credentials.js`)

- A `credentialStore` over the vault: `get(name)` / `set(name, value)` / `clear(name)` for named secrets — today `ai-key`, at E1 `ebay-tokens`. Decrypted values live **in memory only for the session** (module cache, cleared on visibility loss is NOT required — keep it simple, session-scoped), never re-persisted plaintext.
- **Unlock is lazy** — triggered by the first credential read of a session (first analyze, or opening the key detail screen), not at app launch. The pencil path and every non-AI feature never prompts. One Face ID sheet per session, max.
- **Migration sweep:** on first unlock after upgrade, if plaintext `thrift-flip-ai-key` exists in localStorage → wrap it into the vault → delete the plaintext → done silently. First-time setup (no vault, no plaintext key) runs the enrollment: probe → Face ID register+assert or PIN setup sheet → wrap.
- `storageService.aiKeyService` retires; `ai.js`'s `getAiKey` becomes async against `credentialStore` (it's already inside async flows). `backup.js`'s deny-list keeps `thrift-flip-ai-key` (defense in depth — the plaintext should no longer exist) and stays ignorant of the vault (IndexedDB is not in the export, correctly).
- Settings key-detail: **the interim risk note is deleted** (its comment said "deleted at N1" — this is that moment) and replaced by a `Row`: "Protected by {Face ID|passkey}" with the shield-check icon. Enrollment/PIN sheets composed from `ui/` (`Sheet`, `Field`, `Button`).
- Unlock-cancel path: cancelling the Face ID sheet fails cleanly with a toast ("Unlock cancelled — verdicts need your key") and the pencil state stands; no retry loop, no key in memory (§13 gate 2).

## Part 3 — Tests (the PIN path proves the crypto)

Vitest, node env (webcrypto is global): wrap→unwrap round-trip (PIN path); wrong PIN fails without throwing key material; `WrapMeta` contract (absent `payloadKind` → legacy read path — even though nothing legacy exists, the contract test pins the behavior); HKDF label pinned by test (`'thrift-flip/store-enc/v1'` — mark it *failure = data loss*, since a changed label silently orphans every wrapped credential); migration sweep (plaintext in → vault out, plaintext gone); rate-limit counter. PRF path: manual on-device checklist appended to `docs/v1-live-check-runbook.md` (register → force-quit → relaunch → same key decrypts; cancel sheet → clean failure; DevTools shows ciphertext only).

## Constraints

Untouchables: `src/contexts/*`, `src/hooks/*`, `src/config/*`, screen ids, storage keys other than the deliberate `thrift-flip-ai-key` deletion, all mocks, `scripts/live-check.mjs`'s shim (it seeds the OLD localStorage path — **update the harness seam to seed the in-memory credentialStore instead**, same env-only hygiene). `npm test` + `npm run build` green; every F4 gate stays empty.

## Verification

1. Tests green including the new crypto suite; build clean; gates empty.
2. **Gate 2 (§13), automatable half:** after enrollment, localStorage and IndexedDB contain no plaintext key anywhere (`grep` the serialized stores in a headless run); the stored blob is AES-GCM ciphertext; no code path returns a decrypted credential without `unwrap` executing.
3. **Migration:** profile with a plaintext key → first unlock sweeps it into the vault, plaintext gone, analyze still works.
4. PIN path E2E headless: enroll with PIN → analyze works → wrong PIN thrice → rate-limited with specific copy → correct PIN recovers.
5. Export still excludes the key (now trivially — it isn't in localStorage); import of an old backup containing a stray `thrift-flip-ai-key` field still ignores it.
6. Harness (`live-check.mjs`) still runs with the env key through the new seam.
7. Summary: every file changed with line counts, plus the manual on-device PRF checklist location.
