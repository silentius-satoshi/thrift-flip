// Outbound drafts. The load-bearing assertions here are the ones that would
// otherwise fail silently against a real account: no imageUrls key at all,
// Content-Language present on every write, the SKU being the local id, and a
// re-send updating the existing offer instead of erroring.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.history = { replaceState: () => {} };

const { credentialStore, registerUnlockUI, __testSeam } = await import('./credentials');
const {
  CONDITION_MAP, toEbayCondition, toAspects, buildInventoryItem, buildOffer,
  mapEbayErrors, sendToEbayDraft, getPolicies, suggestCategory, authedFetch,
} = await import('./ebaySell');

const ACCESS = 'v^1.1#ACCESS-TOKEN';
const REFRESH = 'v^1.1#REFRESH-TOKEN';
const SKU = '1730000000000';

const VALUES = {
  title: 'Pendleton Beaver State Wool Blanket Southwest Geometric Vintage',
  description: 'Vintage Pendleton wool blanket. Clean, no odors.',
  condition: 'Good',
  price: 94.5,
  qty: 1,
  specifics: { Brand: 'Pendleton', Size: 'Twin', Color: 'Multi', Material: 'Wool', MPN: '' },
};

const POLICIES = {
  fulfillmentPolicyId: 'FP-1', paymentPolicyId: 'PP-1', returnPolicyId: 'RP-1',
};

/** Records every proxied request and answers from a routing table. */
function relay(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = url.startsWith('/api/ebay/proxy')
      ? decodeURIComponent(new URL(url, 'http://x').searchParams.get('path'))
      : url;
    const call = {
      url, target, method: init.method ?? 'GET', headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    for (const [pattern, respond] of routes) {
      if (pattern.test(target) || pattern.test(url)) {
        const r = typeof respond === 'function' ? respond(call, calls) : respond;
        return {
          ok: (r.status ?? 200) < 400,
          status: r.status ?? 200,
          text: async () => JSON.stringify(r.body ?? {}),
          json: async () => r.body ?? {},
        };
      }
    }
    return { ok: false, status: 404, text: async () => '{}', json: async () => ({}) };
  };
  return calls;
}

const POLICY_ROUTES = [
  [/fulfillment_policy/, { body: { fulfillmentPolicies: [{ fulfillmentPolicyId: 'FP-1' }] } }],
  [/payment_policy/, { body: { paymentPolicies: [{ paymentPolicyId: 'PP-1' }] } }],
  [/return_policy/, { body: { returnPolicies: [{ returnPolicyId: 'RP-1' }] } }],
];
const TAXONOMY_ROUTES = [
  [/get_default_category_tree_id/, { body: { categoryTreeId: '0' } }],
  [/get_category_suggestions/, {
    body: {
      categorySuggestions: [{
        category: { categoryId: '45462', categoryName: 'Blankets & Throws' },
        categoryTreeNodeAncestors: [{ categoryName: 'Bedding' }, { categoryName: 'Home & Garden' }],
      }],
    },
  }],
];

async function connect() {
  registerUnlockUI({
    requestEnroll: async () => ({ scheme: 'pin', pin: '135790' }),
    requestUnlock: async () => ({ pin: '135790' }),
  });
  await credentialStore.set('ebay-tokens', {
    accessToken: ACCESS, refreshToken: REFRESH, obtainedAt: Date.now(),
    expiresIn: 7200, refreshExpiresIn: 47304000, refreshExpiresAt: Date.now() + 4e10,
  }, { hint: { through: Date.now() + 4e10 } });
}

beforeEach(async () => {
  store.clear();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_RELAY_SECRET', 'relay-secret');
  await __testSeam.resetAll();
});

