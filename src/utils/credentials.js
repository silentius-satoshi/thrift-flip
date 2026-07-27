// Named secrets, encrypted at rest (nostr spec §13, Step N1-lite).
// Today: 'ai-key'. At E1: 'ebay-tokens'.
//
// Everything here is deliberately LAZY. A profile with no stored credential
// runs no ceremony at all — capture, the pencil floor, cart, drafts and every
// other non-AI feature never see an unlock sheet. The first credential read of
// a session triggers at most one ceremony, and the decrypted values live in a
// module-level cache for that session only.
import {
  getBlob, putBlob, deleteBlob, getMeta, putMeta, deleteMeta, clearAll,
} from '../lib/vault';
import {
  wrap, unwrap, pinToIkm, newKdfSalt, isCancellation, PIN_MIN_LENGTH,
} from '../lib/keyVault';
import { vaultErr } from '../lib/vaultError';

export { PIN_MIN_LENGTH };

const ENROLLMENT = 'enrollment';       // { scheme, credentialId?, kdfSalt }
const ATTEMPTS = 'pin-attempts';       // { fails, lockedUntil }

// A blob wrapping a known constant, written at enrollment. Unwrapping it is how
// a wrong PIN — or a passkey that is not the enrolled one — is detected at
// unlock time rather than at the first credential read, which is what lets the
// rate limiter and the retry copy live in one place.
const VERIFIER = '__unlock-check';
const VERIFIER_PLAINTEXT = 'thrift-flip/unlock-check/v1';

// The plaintext keys this build sweeps up and deletes. Only the deliberate
// deletion named in the step's constraints — no other storage key is touched.
const LEGACY_PLAINTEXT = { 'ai-key': 'thrift-flip-ai-key' };

// Rate limiting, counted in the vault's own meta store so this step adds no
// localStorage key and nothing new reaches the JSON export.
//
// Honest about what this buys: the counter stops shoulder-surfing and casual
// retry on an unlocked phone. It is NOT the security boundary — anyone with
// DevTools can grind the ciphertext directly and ignore it. 600k-iteration
// PBKDF2 is the actual defense, which is why §8 calls the PIN path weaker.
const FREE_ATTEMPTS = 3;
const LOCKOUT_TIERS_MS = [15_000, 60_000, 300_000, 900_000];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ── Session state ───────────────────────────────────────────────────────────
// Never persisted, never logged. The IKM is held for the session so that a
// second credential (eBay tokens at E1) costs no second Face ID sheet. The PIN
// itself is never held anywhere — only its PBKDF2 output (§8).
let sessionIkm = null;
const sessionCache = new Map();
let inflight = null; // { promise, withPin } — a boolean, never the PIN (§5.7)

let clock = () => Date.now();

// ── The ceremony seam ───────────────────────────────────────────────────────
// src/contexts/* is untouchable, so the sheets cannot be a context. VaultGate
// registers handlers here on mount; the node tests inject fakes and exercise
// the whole PIN path with no React and no WebAuthn.
//
// The ceremonies run INSIDE the handlers, not here, on purpose: WebAuthn needs
// transient activation, and iOS Safari drops it across the awaits between
// tapping "Get verdict" and the credential read. The handler runs in its own
// click, so the gesture is always fresh.
let ui = null;

/**
 * @param {{
 *   requestEnroll: () => Promise<{scheme:'prf', credentialId:string, ikm:Uint8Array}|{scheme:'pin', pin:string}>,
 *   requestUnlock: (ctx: {scheme:'prf'|'pin', credentialId?:string, error:string|null, lockedForMs:number}) => Promise<{ikm?:Uint8Array, pin?:string}>,
 * }} handlers
 */
export function registerUnlockUI(handlers) {
  ui = handlers;
}

function needUi() {
  if (!ui) throw vaultErr('vault-no-ui', 'The unlock screen isn’t ready yet.');
  return ui;
}

// ── Legacy plaintext ────────────────────────────────────────────────────────

function readLegacyPlaintext(name) {
  const key = LEGACY_PLAINTEXT[name];
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function dropLegacyPlaintext(name) {
  const key = LEGACY_PLAINTEXT[name];
  if (!key || typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(key); } catch { /* nothing to do */ }
}

// ── Rate limiting ───────────────────────────────────────────────────────────

async function lockedForMs() {
  const rec = await getMeta(ATTEMPTS);
  if (!rec?.lockedUntil) return 0;
  return Math.max(0, rec.lockedUntil - clock());
}

async function recordFailure() {
  const rec = (await getMeta(ATTEMPTS)) ?? { fails: 0, lockedUntil: 0 };
  const fails = rec.fails + 1;
  const over = fails - FREE_ATTEMPTS;
  const lockedUntil = over >= 0
    ? clock() + LOCKOUT_TIERS_MS[Math.min(over, LOCKOUT_TIERS_MS.length - 1)]
    : 0;
  await putMeta(ATTEMPTS, { fails, lockedUntil });
}

export function lockoutCopy(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 90) return `Too many tries — wait ${seconds} seconds.`;
  return `Too many tries — wait ${Math.ceil(seconds / 60)} minutes.`;
}

