// The credential vault's crypto (nostr spec §5.2, §5.3 — N1-lite).
//
//   PRF assertion ─┐
//                  ├→ IKM → HKDF-SHA256(salt, info) → AES-GCM-256 → ciphertext + WrapMeta
//   PIN → PBKDF2 ──┘   600,000 iterations on the PIN path
//
// Face ID is key MATERIAL, not a gate. The authenticator emits a stable
// credential-bound secret only on successful biometric verification, and that
// secret is the IKM. Without it the ciphertext is not "protected" — it is
// mathematically unopenable. Any design where WebAuthn merely guards a lookup
// is the theatre §5.2 forbids: anyone with DevTools skips a check.
//
// §11's two-files rule, adapted for N1-lite: this is the ONLY file in src/ that
// touches a crypto primitive. Everything else goes through utils/credentials.js.
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import { vaultErr } from './vaultError';

const enc = (s) => new TextEncoder().encode(s);

// ⚠ CHANGING THIS LABEL SILENTLY ORPHANS EVERY WRAPPED CREDENTIAL.
// No error is raised — the derived key simply differs and AES-GCM reports a tag
// mismatch that looks exactly like a wrong PIN. Pinned by a test marked
// "failure = data loss, not a stale fixture".
export const STORE_ENC_LABEL = 'thrift-flip/store-enc/v1';
const STORE_ENC_INFO = enc(STORE_ENC_LABEL);
// NOT created here: 'thrift-flip/keyvault/v1' wraps the Nostr identity key and
// belongs to full N1. N1-lite ships the credentials-at-rest label alone (§5.2).

// The PRF input. Same rule as the label above — a change here produces a
// different authenticator secret and every wrapped credential stops opening.
const PRF_EVAL_SALT = enc('thrift-flip/store-enc/v1/prf');

const PBKDF2_ITERATIONS = 600_000;

/**
 * @typedef {object} WrapMeta
 * @property {string} iv           base64
 * @property {string} salt         base64 — HKDF salt, fresh per wrap
 * @property {'prf'|'pin'} scheme
 * @property {string} [credentialId] base64url, PRF only
 * @property {'credential-blob'} [payloadKind]
 *   ⚠ ABSENT MEANS A PRE-`payloadKind` FORMAT. Compatibility contract for
 *   anything wrapped before this field existed. Test for the NEW kind, never
 *   the old one, and NEVER infer the kind from byte length. This warning is
 *   mirrored at the read site in `unwrap` — the two get edited months apart.
 */
export const PAYLOAD_KIND = 'credential-blob';

// ── Encoding ────────────────────────────────────────────────────────────────

function subtle() {
  const s = globalThis.crypto?.subtle;
  // Undefined on an insecure origin — e.g. loading the dev server over
  // http://192.168.x.x on a phone, which is exactly how on-device testing goes.
  if (!s) throw vaultErr('crypto-unavailable', 'Thrift Flip needs a secure (https) connection to lock your key.');
  return s;
}

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

