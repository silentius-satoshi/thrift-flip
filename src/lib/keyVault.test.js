// The vault's crypto, proved through the PIN path. WebAuthn cannot run in a
// headless process at all, but every line downstream of the IKM is shared
// between the two schemes — so what is covered here is the whole wrap/unwrap
// contract, and only the two isolated PRF functions go untested (§5.2).
import { describe, it, expect } from 'vitest';
import {
  wrap, unwrap, pinToIkm, newKdfSalt, probeKeyVaultCapability,
  isCancellation, STORE_ENC_LABEL, PAYLOAD_KIND, PIN_MIN_LENGTH,
} from './keyVault';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

const SECRET = 'AIzaSyDUMMY-not-a-real-key-000000000000';

describe('STORE_ENC_INFO', () => {
  // ⚠ FAILURE HERE IS DATA LOSS, NOT A STALE FIXTURE.
  //
  // The HKDF `info` label is baked into every key ever derived. Change it and
  // no error is raised anywhere: the derived key simply differs, AES-GCM
  // reports a tag mismatch, and every wrapped credential on every phone reads
  // as a wrong PIN forever. If this test fails, restore the label — do not
  // update the expectation.
  it('is exactly the label from nostr spec §5.2', () => {
    expect(STORE_ENC_LABEL).toBe('thrift-flip/store-enc/v1');
  });

  it('does not create the identity label — that belongs to full N1', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('./keyVault.js', import.meta.url), 'utf8'));
    const created = source.split('\n').filter(line =>
      line.includes('thrift-flip/keyvault/v1') && !line.trimStart().startsWith('//'));
    expect(created).toEqual([]);
  });
});

describe('wrap / unwrap — the PIN path', () => {
  it('round-trips a credential', async () => {
    const salt = newKdfSalt();
    const ikm = await pinToIkm('123456', salt);
    const { ciphertext, meta } = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    expect(dec(await unwrap(meta, ciphertext, ikm))).toBe(SECRET);
  });

  it('stores ciphertext, not the plaintext', async () => {
    const salt = newKdfSalt();
    const ikm = await pinToIkm('123456', salt);
    const { ciphertext } = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    const bytes = new Uint8Array(ciphertext);
    expect(dec(bytes)).not.toContain(SECRET);
    // AES-GCM appends a 16-byte tag, so the blob is never the plaintext length
    expect(bytes.length).toBe(enc(SECRET).length + 16);
  });

  it('uses a fresh iv and salt per wrap, so identical inputs differ', async () => {
    const salt = newKdfSalt();
    const ikm = await pinToIkm('123456', salt);
    const a = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    const b = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    expect(a.meta.iv).not.toBe(b.meta.iv);
    expect(a.meta.salt).not.toBe(b.meta.salt);
  });

  it('fails on a wrong PIN without leaking key material into the error', async () => {
    const salt = newKdfSalt();
    const good = await pinToIkm('123456', salt);
    const bad = await pinToIkm('654321', salt);
    const { ciphertext, meta } = await wrap(enc(SECRET), good, { scheme: 'pin' });

    const error = await unwrap(meta, ciphertext, bad).then(() => null, e => e);
    expect(error?.code).toBe('vault-bad-key');
    const dump = `${error.message} ${error.stack ?? ''}`;
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain('123456');
    expect(dump).not.toContain('654321');
  });

  it('binds the ciphertext to the salt in its own meta', async () => {
    const salt = newKdfSalt();
    const ikm = await pinToIkm('123456', salt);
    const { ciphertext, meta } = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    const otherSalt = (await wrap(enc('x'), ikm, { scheme: 'pin' })).meta.salt;
    await expect(unwrap({ ...meta, salt: otherSalt }, ciphertext, ikm)).rejects.toMatchObject({
      code: 'vault-bad-key',
    });
  });

  it('derives a different key for a different PBKDF2 salt', async () => {
    const ikmA = await pinToIkm('123456', newKdfSalt());
    const ikmB = await pinToIkm('123456', newKdfSalt());
    const { ciphertext, meta } = await wrap(enc(SECRET), ikmA, { scheme: 'pin' });
    await expect(unwrap(meta, ciphertext, ikmB)).rejects.toMatchObject({ code: 'vault-bad-key' });
  });
});

describe('WrapMeta — the absent-means-legacy contract (§5.3)', () => {
  // Pins the read-site rule: test for the NEW kind, never the old one, and
  // never infer the kind from byte length. Nothing legacy exists in this repo,
  // which is exactly why the behaviour needs pinning now — the first blob that
  // is not a credential will arrive from full N1, months from here.
  it('tags what it writes as a credential blob', async () => {
    const ikm = await pinToIkm('123456', newKdfSalt());
    const { meta } = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    expect(meta.payloadKind).toBe(PAYLOAD_KIND);
    expect(PAYLOAD_KIND).toBe('credential-blob');
  });

  it('refuses a blob with no payloadKind rather than returning its bytes', async () => {
    const ikm = await pinToIkm('123456', newKdfSalt());
    const { ciphertext, meta } = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    delete meta.payloadKind;
    await expect(unwrap(meta, ciphertext, ikm)).rejects.toMatchObject({
      code: 'vault-unknown-payload',
    });
  });

  it("refuses full N1's 'nip06-entropy' living in the same database", async () => {
    const ikm = await pinToIkm('123456', newKdfSalt());
    const { ciphertext, meta } = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    for (const kind of ['sk', 'nip06-entropy', 'something-later']) {
      await expect(unwrap({ ...meta, payloadKind: kind }, ciphertext, ikm)).rejects.toMatchObject({
        code: 'vault-unknown-payload',
      });
    }
  });

  it('carries the credentialId only on the PRF path', async () => {
    const ikm = await pinToIkm('123456', newKdfSalt());
    const pin = await wrap(enc(SECRET), ikm, { scheme: 'pin' });
    const prf = await wrap(enc(SECRET), ikm, { scheme: 'prf', credentialId: 'abc123' });
    expect(pin.meta).not.toHaveProperty('credentialId');
    expect(prf.meta.credentialId).toBe('abc123');
  });
});

describe('capability probe', () => {
  it('falls back to pin where no platform authenticator exists', async () => {
    // Node has no WebAuthn at all, which is the same answer the probe must give
    // for a desktop browser without a platform authenticator.
    expect(await probeKeyVaultCapability()).toBe('pin');
  });

  it('recognises a cancelled ceremony as distinct from an unsupported device', () => {
    expect(isCancellation({ name: 'NotAllowedError' })).toBe(true);
    expect(isCancellation({ name: 'AbortError' })).toBe(true);
    expect(isCancellation({ name: 'NotSupportedError' })).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });

  it('holds the PIN minimum §8 calls a real requirement', () => {
    expect(PIN_MIN_LENGTH).toBeGreaterThanOrEqual(6);
  });
});
