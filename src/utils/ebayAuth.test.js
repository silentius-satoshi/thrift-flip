// The client half of the eBay connect flow. The highest-value test here is the
// refresh-preservation one: eBay's refresh grant returns no refresh_token, and
// a record rebuilt naively from that response nulls the connection on the very
// first refresh — silently, eighteen months of access gone in one line.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
};
let replaced = [];
globalThis.history = { replaceState: (...args) => replaced.push(args) };

const { credentialStore, registerUnlockUI, __testSeam } = await import('./credentials');
const {
  buildAuthUrl, handleCallback, refreshAccessToken, describeEbay,
  disconnectEbay, isEbayConfigured, getEbayTokens,
} = await import('./ebayAuth');
const { getBlob } = await import('../lib/vault');

const RU_NAME = 'Brooks-ThriftFl-thrift-abcdefg';
const CODE_GRANT = {
  access_token: 'v^1.1#i^1#ACCESS-TOKEN-FROM-CODE',
  expires_in: 7200,
  refresh_token: 'v^1.1#i^1#REFRESH-TOKEN-18-MONTHS',
  refresh_token_expires_in: 47304000,
  token_type: 'User Access Token',
};
// What eBay actually returns on a refresh: no refresh_token, no expiry for it.
const REFRESH_GRANT = {
  access_token: 'v^1.1#i^1#ACCESS-TOKEN-REFRESHED',
  expires_in: 7200,
  token_type: 'User Access Token',
};

function configure() {
  vi.stubEnv('VITE_EBAY_APP_ID', 'Brooks-ThriftFl-SBX-1234');
  vi.stubEnv('VITE_EBAY_RU_NAME', RU_NAME);
  vi.stubEnv('VITE_RELAY_SECRET', 'relay-secret');
  vi.stubEnv('VITE_EBAY_ENV', 'sandbox');
}

/** Stands in for VaultGate; the PIN path needs no WebAuthn. */
function fakeVaultUi() {
  registerUnlockUI({
    requestEnroll: async () => ({ scheme: 'pin', pin: '135790' }),
    requestUnlock: async () => ({ pin: '135790' }),
  });
}

function relay(response, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok, status,
      json: async () => response,
    };
  };
  return calls;
}

beforeEach(async () => {
  store.clear();
  session.clear();
  replaced = [];
  vi.unstubAllEnvs();
  await __testSeam.resetAll();
  fakeVaultUi();
});

describe('configuration gate', () => {
  it('reports unconfigured when the env vars are absent', () => {
    expect(isEbayConfigured()).toBe(false);
  });

  it('reports configured once app id, RuName and relay secret are set', () => {
    configure();
    expect(isEbayConfigured()).toBe(true);
  });

  it('refuses to build an authorize URL on an unconfigured build', () => {
    expect(() => buildAuthUrl()).toThrowError(/not-configured/);
  });
});