// ── Enrollment and unlock ───────────────────────────────────────────────────

async function writeVerifier(ikm, enrollment) {
  const { ciphertext, meta } = await wrap(
    textEncoder.encode(VERIFIER_PLAINTEXT),
    ikm,
    { scheme: enrollment.scheme, credentialId: enrollment.credentialId },
  );
  await putBlob(VERIFIER, ciphertext, meta);
}

async function verifyIkm(ikm) {
  const blob = await getBlob(VERIFIER);
  if (!blob) return; // enrolled before the verifier existed — nothing to check against
  const bytes = await unwrap(blob.meta, blob.ciphertext, ikm);
  if (textDecoder.decode(bytes) !== VERIFIER_PLAINTEXT) {
    throw vaultErr('vault-bad-key', 'That didn’t open it.');
  }
}

async function enroll() {
  const result = await needUi().requestEnroll();
  const kdfSalt = newKdfSalt();
  let ikm;
  let enrollment;
  if (result.scheme === 'prf') {
    ikm = result.ikm;
    enrollment = { scheme: 'prf', credentialId: result.credentialId, kdfSalt };
  } else {
    ikm = await pinToIkm(result.pin, kdfSalt);
    enrollment = { scheme: 'pin', kdfSalt };
  }
  await putMeta(ENROLLMENT, enrollment);
  await writeVerifier(ikm, enrollment);
  await deleteMeta(ATTEMPTS);
  sessionIkm = ikm;
  return ikm;
}

async function runCeremony(directPin) {
  // Re-read live state immediately before the ceremony rather than trusting a
  // cached copy: a reset may have landed while this call sat queued behind
  // another, and firing a Face ID sheet for a vault that no longer exists is
  // exactly the spurious prompt §5.7 warns about.
  const enrollment = await getMeta(ENROLLMENT);
  if (!enrollment) return enroll();

  let supplied = directPin;
  let error = null;

  for (;;) {
    const waitMs = await lockedForMs();
    let ikm;

    if (enrollment.scheme === 'pin') {
      if (waitMs > 0 && supplied != null) throw vaultErr('vault-rate-limited', lockoutCopy(waitMs));
      let pin = supplied;
      supplied = null;
      if (pin == null) {
        const answer = await needUi().requestUnlock({ scheme: 'pin', error, lockedForMs: waitMs });
        pin = answer.pin;
        // The sheet disables submit while the countdown runs, so a PIN arriving
        // during a lockout means the sheet is misbehaving. Fail rather than
        // loop — a retry loop here would spin forever.
        const stillLocked = await lockedForMs();
        if (stillLocked > 0) throw vaultErr('vault-rate-limited', lockoutCopy(stillLocked));
      }
      ikm = await pinToIkm(pin, enrollment.kdfSalt);
    } else {
      const answer = await needUi().requestUnlock({
        scheme: 'prf', credentialId: enrollment.credentialId, error, lockedForMs: 0,
      });
      ikm = answer.ikm;
    }

    try {
      await verifyIkm(ikm);
    } catch (e) {
      if (e?.code !== 'vault-bad-key') throw e;
      if (enrollment.scheme === 'pin') await recordFailure();
      // A caller-supplied PIN gets one shot; the sheet-driven loop retries.
      if (directPin != null) throw e;
      error = enrollment.scheme === 'pin' ? 'That PIN didn’t open it.' : 'That didn’t open it.';
      continue;
    }

    if (enrollment.scheme === 'pin') await deleteMeta(ATTEMPTS);
    sessionIkm = ikm;
    return ikm;
  }
}

/**
 * Single-flight and PIN-aware (§5.7). WebAuthn allows one ceremony at a time —
 * two simultaneous ones abort the first and loop the second — and this app will
 * hit it, because two credential reads can land in the same tick.
 *
 * The PIN-awareness is the subtle half: a PIN-bearing call must NOT join a
 * pinless in-flight restore, or a correct PIN gets reported as a failure by an
 * already-doomed promise.
 */
export async function unlock(pin) {
  const wantsPin = pin != null;
  if (sessionIkm && !wantsPin) return sessionIkm;

  while (inflight && inflight.withPin !== wantsPin) {
    await inflight.promise.catch(() => {});
  }
  if (inflight) return inflight.promise;

  const entry = { withPin: wantsPin };
  entry.promise = runCeremony(pin).finally(() => { if (inflight === entry) inflight = null; });
  inflight = entry;
  return entry.promise;
}

