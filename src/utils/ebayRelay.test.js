// The relays' pure parts. These live under src/ rather than beside the
// handlers on purpose: Vercel turns every file under api/ into an endpoint, so
// an api/**.test.js would deploy as a public route.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { challengeResponse, endpointUrl } from '../../api/ebay/deletion.js';
import { grantBody, tokenEndpoint, basicAuth } from '../../api/ebay/oauth.js';
import { isAllowedPath } from '../../api/ebay/proxy.js';

describe('deletion challenge (ebay §4)', () => {
  // ⚠ ORDER IS LOAD-BEARING: challenge_code + verification_token + endpoint_url.
  // eBay recomputes this hash and rejects the endpoint on a mismatch, with no
  // diagnostic that says the order was wrong — the registration simply fails.
  const CODE = 'abc123challenge';
  const TOKEN = 'a-self-chosen-verification-token-of-decent-length';
  const URL_ = 'https://thrift-flip.vercel.app/api/ebay/deletion';

  it('hashes code + token + url in that exact order', () => {
    const expected = createHash('sha256').update(CODE + TOKEN + URL_).digest('hex');
    expect(challengeResponse(CODE, TOKEN, URL_)).toBe(expected);
  });

  it('is 64 lowercase hex characters', () => {
    expect(challengeResponse(CODE, TOKEN, URL_)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when the operands are transposed — the mistake this pins', () => {
    const wrongOrder = createHash('sha256').update(TOKEN + CODE + URL_).digest('hex');
    expect(challengeResponse(CODE, TOKEN, URL_)).not.toBe(wrongOrder);
  });

  it('changes with the challenge code, so eBay gets a fresh answer each time', () => {
    expect(challengeResponse('one', TOKEN, URL_)).not.toBe(challengeResponse('two', TOKEN, URL_));
  });
});

describe('deletion endpoint URL', () => {
  const req = (headers, url = '/api/ebay/deletion?challenge_code=x') => ({ headers, url });

  it('prefers the configured value — it must byte-match eBay’s registration', () => {
    process.env.EBAY_DELETION_ENDPOINT_URL = 'https://registered.example/api/ebay/deletion';
    expect(endpointUrl(req({ host: 'something-else.vercel.app' })))
      .toBe('https://registered.example/api/ebay/deletion');
    delete process.env.EBAY_DELETION_ENDPOINT_URL;
  });

  it('derives host + path when unset, and drops the query string', () => {
    expect(endpointUrl(req({ 'x-forwarded-host': 'thrift-flip.vercel.app', 'x-forwarded-proto': 'https' })))
      .toBe('https://thrift-flip.vercel.app/api/ebay/deletion');
  });
});

describe('token endpoint', () => {
  it('routes sandbox and production to different hosts', () => {
    expect(tokenEndpoint('sandbox')).toBe('https://api.sandbox.ebay.com/identity/v1/oauth2/token');
    expect(tokenEndpoint('production')).toBe('https://api.ebay.com/identity/v1/oauth2/token');
  });

  it('defaults to sandbox rather than production when EBAY_ENV is unset', () => {
    // Failing safe matters here: an unset variable must not point a half-built
    // integration at the live marketplace.
    expect(tokenEndpoint(undefined)).toContain('sandbox');
  });

  it('builds Basic auth as base64(appId:certId)', () => {
    expect(basicAuth('APP', 'CERT')).toBe(`Basic ${Buffer.from('APP:CERT').toString('base64')}`);
  });
});

describe('grant bodies', () => {
  const read = (body) => Object.fromEntries(body.entries());

  it('sends the RuName as redirect_uri on the code grant', () => {
    // eBay takes the RuName string here, not a URL, and it must match the value
    // used on the authorize call or the grant is rejected.
    const body = read(grantBody({
      grant_type: 'authorization_code', code: 'CODE', redirect_uri: 'Some-RuName-1234',
    }));
    expect(body).toEqual({
      grant_type: 'authorization_code', code: 'CODE', redirect_uri: 'Some-RuName-1234',
    });
  });

  it('sends refresh_token and scope on the refresh grant, and no code', () => {
    const body = read(grantBody({
      grant_type: 'refresh_token', refresh_token: 'RT', scope: 'a b',
    }));
    expect(body).toEqual({ grant_type: 'refresh_token', refresh_token: 'RT', scope: 'a b' });
    expect(body.code).toBeUndefined();
  });

  it('mints an app token for Taxonomy, defaulting the scope', () => {
    // E2's third grant. Category suggestions are not user-specific, so eBay
    // wants the application token rather than Dad's.
    expect(read(grantBody({ grant_type: 'client_credentials' }))).toEqual({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    });
  });

  it('refuses an unknown grant rather than forwarding it upstream', () => {
    expect(grantBody({ grant_type: 'password' })).toBeNull();
    expect(grantBody({})).toBeNull();
  });
});

describe('proxy path allowlist', () => {
  const allowed = [
    'sell/inventory/v1/inventory_item/1730000000000',
    'sell/inventory/v1/offer',
    'sell/inventory/v1/offer?sku=1730000000000&marketplace_id=EBAY_US',
    'sell/inventory/v1/offer/9876543210',
    'sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US',
    'sell/account/v1/payment_policy',
    'sell/account/v1/return_policy',
    'commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US',
    'commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=blanket',
  ];
  for (const path of allowed) {
    it(`allows ${path.split('?')[0]}`, () => expect(isAllowedPath(path)).toBe(true));
  }

  const refused = [
    ['an off-list Sell family', 'sell/fulfillment/v1/order'],
    ['publishOffer — E2 never publishes, so the relay cannot either', 'sell/inventory/v1/offer/123/publish'],
    ['withdrawOffer', 'sell/inventory/v1/offer/123/withdraw'],
    ['account settings beyond policies', 'sell/account/v1/privilege'],
    ['traversal', 'sell/inventory/v1/../../identity/v1/oauth2/token'],
    ['an absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative host', '//evil.example/steal'],
    ['a leading slash', '/sell/inventory/v1/offer'],
    ['empty', ''],
    ['a non-string', null],
  ];
  for (const [label, path] of refused) {
    it(`refuses ${label}`, () => expect(isAllowedPath(path)).toBe(false));
  }
});
