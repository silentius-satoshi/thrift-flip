// Inbound: sold orders, offer status, traffic, and the money each produces.
// The assertions that matter most are the ones that would otherwise corrupt a
// record silently — claiming a foreign SKU, double-counting a refresh, or
// quietly costing $7 a sale to calcProfit's default shipping.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { primeSession, __testSeam } = await import('./credentials');
const {
  extractSales, mergeSoldHistory, parseTrafficTable, realizedNet, daysToSell,
  fetchSoldOrders, fetchTraffic, refreshOfferStatus, refreshInbound,
  getSoldHistory, SOLD_HISTORY_KEY, THROTTLE_MS,
} = await import('./ebayInbound');
const { getHistory } = await import('./historyStore');

const DAY = 24 * 60 * 60 * 1000;
const OURS = '1730000000000';
const THEIRS = 'SOME-OTHER-TOOL-SKU';

const order = (over = {}) => ({
  orderId: '12-34567-89012',
  creationDate: '2026-07-01T10:00:00.000Z',
  totalMarketplaceFee: { value: '12.82', currency: 'USD' },
  lineItems: [{ sku: OURS, lineItemCost: { value: '94.50' } }],
  ...over,
});

function relay(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = url.startsWith('/api/ebay/proxy')
      ? decodeURIComponent(new URL(url, 'http://x').searchParams.get('path'))
      : url;
    calls.push({ url, target, method: init.method ?? 'GET' });
    for (const [pattern, respond] of routes) {
      if (pattern.test(target) || pattern.test(url)) {
        const r = typeof respond === 'function' ? respond(calls) : respond;
        return {
          ok: (r.status ?? 200) < 400, status: r.status ?? 200,
          json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}),
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '{}' };
  };
  return calls;
}

const seedHistory = (entries) => store.set('thrift-flip-history', JSON.stringify(entries));
const ENTRY = {
  id: 1, title: 'Pendleton Beaver State Wool Blanket', sku: OURS, offerId: 'OFFER-1',
  price: 94.5, goodwillPrice: 8, shipping: 12, sentAt: Date.parse('2026-06-20T00:00:00Z'),
  status: 'draft_sent',
};

beforeEach(async () => {
  store.clear();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_RELAY_SECRET', 'relay-secret');
  await __testSeam.resetAll();
  primeSession('ebay-tokens', {
    accessToken: 'A', refreshToken: 'R', obtainedAt: Date.now(),
    expiresIn: 7200, refreshExpiresIn: 47304000, refreshExpiresAt: Date.now() + 4e10,
  });
});

describe('SKU matching', () => {
  it('claims our line items and ignores everyone else’s', () => {
    // Dad may sell things on this account that never went through the app.
    // Claiming them would corrupt both his earnings and his comps.
    const sales = extractSales([
      order(),
      order({ orderId: 'OTHER', lineItems: [{ sku: THEIRS, lineItemCost: { value: '40.00' } }] }),
    ], [OURS]);

    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ itemId: OURS, orderId: '12-34567-89012', soldPrice: 94.5 });
  });

  it('matches a numeric id against eBay’s string SKU', () => {
    // itemId is Date.now() — a number locally, a string on the wire.
    expect(extractSales([order()], [Number(OURS)])).toHaveLength(1);
  });

  it('takes eBay’s own fee rather than guessing', () => {
    expect(extractSales([order()], [OURS])[0].marketplaceFee).toBe(12.82);
  });

  it('reports an absent fee as null, not zero', () => {
    // "no fee" and "we don't know" lead to different arithmetic downstream.
    const sales = extractSales([order({ totalMarketplaceFee: undefined })], [OURS]);
    expect(sales[0].marketplaceFee).toBeNull();
  });

  it('splits an order fee across our line items in it', () => {
    const sales = extractSales([order({
      lineItems: [
        { sku: OURS, lineItemCost: { value: '50.00' } },
        { sku: '999', lineItemCost: { value: '44.50' } },
      ],
    })], [OURS, '999']);
    expect(sales.map(s => s.marketplaceFee)).toEqual([6.41, 6.41]);
  });

  it('skips an order with no usable date or id', () => {
    expect(extractSales([order({ creationDate: null }), order({ orderId: null })], [OURS])).toEqual([]);
  });
});