describe('condition map', () => {
  it("covers the app's actual vocabulary, not the prompt's", () => {
    // config/schema.js's grade enum and ListingMode's CONDITIONS agree on these
    // five; the E2 prompt named a different set (Excellent / Fair).
    for (const label of ['New', 'Like New', 'Good', 'Acceptable', 'For Parts']) {
      expect(CONDITION_MAP[label]).toBeTruthy();
    }
  });

  it('never emits LIKE_NEW — it is a books/DVD-only enum', () => {
    // Condition id 2750 is rejected outside media categories, and E2 has no
    // category awareness when it picks a condition.
    expect(Object.values(CONDITION_MAP)).not.toContain('LIKE_NEW');
    expect(toEbayCondition('Like New').value).toBe('USED_EXCELLENT');
  });

  it('maps each label to a general-purpose used-goods enum', () => {
    expect(toEbayCondition('New').value).toBe('NEW');
    expect(toEbayCondition('Good').value).toBe('USED_GOOD');
    expect(toEbayCondition('Acceptable').value).toBe('USED_ACCEPTABLE');
    expect(toEbayCondition('For Parts').value).toBe('FOR_PARTS_OR_NOT_WORKING');
  });

  it('accepts the prompt’s labels as aliases so a stale value still lands', () => {
    expect(toEbayCondition('Excellent').value).toBe('USED_EXCELLENT');
    expect(toEbayCondition('Fair').value).toBe('USED_ACCEPTABLE');
  });

  it('records the fallback rather than pretending it knew', () => {
    expect(toEbayCondition('Wombat')).toEqual({ value: 'USED_GOOD', fellBack: true });
    expect(toEbayCondition(undefined)).toEqual({ value: 'USED_GOOD', fellBack: true });
    expect(toEbayCondition('Good').fellBack).toBe(false);
  });
});

describe('inventory item body', () => {
  const body = () => buildInventoryItem(VALUES);

  it('has NO imageUrls key at all — photo-less by decision', () => {
    // Not "imageUrls: []" — absent. An empty array reads as "this item has no
    // photos" rather than "photos are added elsewhere".
    expect('imageUrls' in body().product).toBe(false);
    expect(JSON.stringify(body())).not.toContain('imageUrls');
  });

  it('carries the quantity eBay requires', () => {
    expect(body().availability.shipToLocationAvailability.quantity).toBe(1);
    expect(buildInventoryItem({ ...VALUES, qty: '3' })
      .availability.shipToLocationAvailability.quantity).toBe(3);
    // A blank or nonsense quantity must not become zero — that is an
    // out-of-stock listing.
    expect(buildInventoryItem({ ...VALUES, qty: '' })
      .availability.shipToLocationAvailability.quantity).toBe(1);
  });

  it('truncates the title to eBay’s 80 characters', () => {
    const long = buildInventoryItem({ ...VALUES, title: 'x'.repeat(120) });
    expect(long.product.title).toHaveLength(80);
  });

  it('sends aspects as arrays and drops the empty ones', () => {
    expect(toAspects(VALUES.specifics)).toEqual({
      Brand: ['Pendleton'], Size: ['Twin'], Color: ['Multi'], Material: ['Wool'],
    });
    expect(toAspects({ MPN: '   ' })).toEqual({});
  });
});

describe('offer body', () => {
  const body = () => buildOffer({ sku: SKU, values: VALUES, categoryId: '45462', policies: POLICIES });

  it('is a fixed-price US offer carrying the three policy ids', () => {
    expect(body()).toMatchObject({
      sku: SKU, marketplaceId: 'EBAY_US', format: 'FIXED_PRICE',
      categoryId: '45462', listingPolicies: POLICIES,
    });
  });

  it('formats the price as a two-decimal string', () => {
    expect(body().pricingSummary.price).toEqual({ value: '94.50', currency: 'USD' });
    expect(buildOffer({ sku: SKU, values: { ...VALUES, price: '' }, policies: POLICIES })
      .pricingSummary.price.value).toBe('0.00');
  });

  it('omits categoryId entirely when there is no suggestion', () => {
    // Your ruling: a failed suggestion never blocks the send.
    const noCategory = buildOffer({ sku: SKU, values: VALUES, categoryId: null, policies: POLICIES });
    expect('categoryId' in noCategory).toBe(false);
  });

  it('sends no merchantLocationKey — that is a publish requirement', () => {
    // E2 never publishes, so no inventory location and no address UI is needed.
    expect(JSON.stringify(body())).not.toContain('merchantLocationKey');
  });
});

describe('error mapping (§6 failure honesty)', () => {
  it('places eBay’s complaint on the field it names', () => {
    const { fieldErrors } = mapEbayErrors([
      { message: 'The title is too long.', parameters: [{ name: 'title' }] },
      { longMessage: 'Invalid price value supplied.' },
      { message: 'Category 12345 is not valid for this marketplace' },
    ]);
    expect(fieldErrors.title).toBe('The title is too long.');
    expect(fieldErrors.price).toBe('Invalid price value supplied.');
    expect(fieldErrors.category).toContain('Category');
  });

  it('prefers longMessage, which is the one a human can read', () => {
    const { fieldErrors } = mapEbayErrors([
      { message: '25002', longMessage: 'A condition value is required.' },
    ]);
    expect(fieldErrors.condition).toBe('A condition value is required.');
  });

  it('never swallows what it cannot place', () => {
    const { fieldErrors, general } = mapEbayErrors([
      { message: 'A system error has occurred.' },
    ]);
    expect(fieldErrors).toEqual({});
    expect(general).toEqual(['A system error has occurred.']);
  });

  it('survives a rejection with no errors array', () => {
    expect(mapEbayErrors()).toEqual({ fieldErrors: {}, general: [] });
  });
});