describe('authorize URL', () => {
  beforeEach(configure);

  it('points at sandbox and carries the RuName as redirect_uri', () => {
    const url = new URL(buildAuthUrl());
    expect(url.origin).toBe('https://auth.sandbox.ebay.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(RU_NAME);
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('switches host on production but keeps api.ebay.com scope URIs', () => {
    vi.stubEnv('VITE_EBAY_ENV', 'production');
    const url = new URL(buildAuthUrl());
    expect(url.origin).toBe('https://auth.ebay.com');
    // Scope strings are not environment-specific — only hosts are.
    expect(url.searchParams.get('scope')).toContain('https://api.ebay.com/oauth/api_scope/');
  });

  it('requests the four §5 scopes as full URIs, space-separated', () => {
    // The spec's shorthand ("sell.inventory") is documentation shorthand; the
    // authorize endpoint rejects it.
    const scopes = new URL(buildAuthUrl()).searchParams.get('scope').split(' ');
    expect(scopes).toEqual([
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
    ]);
  });

  it('persists a fresh state nonce per attempt', () => {
    const first = new URL(buildAuthUrl()).searchParams.get('state');
    expect(session.get('thrift-flip-ebay-state')).toBe(first);
    const second = new URL(buildAuthUrl()).searchParams.get('state');
    expect(second).not.toBe(first);
  });
});

describe('callback', () => {
  beforeEach(configure);

  const withState = () => new URL(buildAuthUrl()).searchParams.get('state');

  it('stores the token set and scrubs the URL on the happy path', async () => {
    const state = withState();
    const calls = relay(CODE_GRANT);

    const record = await handleCallback(`?code=THE-CODE&state=${state}`);

    expect(record.accessToken).toBe(CODE_GRANT.access_token);
    expect(record.refreshToken).toBe(CODE_GRANT.refresh_token);
    expect(calls[0].url).toBe('/api/ebay/oauth');
    expect(calls[0].init.headers.Authorization).toBe('Bearer relay-secret');
    expect(calls[0].body).toMatchObject({
      grant_type: 'authorization_code', code: 'THE-CODE', redirect_uri: RU_NAME,
    });
    expect(replaced.length).toBe(1); // the code does not survive in the URL
    expect(await getEbayTokens()).toMatchObject({ refreshToken: CODE_GRANT.refresh_token });
  });

  it('rejects a mismatched state and stores nothing', async () => {
    withState();
    relay(CODE_GRANT);
    await expect(handleCallback('?code=THE-CODE&state=not-the-one'))
      .rejects.toMatchObject({ code: 'state-mismatch' });
    expect(await getBlob('ebay-tokens')).toBeNull();
  });

  it('rejects a replayed callback — the nonce is one-shot', async () => {
    const state = withState();
    relay(CODE_GRANT);
    await handleCallback(`?code=THE-CODE&state=${state}`);
    await disconnectEbay();
    await expect(handleCallback(`?code=THE-CODE&state=${state}`))
      .rejects.toMatchObject({ code: 'state-mismatch' });
  });

  it('reports a declined consent distinctly from a failure', async () => {
    withState();
    await expect(handleCallback('?error=access_denied'))
      .rejects.toMatchObject({ code: 'declined' });
  });

  it('leaves no partial state when the relay dies mid-exchange', async () => {
    const state = withState();
    globalThis.fetch = async () => { throw new TypeError('network'); };
    await expect(handleCallback(`?code=THE-CODE&state=${state}`))
      .rejects.toMatchObject({ code: 'offline' });
    expect(await getBlob('ebay-tokens')).toBeNull();
    expect(await describeEbay()).toMatchObject({ connected: false });
  });

  it('leaves no partial state when the relay answers without a token', async () => {
    const state = withState();
    relay({ token_type: 'User Access Token' }); // 200, but nothing usable
    await expect(handleCallback(`?code=THE-CODE&state=${state}`))
      .rejects.toMatchObject({ code: 'bad-response' });
    expect(await getBlob('ebay-tokens')).toBeNull();
  });

  it('surfaces a rejected bearer as its own code, not as an eBay failure', async () => {
    const state = withState();
    relay({ error: 'unauthorized' }, { ok: false, status: 401 });
    await expect(handleCallback(`?code=THE-CODE&state=${state}`))
      .rejects.toMatchObject({ code: 'relay-unauthorized' });
  });
});

describe('refresh', () => {
  beforeEach(configure);

  async function connect() {
    const state = new URL(buildAuthUrl()).searchParams.get('state');
    relay(CODE_GRANT);
    return handleCallback(`?code=THE-CODE&state=${state}`);
  }

  it('keeps the refresh token that the grant response omits', async () => {
    // ⚠ THE REGRESSION THIS FILE EXISTS FOR. eBay's refresh response carries no
    // refresh_token. Rebuilding the record from it alone nulls the field and
    // the connection can never be refreshed again.
    const before = await connect();
    relay(REFRESH_GRANT);
    const after = await refreshAccessToken();

    expect(after.accessToken).toBe(REFRESH_GRANT.access_token);
    expect(after.refreshToken).toBe(before.refreshToken);
    expect(after.refreshToken).not.toBeNull();
    expect(await getEbayTokens()).toMatchObject({ refreshToken: CODE_GRANT.refresh_token });
  });

  it('does not slide the displayed expiry forward on every refresh', async () => {
    const before = await connect();
    relay(REFRESH_GRANT);
    const after = await refreshAccessToken();
    // Deriving it from a refreshed obtainedAt would quietly hide a connection
    // about to lapse — the row would read "through <18 months from today>"
    // forever.
    expect(after.refreshExpiresAt).toBe(before.refreshExpiresAt);
    expect((await describeEbay()).through).toBe(before.refreshExpiresAt);
  });

  it('refuses when nothing is connected', async () => {
    await expect(refreshAccessToken()).rejects.toMatchObject({ code: 'not-connected' });
  });

  it('sends the stored refresh token and the scopes', async () => {
    await connect();
    const calls = relay(REFRESH_GRANT);
    await refreshAccessToken();
    expect(calls[0].body.grant_type).toBe('refresh_token');
    expect(calls[0].body.refresh_token).toBe(CODE_GRANT.refresh_token);
    expect(calls[0].body.code).toBeUndefined();
  });
});

describe('custody', () => {
  beforeEach(configure);

  it('writes ciphertext only — no token text anywhere readable', async () => {
    const state = new URL(buildAuthUrl()).searchParams.get('state');
    relay(CODE_GRANT);
    await handleCallback(`?code=THE-CODE&state=${state}`);

    const blob = await getBlob('ebay-tokens');
    const bytes = new TextDecoder().decode(new Uint8Array(blob.ciphertext));
    expect(bytes).not.toContain(CODE_GRANT.access_token);
    expect(bytes).not.toContain(CODE_GRANT.refresh_token);
    expect(blob.meta.payloadKind).toBe('credential-blob');

    // localStorage never sees a token: the tokens went straight to the vault.
    const dumped = JSON.stringify([...store.entries()]);
    expect(dumped).not.toContain(CODE_GRANT.refresh_token);
    expect(dumped).not.toContain('thrift-flip-ebay-tokens');
  });

  it('exposes only the expiry month to Settings, with no unlock', async () => {
    const state = new URL(buildAuthUrl()).searchParams.get('state');
    relay(CODE_GRANT);
    const record = await handleCallback(`?code=THE-CODE&state=${state}`);

    __testSeam.lockSession(); // as if the app had been relaunched
    let prompted = 0;
    registerUnlockUI({
      requestEnroll: async () => { prompted++; throw new Error('should not enrol'); },
      requestUnlock: async () => { prompted++; throw new Error('should not prompt'); },
    });

    const described = await describeEbay();
    expect(described).toMatchObject({ connected: true, through: record.refreshExpiresAt });
    expect(prompted).toBe(0);
    // The hint carries a timestamp and nothing else.
    const blob = await getBlob('ebay-tokens');
    expect(Object.keys(blob.meta.hint)).toEqual(['through']);
  });

  it('disconnect removes the credential and the vault enrollment survives', async () => {
    const state = new URL(buildAuthUrl()).searchParams.get('state');
    relay(CODE_GRANT);
    await handleCallback(`?code=THE-CODE&state=${state}`);

    await disconnectEbay();
    expect(await getBlob('ebay-tokens')).toBeNull();
    expect(await describeEbay()).toMatchObject({ connected: false, through: null });
    // Still enrolled, so reconnecting costs no second ceremony.
    expect(await credentialStore.hasVault()).toBe(true);
  });
});

describe('E4 — token lifecycle', () => {
  beforeEach(configure);

  async function connect() {
    const state = new URL(buildAuthUrl()).searchParams.get('state');
    relay(CODE_GRANT);
    return handleCallback(`?code=THE-CODE&state=${state}`);
  }

  it('self-heals a broken access token on the next call', async () => {
    // ebay §8's E4 gate, the half that needs no sandbox: "delete the access
    // token manually → the next call self-heals".
    const before = await connect();
    await credentialStore.set('ebay-tokens',
      { ...before, accessToken: 'CORRUPTED-OR-EXPIRED' },
      { hint: { through: before.refreshExpiresAt } });

    const { authedFetch } = await import('./ebaySell');
    let attempts = 0;
    // The corrupted token 401s once, the refresh lands, the retry succeeds.
    globalThis.fetch = async (url) => {
      if (url === '/api/ebay/oauth') {
        return { ok: true, status: 200, json: async () => REFRESH_GRANT };
      }
      attempts++;
      return attempts === 1
        ? { ok: false, status: 401, json: async () => ({}), text: async () => '{}' }
        : { ok: true, status: 200, json: async () => ({ healed: true }), text: async () => '{}' };
    };

    const response = await authedFetch('sell/account/v1/payment_policy');
    expect(response.status).toBe(200);
    expect(attempts).toBe(2);

    const after = await credentialStore.get('ebay-tokens');
    expect(after.accessToken).toBe(REFRESH_GRANT.access_token);
    // The 18-month credential must survive the heal, or the connection dies on
    // the very repair that was meant to save it.
    expect(after.refreshToken).toBe(CODE_GRANT.refresh_token);
  });

  it('a disconnect mid-refresh wins — the in-flight write is dropped', async () => {
    await connect();

    let releaseExchange;
    const gate = new Promise((resolve) => { releaseExchange = resolve; });
    globalThis.fetch = async () => {
      await gate;
      return { ok: true, status: 200, json: async () => REFRESH_GRANT };
    };

    const inFlight = refreshAccessToken().then(() => 'wrote', e => e.code);
    await disconnectEbay();          // lands between the read and the write
    releaseExchange();

    expect(await inFlight).toBe('disconnected');
    // The whole point: tokens do not come back from the dead.
    expect(await getBlob('ebay-tokens')).toBeNull();
    expect(await describeEbay()).toMatchObject({ connected: false });
  });

  it('a reconnect gets a fresh expiry rather than inheriting the old one', async () => {
    const first = await connect();
    // Month 17: the whole reason to reconnect is a NEW 18-month window.
    await new Promise(r => setTimeout(r, 5));
    const second = await connect();
    expect(second.refreshExpiresAt).toBeGreaterThan(first.refreshExpiresAt);
  });
});
