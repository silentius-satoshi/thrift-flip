// The eBay Connect flow (ebay-connect §5 — step E1).
//
// Tokens go into the N1-lite vault on their first byte and are never written in
// the clear even once. That is the whole reason the vault was pulled ahead of
// this step: an ~18-month refresh token is access to Dad's selling account,
// where a stolen Gemini key is a free-tier annoyance he revokes in one tap.
//
// Errors thrown from here carry a { code } and nothing else — never a token,
// never the relay secret, never a response body.
import { credentialStore } from './credentials';

const CREDENTIAL = 'ebay-tokens';
export const CALLBACK_PATH = '/ebay/callback';

// A CSRF nonce for the round trip. sessionStorage, not localStorage: it
// survives the full-page redirect to eBay and back in the same tab, dies with
// the tab, and never reaches backup.js — which scans localStorage only.
const STATE_KEY = 'thrift-flip-ebay-state';

// Full URIs, space-separated, URL-encoded by URLSearchParams. The short names
// in ebay §5 ("sell.inventory") are the documentation's shorthand — the
// authorize endpoint rejects them. Note the `api.ebay.com` prefix holds in
// SANDBOX TOO; scope strings are not environment-specific, only hosts are.
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
].join(' ');

const cfg = () => import.meta.env;
const isProduction = () => cfg().VITE_EBAY_ENV === 'production';

// Captured at import, before any render can rewrite the URL — `handleCallback`
// scrubs the address bar early and the code would otherwise be unreachable.
const CALLBACK_SEARCH =
  (typeof window !== 'undefined' && window.location.pathname === CALLBACK_PATH)
    ? window.location.search
    : null;

/** True for the whole session, so routing decisions survive the URL scrub. */
export const isEbayCallback = () => CALLBACK_SEARCH !== null;

let callbackConsumed = false;

// Bumped whenever the stored connection is deliberately replaced or removed.
// A refresh that started before the change must not write its result
// afterwards — `disconnectEbay` is a clear, `storeTokens` ends in a set, and a
// disconnect landing between a refresh's read and its write would silently
// resurrect the tokens. Same shape as ShoppingMode's reqSeq guard (F2+A):
// the later intent wins and the in-flight result is discarded.
let connectionGeneration = 0;

/** One-shot: a second caller (or React's double-invoked dev effect) gets null. */
export function takePendingCallback() {
  if (callbackConsumed || CALLBACK_SEARCH === null) return null;
  callbackConsumed = true;
  return CALLBACK_SEARCH;
}