describe('sold-history dedupe', () => {
  it('is idempotent — refreshing twice adds nothing', () => {
    const sales = extractSales([order()], [OURS]);
    const once = mergeSoldHistory(sales, {});
    const twice = mergeSoldHistory(sales, once);
    expect(twice[OURS]).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it('keeps two genuinely different orders for one item', () => {
    const a = extractSales([order()], [OURS]);
    const b = extractSales([order({ orderId: 'SECOND-SALE' })], [OURS]);
    expect(mergeSoldHistory(b, mergeSoldHistory(a, {}))[OURS]).toHaveLength(2);
  });
});

describe('realized earnings', () => {
  const sale = { soldPrice: 94.5, marketplaceFee: 12.82, soldAt: Date.now() };

  it('uses eBay’s real fee and the item’s stored shipping', () => {
    // 94.50 − 12.82 − 12.00 − 8.00
    expect(realizedNet(ENTRY, sale)).toBeCloseTo(61.68, 2);
  });

  it('never falls back to calcProfit’s $5 shipping default', () => {
    // That default is the ~$7 optimism V3 removed from the listing editor;
    // an entry from before E3 has no stored shipping and must not inherit it.
    const legacy = { ...ENTRY, shipping: undefined };
    const withDefault = realizedNet(legacy, { ...sale, marketplaceFee: null });
    const asIfFive = 94.5 - (94.5 * 0.1325 + 0.30) - 5 - 8;
    expect(withDefault).toBeLessThan(asIfFive - 5);
  });

  it('prefers eBay’s fee even when it disagrees with the estimate', () => {
    // A promoted listing costs more than the flat 13.25% the house estimate
    // assumes. The real number has to win, or Earnings quietly overstates.
    const promoted = realizedNet(ENTRY, { ...sale, marketplaceFee: 20 });
    expect(promoted).toBeCloseTo(94.5 - 20 - 12 - 8, 2);
  });

  it('estimates only when eBay reported no fee', () => {
    const estimated = realizedNet(ENTRY, { ...sale, marketplaceFee: null });
    expect(estimated).toBeCloseTo(94.5 - (94.5 * 0.1325 + 0.30) - 12 - 8, 2);
  });
});

describe('days to sell', () => {
  const soldAt = Date.parse('2026-07-01T00:00:00Z');

  it('measures from when the app saw it live', () => {
    const entry = { ...ENTRY, liveAt: Date.parse('2026-06-24T00:00:00Z') };
    expect(daysToSell(entry, { soldAt })).toEqual({ days: 7, approx: false });
  });

  it('falls back to draft-sent and says so', () => {
    // The days a draft sat unpublished in Seller Hub are not days it was for
    // sale, so the row is marked rather than quietly overstating.
    expect(daysToSell(ENTRY, { soldAt })).toEqual({ days: 11, approx: true });
  });

  it('ignores a live stamp later than the sale', () => {
    // Connecting eBay for the first time stamps liveAt now, on items that sold
    // weeks ago. Reporting "0 days" would read as an instant sale.
    const entry = { ...ENTRY, liveAt: soldAt + 5 * DAY };
    expect(daysToSell(entry, { soldAt })).toEqual({ days: 11, approx: true });
  });

  it('returns null when even the sent date is after the sale', () => {
    expect(daysToSell({ ...ENTRY, sentAt: soldAt + DAY }, { soldAt })).toBeNull();
  });

  it('returns null when there is nothing to measure', () => {
    expect(daysToSell({}, { soldAt })).toBeNull();
    expect(daysToSell(ENTRY, {})).toBeNull();
  });
});

describe('traffic', () => {
  it('parses eBay’s table response into a per-listing map', () => {
    expect(parseTrafficTable({
      header: { dimensionKeys: [{ key: 'LISTING_ID' }], metrics: [{ key: 'LISTING_VIEWS_TOTAL' }] },
      records: [
        { dimensionValues: [{ value: '110001' }], metricValues: [{ value: 42 }] },
        { dimensionValues: [{ value: '110002' }], metricValues: [{ value: 7 }] },
      ],
    })).toEqual({ 110001: { views: 42 }, 110002: { views: 7 } });
  });

  it('does not call out at all when nothing is live', async () => {
    // listing_ids is a REQUIRED filter — an empty one is an error, not an
    // empty answer.
    const calls = relay([]);
    expect(await fetchTraffic([])).toEqual({});
    expect(await fetchTraffic([null, undefined])).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('asks for a range inside eBay’s 90-day cap', async () => {
    const calls = relay([[/traffic_report/, { body: { header: {}, records: [] } }]]);
    await fetchTraffic(['110001']);
    const filter = decodeURIComponent(calls[0].target);
    const [, from, to] = filter.match(/date_range:\[(\d{8})\.\.(\d{8})\]/);
    const days = (Date.parse(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6)}`)
      - Date.parse(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6)}`)) / DAY;
    expect(days).toBeLessThanOrEqual(90);
    expect(filter).toContain('listing_ids:{110001}');
  });
});

describe('offer status', () => {
  it('flips to Live and stamps liveAt when a listingId appears', async () => {
    relay([[/offer\/OFFER-1/, { body: { listing: { listingId: '110001' } } }]]);
    const updates = await refreshOfferStatus([ENTRY]);
    expect(updates.get(1)).toMatchObject({ listingId: '110001', status: 'live' });
    expect(updates.get(1).liveAt).toBeGreaterThan(0);
  });

  it('leaves an unpublished draft alone', async () => {
    // E2 never publishes, so an offer with no listingId means Dad has not
    // pressed publish in Seller Hub yet.
    relay([[/offer\/OFFER-1/, { body: {} }]]);
    expect((await refreshOfferStatus([ENTRY])).size).toBe(0);
  });

  it('does not re-ask about an entry already known live', async () => {
    const calls = relay([[/offer/, { body: { listing: { listingId: 'X' } } }]]);
    await refreshOfferStatus([{ ...ENTRY, listingId: '110001' }]);
    expect(calls).toHaveLength(0);
  });
});

describe('refreshInbound', () => {
  const ROUTES = [
    [/offer\/OFFER-1/, { body: { listing: { listingId: '110001' } } }],
    [/fulfillment\/v1\/order/, { body: { orders: [order()], total: 1 } }],
    [/traffic_report/, {
      body: {
        header: { dimensionKeys: [{ key: 'LISTING_ID' }], metrics: [{ key: 'LISTING_VIEWS_TOTAL' }] },
        records: [{ dimensionValues: [{ value: '110001' }], metricValues: [{ value: 42 }] }],
      },
    }],
  ];

  it('records the sale, the listing and the views in one pass', async () => {
    seedHistory([ENTRY]);
    relay(ROUTES);

    const result = await refreshInbound({ manual: true });
    expect(result).toMatchObject({ connected: true, sales: 1, live: 1 });

    expect(getSoldHistory()[OURS]).toHaveLength(1);
    const entry = getHistory()[0];
    expect(entry).toMatchObject({ listingId: '110001', status: 'live', views: 42 });
    expect(entry.liveAt).toBeGreaterThan(0);
  });

  it('throttles a tab-open refresh but never the manual one', async () => {
    seedHistory([ENTRY]);
    store.set('thrift-flip-inbound-prefs', JSON.stringify({ lastPullAt: Date.now() }));

    const calls = relay(ROUTES);
    expect(await refreshInbound({ manual: false })).toMatchObject({ skipped: true });
    expect(calls).toHaveLength(0);

    // §7: "cache verdict-cheap; a manual refresh is always allowed".
    await refreshInbound({ manual: true });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('lets a tab-open refresh through once the window has passed', async () => {
    seedHistory([ENTRY]);
    store.set('thrift-flip-inbound-prefs',
      JSON.stringify({ lastPullAt: Date.now() - THROTTLE_MS - 1000 }));
    const calls = relay(ROUTES);
    await refreshInbound({ manual: false });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('resolves quietly when eBay is not connected', async () => {
    await __testSeam.resetAll(); // no tokens
    seedHistory([ENTRY]);
    const calls = relay(ROUTES);
    expect(await refreshInbound({ manual: true })).toEqual({ connected: false });
    // Selling renders its local record; nothing was written and nothing asked.
    expect(calls).toHaveLength(0);
    expect(store.has(SOLD_HISTORY_KEY)).toBe(false);
  });

  it('makes no calls at all with an empty history', async () => {
    seedHistory([]);
    const calls = relay(ROUTES);
    expect(await refreshInbound({ manual: true })).toMatchObject({ sales: 0 });
    expect(calls).toHaveLength(0);
  });

  it('does not double-count across two refreshes', async () => {
    seedHistory([ENTRY]);
    relay(ROUTES);
    await refreshInbound({ manual: true });
    await refreshInbound({ manual: true });
    expect(getSoldHistory()[OURS]).toHaveLength(1);
  });
});

describe('order pagination', () => {
  it('follows pages rather than stopping at the first', async () => {
    // A silently truncated first page looks exactly like "nothing else sold".
    const page = (n, count) => ({
      orders: Array.from({ length: count }, (_, i) => order({ orderId: `p${n}-${i}` })),
      total: 201,
    });
    let calls = 0;
    relay([[/fulfillment\/v1\/order/, () => { calls++; return { body: page(calls, calls === 1 ? 200 : 1) }; }]]);
    const sales = await fetchSoldOrders([OURS]);
    expect(calls).toBe(2);
    expect(sales).toHaveLength(201);
  });
});