// Cancelling the sheet must fail cleanly: no retry loop, no key in memory.
function asLocked(error) {
  if (error?.code === 'ceremony-cancelled' || isCancellation(error)) {
    return vaultErr('locked', 'Unlock cancelled — verdicts need your key');
  }
  return error;
}

// ── The store ───────────────────────────────────────────────────────────────

export const credentialStore = {
  /**
   * Returns null WITHOUT any ceremony when nothing is stored — this is what
   * keeps a key-less profile prompt-free everywhere.
   */
  async get(name) {
    if (sessionCache.has(name)) return sessionCache.get(name);

    const blob = await getBlob(name);
    if (!blob) {
      // Migration sweep: plaintext from before the vault existed. Enrolling
      // wraps it and deletes the plaintext. No migration dialog and no toast —
      // the enrollment sheet's own copy is the only thing shown.
      const legacy = readLegacyPlaintext(name);
      if (legacy == null) return null;
      try {
        // Not `this.set` — callers are free to destructure, and a lost `this`
        // here would silently skip the wrap and leave the plaintext in place.
        await credentialStore.set(name, legacy);
      } catch (e) {
        // A cancelled or failed migration leaves the plaintext exactly where it
        // was. Losing the key to a declined ceremony would be far worse.
        throw asLocked(e);
      }
      return legacy;
    }

    let ikm;
    try {
      ikm = await unlock();
    } catch (e) { throw asLocked(e); }

    const bytes = await unwrap(blob.meta, blob.ciphertext, ikm);
    const value = JSON.parse(textDecoder.decode(bytes));
    sessionCache.set(name, value);
    return value;
  },

  async set(name, value) {
    let ikm;
    try {
      ikm = await unlock();
    } catch (e) { throw asLocked(e); }

    const enrollment = await getMeta(ENROLLMENT);
    const { ciphertext, meta } = await wrap(
      textEncoder.encode(JSON.stringify(value)),
      ikm,
      { scheme: enrollment.scheme, credentialId: enrollment.credentialId },
    );
    // `hint` sits beside the WrapMeta, not inside it: the last four characters
    // of a Gemini key are not a credential — they are already what Settings
    // displays — and keeping them readable means opening Settings never costs a
    // Face ID prompt.
    const hint = typeof value === 'string' ? { last4: value.slice(-4) } : null;
    await putBlob(name, ciphertext, { ...meta, ...(hint ? { hint } : {}) });
    dropLegacyPlaintext(name);
    sessionCache.set(name, value);
  },

  async clear(name) {
    sessionCache.delete(name);
    await deleteBlob(name);
    dropLegacyPlaintext(name);
    // The enrollment survives on purpose: it protects the device, not this one
    // credential, so adding a key back costs no second ceremony.
  },

  /** Presence and the display hint. Reads metadata only — never prompts. */
  async describe(name) {
    const blob = await getBlob(name);
    if (blob) {
      return { present: true, last4: blob.meta?.hint?.last4 ?? null, scheme: blob.meta?.scheme ?? null };
    }
    const legacy = readLegacyPlaintext(name);
    if (typeof legacy === 'string') return { present: true, last4: legacy.slice(-4), scheme: null };
    return { present: false, last4: null, scheme: null };
  },

  async hasVault() {
    return !!(await getMeta(ENROLLMENT));
  },

  /**
   * The destructive reset behind "Can't unlock?". A lost passkey or forgotten
   * PIN makes the ciphertext permanently unopenable — there is no recovery, by
   * design, because a second weaker wrap would become the effective floor.
   * Both credentials this vault holds are cheap to re-obtain.
   */
  async reset() {
    sessionCache.clear();
    sessionIkm = null;
    inflight = null;
    await clearAll();
    for (const name of Object.keys(LEGACY_PLAINTEXT)) dropLegacyPlaintext(name);
  },
};

// ── Seams — harness and tests only ──────────────────────────────────────────
// primeSession is the one path that yields a credential without unwrap running.
// It is confined to scripts/ and *.test.js by a grep gate; nothing under src/
// may call it. scripts/live-check.mjs uses it to run on an env-supplied key
// without that key ever touching disk.
export function primeSession(name, value) {
  sessionCache.set(name, value);
}

export const __testSeam = {
  setClock(fn) { clock = fn; },
  /** Drops the session IKM and cache while leaving the vault intact — i.e. what
   *  a relaunch looks like. Without it a test cannot reach the unlock path at
   *  all, because `set()` leaves the IKM held. */
  lockSession() {
    sessionCache.clear();
    sessionIkm = null;
    inflight = null;
  },
  async resetAll() {
    sessionCache.clear();
    sessionIkm = null;
    inflight = null;
    ui = null;
    clock = () => Date.now();
    await clearAll();
  },
};
