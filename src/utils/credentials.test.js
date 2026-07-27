// The credential store end to end on the PIN path: enrollment, the migration
// sweep off plaintext, rate limiting, and §5.7's single-flight rule.
//
// Node has no IndexedDB, so lib/vault.js runs on its in-memory backend here —
// that is the seam, and it is why these tests exercise the real store rather
// than a mock of it.
import { describe, it, expect, beforeEach } from 'vitest';
import { credentialStore, unlock, registerUnlockUI, primeSession, lockoutCopy, __testSeam } from './credentials';
import { getBlob, getMeta } from '../lib/vault';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const PLAINTEXT_KEY = 'thrift-flip-ai-key';
const SECRET = 'AIzaSyDUMMY-not-a-real-key-000000000000';
const PIN = '123456';

/** Stands in for VaultGate. Counts ceremonies so "one sheet per session" is testable. */
function fakeUi({ pin = PIN, onUnlock } = {}) {
  const calls = { enroll: 0, unlock: 0 };
  registerUnlockUI({
    requestEnroll: async () => { calls.enroll++; return { scheme: 'pin', pin }; },
    requestUnlock: async (ctx) => {
      calls.unlock++;
      if (onUnlock) return onUnlock(ctx, calls.unlock);
      return { pin };
    },
  });
  return calls;
}

beforeEach(async () => {
  store.clear();
  await __testSeam.resetAll();
});

describe('a profile with nothing stored', () => {
  it('returns null and runs no ceremony at all', async () => {
    const calls = fakeUi();
    expect(await credentialStore.get('ai-key')).toBeNull();
    // The whole point of lazy unlock: capture, the pencil floor, cart and
    // drafts must never make someone look at a Face ID sheet.
    expect(calls).toEqual({ enroll: 0, unlock: 0 });
  });

  it('describes itself as absent without prompting', async () => {
    const calls = fakeUi();
    expect(await credentialStore.describe('ai-key')).toMatchObject({ present: false, last4: null });
    expect(calls).toEqual({ enroll: 0, unlock: 0 });
  });
});

describe('enrollment and round-trip', () => {
  it('wraps on first write and reads back in the same session', async () => {
    const calls = fakeUi();
    await credentialStore.set('ai-key', SECRET);
    expect(calls.enroll).toBe(1);
    expect(await credentialStore.get('ai-key')).toBe(SECRET);
  });

  it('leaves no plaintext anywhere — not in localStorage, not in the blob', async () => {
    fakeUi();
    await credentialStore.set('ai-key', SECRET);

    const dumped = JSON.stringify([...store.entries()]);
    expect(dumped).not.toContain(SECRET);
    expect(store.get(PLAINTEXT_KEY)).toBeUndefined();

    const blob = await getBlob('ai-key');
    expect(new TextDecoder().decode(new Uint8Array(blob.ciphertext))).not.toContain(SECRET);
    expect(blob.meta.payloadKind).toBe('credential-blob');
    expect(blob.meta.scheme).toBe('pin');
  });

  it('exposes the last four for Settings without unwrapping', async () => {
    const calls = fakeUi();
    await credentialStore.set('ai-key', SECRET);
    __testSeam.lockSession(); // as if the app had been relaunched

    const described = await credentialStore.describe('ai-key');
    expect(described).toMatchObject({ present: true, last4: SECRET.slice(-4), scheme: 'pin' });
    // Opening Settings must cost no ceremony — that is the whole reason the
    // hint sits beside the ciphertext instead of inside it.
    expect(calls.unlock).toBe(0);
    expect(calls.enroll).toBe(1);
  });

  it('unlocks once per session, not once per read', async () => {
    fakeUi();
    await credentialStore.set('ai-key', SECRET);
    const calls = fakeUi(); // fresh counter, session IKM already held
    expect(await credentialStore.get('ai-key')).toBe(SECRET);
    expect(await credentialStore.get('ai-key')).toBe(SECRET);
    expect(calls.unlock).toBe(0);
  });
});