describe('policies', () => {
  it('refuses specifically when the account has none', async () => {
    await connect();
    relay([
      [/fulfillment_policy/, { body: { fulfillmentPolicies: [] } }],
      [/payment_policy/, { body: { paymentPolicies: [] } }],
      [/return_policy/, { body: { returnPolicies: [] } }],
    ]);
    // Not a cryptic 25007 later: every send would otherwise create a draft that
    // can never be published.
    await expect(getPolicies()).rejects.toMatchObject({ code: 'no-policies' });
  });

  it('takes the first of each', async () => {
    await connect();
    relay(POLICY_ROUTES);
    expect(await getPolicies()).toEqual(POLICIES);
  });
});

describe('category suggestion', () => {
  it('returns the top suggestion with a readable path', async () => {
    await connect();
    relay([[/oauth/, { body: { access_token: 'APP-TOKEN', expires_in: 7200 } }], ...TAXONOMY_ROUTES]);
    expect(await suggestCategory('Pendleton wool blanket')).toEqual({
      categoryId: '45462',
      path: 'Home & Garden > Bedding > Blankets & Throws',
    });
  });

  it('returns null rather than throwing when taxonomy fails', async () => {
    await connect();
    relay([[/oauth/, { body: { access_token: 'APP-TOKEN', expires_in: 7200 } }],
      [/taxonomy/, { status: 500, body: {} }]]);
    expect(await suggestCategory('anything')).toBeNull();
  });

  it('does not call out at all for an empty title', async () => {
    const calls = relay([]);
    expect(await suggestCategory('   ')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('401 → refresh → retry once', () => {
  it('refreshes and retries, and the refresh token survives', async () => {
    await connect();
    let attempts = 0;
    const calls = relay([
      [/identity|\/api\/ebay\/oauth/, { body: { access_token: 'NEW-ACCESS', expires_in: 7200 } }],
      [/fulfillment_policy/, () => {
        attempts++;
        return attempts === 1
          ? { status: 401, body: {} }
          : { body: { fulfillmentPolicies: [{ fulfillmentPolicyId: 'FP-1' }] } };
      }],
    ]);

    const response = await authedFetch('sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US');
    expect(response.status).toBe(200);
    expect(attempts).toBe(2); // once, not twice

    const refreshCall = calls.find(c => c.url === '/api/ebay/oauth');
    expect(refreshCall.body.grant_type).toBe('refresh_token');
    // eBay's refresh grant returns no refresh_token; losing it here would end
    // the connection permanently.
    expect((await credentialStore.get('ebay-tokens')).refreshToken).toBe(REFRESH);
  });

  it('gives up after one retry rather than looping', async () => {
    await connect();
    let attempts = 0;
    relay([
      [/\/api\/ebay\/oauth/, { body: { access_token: 'NEW-ACCESS', expires_in: 7200 } }],
      [/fulfillment_policy/, () => { attempts++; return { status: 401, body: {} }; }],
    ]);
    const response = await authedFetch('sell/account/v1/fulfillment_policy');
    expect(response.status).toBe(401);
    expect(attempts).toBe(2);
  });
});

describe('sendToEbayDraft', () => {
  const OFFER_NONE = [/inventory\/v1\/offer\?/, { status: 404, body: {} }];
  const CREATE_OK = [/inventory\/v1\/offer$/, { body: { offerId: 'OFFER-1' } }];
  const ITEM_OK = [/inventory_item/, { status: 204, body: {} }];
  const APP_TOKEN = [/\/api\/ebay\/oauth/, { body: { access_token: 'APP-TOKEN', expires_in: 7200 } }];

  it('uses the local id as the SKU and stops at an unpublished offer', async () => {
    await connect();
    const calls = relay([APP_TOKEN, ...POLICY_ROUTES, ...TAXONOMY_ROUTES, OFFER_NONE, ITEM_OK, CREATE_OK]);

    const result = await sendToEbayDraft(VALUES, SKU);
    expect(result).toMatchObject({ offerId: 'OFFER-1', sku: SKU, categoryId: '45462' });

    const put = calls.find(c => c.target.includes('inventory_item'));
    expect(put.method).toBe('PUT');
    // One identifier, three lives (plan §6.1) — never mint a second.
    expect(put.target).toBe(`sell/inventory/v1/inventory_item/${SKU}`);
    // Stop means stop: nothing publishes.
    expect(calls.some(c => c.target.includes('publish'))).toBe(false);
  });

  it('sends Content-Language on every write', async () => {
    await connect();
    const calls = relay([APP_TOKEN, ...POLICY_ROUTES, ...TAXONOMY_ROUTES, OFFER_NONE, ITEM_OK, CREATE_OK]);
    await sendToEbayDraft(VALUES, SKU);
    // createOrReplaceInventoryItem rejects a request without it, with a message
    // that never mentions the header.
    for (const call of calls.filter(c => c.method === 'PUT' || c.method === 'POST')) {
      if (call.url.startsWith('/api/ebay/proxy')) {
        expect(call.headers['Content-Language']).toBe('en-US');
      }
    }
  });

  it('passes the eBay token beside the relay secret, not instead of it', async () => {
    await connect();
    const calls = relay([APP_TOKEN, ...POLICY_ROUTES, ...TAXONOMY_ROUTES, OFFER_NONE, ITEM_OK, CREATE_OK]);
    await sendToEbayDraft(VALUES, SKU);
    const proxied = calls.find(c => c.url.startsWith('/api/ebay/proxy'));
    expect(proxied.headers.Authorization).toBe('Bearer relay-secret');
    expect(proxied.headers['X-Ebay-Authorization']).toBe(`Bearer ${ACCESS}`);
  });

  it('updates the existing offer on a re-send instead of creating a second', async () => {
    await connect();
    const calls = relay([
      APP_TOKEN, ...POLICY_ROUTES, ...TAXONOMY_ROUTES, ITEM_OK,
      [/inventory\/v1\/offer\?/, { body: { offers: [{ offerId: 'OFFER-EXISTING' }] } }],
      [/inventory\/v1\/offer\/OFFER-EXISTING/, { body: {} }],
    ]);

    const result = await sendToEbayDraft({ ...VALUES, price: 88 }, SKU);
    expect(result.offerId).toBe('OFFER-EXISTING');

    const write = calls.find(c => c.target.startsWith('sell/inventory/v1/offer/'));
    expect(write.method).toBe('PUT');
    // The edit reaches the existing draft rather than being silently dropped.
    expect(write.body.pricingSummary.price.value).toBe('88.00');
    expect(calls.filter(c => c.target === 'sell/inventory/v1/offer' && c.method === 'POST')).toHaveLength(0);
  });

  it('sends anyway when the category suggestion fails', async () => {
    await connect();
    relay([APP_TOKEN, ...POLICY_ROUTES, [/taxonomy/, { status: 500, body: {} }],
      OFFER_NONE, ITEM_OK, CREATE_OK]);
    const result = await sendToEbayDraft(VALUES, SKU);
    expect(result.offerId).toBe('OFFER-1');
    expect(result.categoryId).toBeNull();
  });

  it('refuses before writing anything when policies are missing', async () => {
    await connect();
    const calls = relay([
      APP_TOKEN,
      [/fulfillment_policy/, { body: { fulfillmentPolicies: [] } }],
      [/payment_policy/, { body: { paymentPolicies: [] } }],
      [/return_policy/, { body: { returnPolicies: [] } }],
      ITEM_OK, CREATE_OK,
    ]);
    await expect(sendToEbayDraft(VALUES, SKU)).rejects.toMatchObject({ code: 'no-policies' });
    expect(calls.some(c => c.target.includes('inventory_item'))).toBe(false);
  });

  it('surfaces a validation rejection with eBay’s own errors attached', async () => {
    await connect();
    relay([APP_TOKEN, ...POLICY_ROUTES, ...TAXONOMY_ROUTES, OFFER_NONE, ITEM_OK,
      [/inventory\/v1\/offer$/, {
        status: 400,
        body: { errors: [{ message: 'Title is too long', parameters: [{ name: 'title' }] }] },
      }]]);

    const error = await sendToEbayDraft(VALUES, SKU).then(() => null, e => e);
    expect(error.code).toBe('ebay-rejected');
    expect(mapEbayErrors(error.errors).fieldErrors.title).toBe('Title is too long');
  });

  it('refuses without an item id rather than inventing a SKU', async () => {
    await connect();
    relay([]);
    await expect(sendToEbayDraft(VALUES, null)).rejects.toMatchObject({ code: 'no-item-id' });
  });

  it('refuses when eBay is not connected', async () => {
    relay([]);
    await expect(sendToEbayDraft(VALUES, SKU)).rejects.toMatchObject({ code: 'not-connected' });
  });
});