function err(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

/** The gate behind Settings' disabled row: a build with no eBay env vars. */
export function isEbayConfigured() {
  return Boolean(cfg().VITE_EBAY_APP_ID && cfg().VITE_EBAY_RU_NAME && cfg().VITE_RELAY_SECRET);
}

// Not a §11 concern: this is a CSRF nonce, not key material. The two-files rule
// covers key derivation and encryption, which stay sealed inside lib/keyVault.
const newState = () => crypto.randomUUID();

export function buildAuthUrl() {
  if (!isEbayConfigured()) throw err('not-configured');
  const state = newState();
  sessionStorage.setItem(STATE_KEY, state);
  const host = isProduction() ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
  const params = new URLSearchParams({
    client_id: cfg().VITE_EBAY_APP_ID,
    // eBay takes the RuName string here, not a URL. The token exchange must
    // then send the identical value or the grant is rejected.
    redirect_uri: cfg().VITE_EBAY_RU_NAME,
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `${host}/oauth2/authorize?${params}`;
}

export function startConnect() {
  // A new grant replaces the record wholesale, including on the month-17
  // reconnect — so any refresh still in flight from the old connection is
  // invalidated here too.
  connectionGeneration += 1;
  window.location.assign(buildAuthUrl());
}

async function exchange(payload) {
  let response;
  try {
    response = await fetch('/api/ebay/oauth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg().VITE_RELAY_SECRET}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw err('offline');
  }
  if (!response.ok) {
    if (response.status === 401) throw err('relay-unauthorized');
    let code = 'exchange-failed';
    try { code = (await response.json())?.error ?? code; } catch { /* keep the generic code */ }
    throw err(code);
  }
  let data;
  try { data = await response.json(); } catch { throw err('bad-response'); }
  // Atomicity lives here: nothing is written unless a complete response parsed
  // and carries a token. A relay killed mid-flight leaves no partial state.
  if (!data?.access_token) throw err('bad-response');
  return data;
}

/**
 * @param {object} raw       eBay's token JSON
 * @param {object} [existing] the stored record, on a refresh
 *
 * The refresh grant returns ONLY access_token / expires_in / token_type. Both
 * the refresh token and its expiry must be carried forward from the stored
 * record — overwriting from the response would null the refresh token and kill
 * the connection on the very first refresh.
 */
async function storeTokens(raw, existing = null, generation = connectionGeneration) {
  const obtainedAt = Date.now();
  const refreshExpiresIn = Number(raw.refresh_token_expires_in) || existing?.refreshExpiresIn || 0;
  const record = {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? existing?.refreshToken ?? null,
    obtainedAt,
    expiresIn: Number(raw.expires_in) || 0,
    refreshExpiresIn,
    // Absolute, computed once at connect and preserved thereafter. Deriving the
    // expiry from a refreshed `obtainedAt` would slide the displayed date
    // forward every refresh and quietly hide a connection about to lapse.
    refreshExpiresAt: existing?.refreshExpiresAt ?? obtainedAt + refreshExpiresIn * 1000,
  };
  // The disconnect guard. `generation` is captured by the CALLER, before its
  // network round trip — capturing it here would read a value the disconnect
  // had already bumped, and the guard would never fire.
  if (generation !== connectionGeneration) throw err('disconnected');

  await credentialStore.set(CREDENTIAL, record, {
    // Display only, readable without an unlock — so opening Settings costs no
    // ceremony. A month is all the row shows; nothing token-shaped goes here.
    hint: { through: record.refreshExpiresAt },
  });
  return record;
}

/**
 * Runs on boot when the browser lands on CALLBACK_PATH. Validates state, cleans
 * the URL, then exchanges. Throws with a { code } the caller maps to copy.
 */
export async function handleCallback(search = window.location.search) {
  const generation = connectionGeneration;
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const returned = params.get('state');
  const denied = params.get('error');

  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY); // one-shot, whatever happens next

  // Cleaned before the exchange, not after: an authorization code sitting in
  // the address bar can leave via a screenshot, the back button or a referer
  // header, and the exchange can take seconds or hang.
  cleanUrl();

  if (denied) throw err(denied === 'access_denied' ? 'declined' : 'ebay-error');
  if (!code) throw err('no-code');
  if (!expected || returned !== expected) throw err('state-mismatch');

  const raw = await exchange({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg().VITE_EBAY_RU_NAME,
  });
  return storeTokens(raw, null, generation);
}

function cleanUrl() {
  // globalThis-qualified: `typeof history?.x` still throws a ReferenceError
  // where `history` is undeclared, because typeof only guards a bare identifier.
  if (typeof globalThis.history?.replaceState !== 'function') return;
  globalThis.history.replaceState(null, '', '/');
}

/**
 * The refresh half of E2's 401 → refresh → retry-once path. Built here, wired
 * to real Sell API calls at E2. Also what Settings' "Test" runs, so a stale
 * access token is repaired by the same button that reports on it.
 */
export async function refreshAccessToken() {
  // Captured before anything awaits, so a disconnect landing at any point
  // between here and the write is caught.
  const generation = connectionGeneration;
  const existing = await credentialStore.get(CREDENTIAL);
  if (!existing?.refreshToken) throw err('not-connected');
  const raw = await exchange({
    grant_type: 'refresh_token',
    refresh_token: existing.refreshToken,
    scope: SCOPES,
  });
  return storeTokens(raw, existing, generation);
}

/** Requires an unlock — it returns the tokens themselves. */
export const getEbayTokens = () => credentialStore.get(CREDENTIAL);

/** Presence and the expiry month. Metadata only, so it never prompts. */
export async function describeEbay() {
  const d = await credentialStore.describe(CREDENTIAL);
  return { connected: d.present, through: d.hint?.through ?? null, scheme: d.scheme };
}

/**
 * Local disconnect. eBay keeps its own grant record, which is why the UI tells
 * him to revoke there too — this cannot reach eBay's servers.
 */
export async function disconnectEbay() {
  // Bump first: an in-flight refresh must find the generation already moved on
  // by the time it reaches its write, whichever order the two finish in.
  connectionGeneration += 1;
  await credentialStore.clear(CREDENTIAL);
}