describe('the migration sweep', () => {
  it('moves a plaintext key into the vault and deletes the plaintext', async () => {
    store.set(PLAINTEXT_KEY, JSON.stringify(SECRET));
    const calls = fakeUi();

    expect(await credentialStore.get('ai-key')).toBe(SECRET);

    expect(calls.enroll).toBe(1);
    expect(store.get(PLAINTEXT_KEY)).toBeUndefined();
    expect(await getBlob('ai-key')).toBeTruthy();
    expect(JSON.stringify([...store.entries()])).not.toContain(SECRET);
  });

  it('reads back through the vault on the next session, never re-enrolling', async () => {
    store.set(PLAINTEXT_KEY, JSON.stringify(SECRET));
    fakeUi();
    await credentialStore.get('ai-key');

    // Next launch: same vault, no session cache, and no plaintext left to fall
    // back on — so this read has to come through unwrap.
    __testSeam.lockSession();
    const calls = fakeUi();
    expect(await credentialStore.get('ai-key')).toBe(SECRET);
    expect(calls.enroll).toBe(0);
    expect(calls.unlock).toBe(1);
  });

  it('keeps the plaintext when the ceremony is declined', async () => {
    store.set(PLAINTEXT_KEY, JSON.stringify(SECRET));
    registerUnlockUI({
      requestEnroll: async () => { const e = new Error('x'); e.code = 'ceremony-cancelled'; throw e; },
      requestUnlock: async () => { throw new Error('should not be reached'); },
    });

    const error = await credentialStore.get('ai-key').then(() => null, e => e);
    expect(error?.code).toBe('locked');
    // Losing the key to a declined sheet would be far worse than leaving it.
    expect(store.get(PLAINTEXT_KEY)).toBe(JSON.stringify(SECRET));
  });

  it('surfaces a pre-vault key to Settings without prompting', async () => {
    store.set(PLAINTEXT_KEY, JSON.stringify(SECRET));
    const calls = fakeUi();
    expect(await credentialStore.describe('ai-key')).toMatchObject({
      present: true, last4: SECRET.slice(-4),
    });
    expect(calls).toEqual({ enroll: 0, unlock: 0 });
  });
});

describe('PIN rate limiting', () => {
  it('locks out after three wrong PINs and recovers when the wait expires', async () => {
    let now = 1_000_000;
    __testSeam.setClock(() => now);

    fakeUi();
    await credentialStore.set('ai-key', SECRET);
    __testSeam.lockSession();
    expect((await getMeta('enrollment')).scheme).toBe('pin');

    // A wrong PIN, supplied directly, gets exactly one shot — no retry loop.
    for (let i = 0; i < 3; i++) {
      const error = await unlock('999999').then(() => null, e => e);
      expect(error?.code).toBe('vault-bad-key');
    }

    const locked = await getMeta('pin-attempts');
    expect(locked.fails).toBe(3);
    expect(locked.lockedUntil).toBe(now + 15_000);

    // Locked: even the correct PIN is refused, with copy that names the wait.
    const blocked = await unlock(PIN).then(() => null, e => e);
    expect(blocked?.code).toBe('vault-rate-limited');
    expect(blocked.message).toBe('Too many tries — wait 15 seconds.');

    // The wait expires and the correct PIN works again.
    now += 15_001;
    await expect(unlock(PIN)).resolves.toBeInstanceOf(Uint8Array);
    expect(await getMeta('pin-attempts')).toBeNull();
  });

  it('escalates the wait rather than repeating the first tier', async () => {
    let now = 2_000_000;
    __testSeam.setClock(() => now);
    fakeUi();
    await credentialStore.set('ai-key', SECRET);

    const tiers = [];
    for (let i = 0; i < 6; i++) {
      await unlock('999999').catch(() => {});
      const rec = await getMeta('pin-attempts');
      if (rec.lockedUntil) tiers.push(rec.lockedUntil - now);
      now += 1_000_000; // walk past each lockout so the next attempt is allowed
      __testSeam.setClock(() => now);
    }
    expect(tiers).toEqual([15_000, 60_000, 300_000, 900_000]);
  });

  it('names seconds under a minute and a half, minutes above it', () => {
    expect(lockoutCopy(15_000)).toBe('Too many tries — wait 15 seconds.');
    expect(lockoutCopy(900_000)).toBe('Too many tries — wait 15 minutes.');
  });
});