function b64(bytes) {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ── Capability ──────────────────────────────────────────────────────────────

/**
 * Always probe, never assume — PRF on platform authenticators needs iOS Safari
 * 18.4+. The PIN path exists for everything else (§5.2).
 * @returns {Promise<'prf'|'pin'>}
 */
export async function probeKeyVaultCapability() {
  try {
    if (browserSupportsWebAuthn() && await platformAuthenticatorIsAvailable()) return 'prf';
  } catch { /* fall through */ }
  return 'pin';
}

/** A cancelled Face ID sheet, as opposed to a device that cannot do PRF at all. */
export function isCancellation(error) {
  return error?.name === 'NotAllowedError'
    || error?.name === 'AbortError'
    || error?.code === 'ERROR_CEREMONY_ABORTED';
}

// ── WebAuthn PRF — isolated behind two functions ────────────────────────────
// WebAuthn cannot be exercised in a headless run or in jsdom, so these two are
// the only untested lines in the vault. Everything downstream of the IKM is
// shared with the PIN path and is covered (§5.2).

/**
 * Registration does NOT return PRF output — only an assertion does. Callers
 * must follow this immediately with `prfAuthenticate` to obtain the IKM.
 * §5.2 notes this costs an hour to rediscover.
 * @returns {Promise<string>} credentialId, base64url
 */
export async function prfRegister() {
  const registration = await startRegistration({
    optionsJSON: {
      rp: { name: 'Thrift Flip', id: location.hostname },
      // No account exists — this handle names the device credential, nothing more.
      user: { id: b64url(randomBytes(16)), name: 'thrift-flip', displayName: 'Thrift Flip' },
      // There is no server to verify this challenge, and we never check the
      // signature. The security property is the PRF secret, not the assertion.
      challenge: b64url(randomBytes(32)),
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      // What makes this a Face ID *unlock* rather than a second-factor tap.
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      extensions: { prf: {} },
      attestation: 'none',
      timeout: 60_000,
    },
  });
  // Only an explicit `false` is a refusal; browsers that omit the flag still
  // often produce results, and the assertion below is the real proof.
  if (registration.clientExtensionResults?.prf?.enabled === false) {
    throw vaultErr('prf-unsupported', 'This phone can’t lock the key with Face ID.');
  }
  return registration.id;
}

/**
 * The assertion that produces key material. Returns the raw PRF secret — the
 * caller feeds it straight to `wrap`/`unwrap` and never persists it.
 * @returns {Promise<Uint8Array>} IKM
 */
export async function prfAuthenticate(credentialId) {
  const assertion = await startAuthentication({
    optionsJSON: {
      challenge: b64url(randomBytes(32)),
      rpId: location.hostname,
      allowCredentials: credentialId ? [{ id: credentialId, type: 'public-key' }] : undefined,
      userVerification: 'required',
      // NOT base64url: @simplewebauthn/browser spreads `extensions` into the
      // raw WebAuthn options untouched, so `first` must already be a
      // BufferSource. A base64url string here derives silently wrong material.
      extensions: { prf: { eval: { first: PRF_EVAL_SALT } } },
      timeout: 60_000,
    },
  });
  const first = assertion.clientExtensionResults?.prf?.results?.first;
  if (!first) throw vaultErr('prf-unsupported', 'This phone can’t lock the key with Face ID.');
  return new Uint8Array(first);
}

// ── PIN ─────────────────────────────────────────────────────────────────────

export const PIN_MIN_LENGTH = 6;

/** One random salt per vault, so a PIN unlock runs PBKDF2 once, not once per blob. */
export const newKdfSalt = () => b64(randomBytes(32));

/**
 * Weaker than PRF by construction, which is why §8 makes the minimum length and
 * rate-limiting real requirements rather than polish.
 * @returns {Promise<Uint8Array>} IKM
 */
export async function pinToIkm(pin, kdfSaltB64) {
  const base = await subtle().importKey('raw', enc(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(kdfSaltB64), iterations: PBKDF2_ITERATIONS },
    base,
    256,
  );
  return new Uint8Array(bits);
}

// ── Wrap / unwrap ───────────────────────────────────────────────────────────

async function deriveAesKey(ikm, salt) {
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: STORE_ENC_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the AES key cannot be read back out of WebCrypto
    ['encrypt', 'decrypt'],
  );
}

/**
 * @param {Uint8Array} bytes plaintext
 * @param {Uint8Array} ikm   PRF output or PBKDF2 output
 * @returns {Promise<{ ciphertext: ArrayBuffer, meta: WrapMeta }>}
 */
export async function wrap(bytes, ikm, { scheme, credentialId } = {}) {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = await deriveAesKey(ikm, salt);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return {
    ciphertext,
    meta: {
      iv: b64(iv),
      salt: b64(salt),
      scheme,
      ...(credentialId ? { credentialId } : {}),
      payloadKind: PAYLOAD_KIND,
    },
  };
}

/**
 * @param {WrapMeta} meta
 * @returns {Promise<Uint8Array>} plaintext
 */
export async function unwrap(meta, ciphertext, ikm) {
  // ⚠ READ SITE — test for the NEW kind, never the old one, and never infer the
  // kind from byte length (§5.3). N1-lite has no legacy format to be
  // backward-compatible with, so anything that is not a credential blob is
  // refused rather than returned: a future N1 'nip06-entropy' blob living in
  // this same database must never be handed back as if it were a credential.
  if (meta?.payloadKind !== PAYLOAD_KIND) {
    throw vaultErr('vault-unknown-payload', 'This saved item was written by a different version.');
  }
  const key = await deriveAesKey(ikm, unb64(meta.salt));
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(meta.iv) }, key, ciphertext);
    return new Uint8Array(plain);
  } catch {
    // AES-GCM tag mismatch: wrong PIN, wrong PRF secret, or tampering. The
    // original error is swallowed on purpose — nothing derived from key
    // material may reach an Error message (§5.6).
    throw vaultErr('vault-bad-key', 'That didn’t open it.');
  }
}