describe('single-flight (§5.7)', () => {
  it('two concurrent reads cause one ceremony, not two', async () => {
    fakeUi();
    await credentialStore.set('ai-key', SECRET);
    __testSeam.lockSession(); // the vault survives; the session IKM does not

    const calls = fakeUi();
    const [a, b] = await Promise.all([
      credentialStore.get('ai-key'),
      credentialStore.get('ai-key'),
    ]);
    expect(a).toBe(SECRET);
    expect(b).toBe(SECRET);
    // WebAuthn allows one ceremony at a time — two simultaneous ones abort the
    // first and loop the second — so the second read must join, not re-prompt.
    expect(calls.unlock).toBe(1);
  });

  it('a PIN-bearing call does not join — or inherit the failure of — a pinless one', async () => {
    fakeUi();
    await credentialStore.set('ai-key', SECRET);
    __testSeam.lockSession();

    // A pinless unlock whose sheet the user is about to cancel: the
    // "already-doomed promise" §5.7 warns about.
    let releaseCancel;
    const cancelled = new Promise((resolve) => { releaseCancel = resolve; });
    let prompts = 0;
    registerUnlockUI({
      requestEnroll: async () => { throw new Error('should not re-enrol'); },
      requestUnlock: async () => {
        prompts++;
        await cancelled;
        const e = new Error('cancelled');
        e.code = 'ceremony-cancelled';
        throw e;
      },
    });

    const pinless = unlock().then(() => 'resolved', e => e.code);
    const withPin = unlock(PIN); // queued behind it, must not join it
    releaseCancel();

    expect(await pinless).toBe('ceremony-cancelled');
    // The correct PIN is not reported as a failure by the doomed promise.
    await expect(withPin).resolves.toBeInstanceOf(Uint8Array);
    // ...and it supplied its own PIN, so it never opened a second sheet.
    expect(prompts).toBe(1);
  });

  it('a second pinless read joins the first rather than double-prompting', async () => {
    fakeUi();
    await credentialStore.set('ai-key', SECRET);
    __testSeam.lockSession();

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let prompts = 0;
    registerUnlockUI({
      requestEnroll: async () => { throw new Error('should not re-enrol'); },
      requestUnlock: async () => { prompts++; await gate; return { pin: PIN }; },
    });

    const first = unlock();
    const second = unlock();
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(prompts).toBe(1);
    expect(a).toEqual(b);
  });
});

describe('the harness seam', () => {
  // primeSession is the one path that yields a credential without unwrap
  // running. It exists so scripts/live-check.mjs can run on an env-supplied key
  // in Node, where no ceremony is possible, and it is grep-confined to scripts/
  // and tests. Nothing it receives is ever written anywhere.
  it('serves a session value without touching the vault', async () => {
    const calls = fakeUi();
    primeSession('ai-key', SECRET);

    expect(await credentialStore.get('ai-key')).toBe(SECRET);
    expect(calls).toEqual({ enroll: 0, unlock: 0 });
    expect(await getBlob('ai-key')).toBeNull();
    expect(await credentialStore.hasVault()).toBe(false);
    expect(JSON.stringify([...store.entries()])).not.toContain(SECRET);
  });
});

describe('clear and reset', () => {
  it('clear removes the credential but keeps the enrollment', async () => {
    const calls = fakeUi();
    await credentialStore.set('ai-key', SECRET);
    await credentialStore.clear('ai-key');

    expect(await getBlob('ai-key')).toBeNull();
    expect(await credentialStore.hasVault()).toBe(true);
    // Adding a key back costs no second ceremony.
    await credentialStore.set('ai-key', 'AIzaSyDUMMY-second-key-11111111111111');
    expect(calls.enroll).toBe(1);
  });

  it('reset wipes the vault so a fresh key can be enrolled', async () => {
    const calls = fakeUi();
    await credentialStore.set('ai-key', SECRET);
    await credentialStore.reset();

    expect(await credentialStore.hasVault()).toBe(false);
    expect(await credentialStore.describe('ai-key')).toMatchObject({ present: false });
    expect(await credentialStore.get('ai-key')).toBeNull();

    await credentialStore.set('ai-key', SECRET);
    expect(calls.enroll).toBe(2);
  });
});
