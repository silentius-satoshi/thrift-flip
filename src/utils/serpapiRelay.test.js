// The sold-comps relay's pure parts. Lives under src/ rather than beside the
// handler for the same reason ebayRelay.test.js does: Vercel turns every file
// under api/ into an endpoint, so an api/**.test.js would deploy as a route.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import handler, { shapeComps, parseSoldDate } from '../../api/serpapi/comps.js';

// ── Fixture provenance, which matters for how much these tests prove ────────
//
// Both files were captured live from SerpApi's eBay engine on 2026-07-28. The
// ROWS ARE REAL BYTES: real titles, real links, real `price.extracted`, real
// `price.from/to` ranges, real `sponsored` flags.
//
// `sold_date` is the exception and is SYNTHETIC. eBay gates sold search and
// SerpApi's engine does not get through it — every sold request in this project
// has returned 0 rows or a 503 (see api/serpapi/comps.js for the measurements),
// so the sold arm's date FORMAT has never been observed. That is precisely why
// `parseSoldDate` degrades to null instead of guessing, and why the degradation
// below is tested as hard as the happy path: the untested-format case is the
// one that will actually happen first.
const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const SOLD = load('serpapi-ebay-sold.json');
const ACTIVE = load('serpapi-ebay-active.json');

describe('parseSoldDate', () => {
  it('reads the documented "Sold  <date>" form', () => {
    expect(parseSoldDate('Sold  Jul 12, 2026')).toBe(Date.parse('Jul 12, 2026'));
    expect(parseSoldDate('Sold Jul 12, 2026')).toBe(Date.parse('Jul 12, 2026'));
  });

  it('reads a bare date too, since the prefix is not a contract', () => {
    expect(parseSoldDate('Jul 12, 2026')).toBe(Date.parse('Jul 12, 2026'));
  });

  // The format is unobserved. Every one of these has to produce "unknown"
  // rather than a number, because a wrong window becomes a wrong velocity and
  // "sells ~4/week" on a shelf-sitter costs him a month of storage.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 1_600_000_000],
    ['empty', ''],
    ['only the prefix', 'Sold'],
    ['prose', 'sold recently'],
    ['a relative date', '3 days ago'],
  ])('returns null for %s', (_label, input) => {
    expect(parseSoldDate(input)).toBeNull();
  });
});

describe('shapeComps', () => {
  const shaped = shapeComps(SOLD);

  it('drops sponsored rows and ended-unsold rows', () => {
    const sponsored = SOLD.organic_results.filter(r => r.sponsored).length;
    const unsold = SOLD.organic_results.filter(r => r.unsold_date && !r.sold_date).length;
    expect(sponsored).toBeGreaterThan(0);   // the fixture must still exercise this
    expect(unsold).toBeGreaterThan(0);
    expect(shaped.count).toBe(SOLD.organic_results.length - sponsored - unsold);
  });

  it('computes median, low and high off the surviving prices', () => {
    const prices = SOLD.organic_results
      .filter(r => !r.sponsored && !(r.unsold_date && !r.sold_date))
      .map(r => r.price.extracted ?? (r.price.from.extracted + r.price.to.extracted) / 2)
      .sort((a, b) => a - b);
    const mid = prices.length % 2
      ? prices[(prices.length - 1) / 2]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    expect(shaped.median).toBe(mid);
    expect(shaped.low).toBe(prices[0]);
    expect(shaped.high).toBe(prices[prices.length - 1]);
  });

  // A "$39.99 to $59.99" row is one listing with variants. Dropping it would
  // bias the median toward fixed-price listings; the fixture carries two.
  it('takes the midpoint of a from/to price range', () => {
    const ranged = { organic_results: [{ title: 'x', price: { from: { extracted: 10 }, to: { extracted: 20 } }, sold_date: 'Sold Jul 1, 2026' }] };
    expect(shapeComps(ranged).median).toBe(15);
  });

  it('reports a window and a velocity from the dated sales', () => {
    expect(shaped.windowDays).toBeGreaterThan(0);
    expect(shaped.windowDays).toBeLessThanOrEqual(90);
    expect(shaped.velocityPerWeek).toBeCloseTo(shaped.count / (shaped.windowDays / 7), 1);
  });

  it('returns at most five samples, most recent first', () => {
    expect(shaped.samples.length).toBeLessThanOrEqual(5);
    const dates = shaped.samples.map(s => s.date).filter(Boolean);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('carries a real title, price and link on every sample', () => {
    for (const s of shaped.samples) {
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
      expect(Number.isFinite(s.price)).toBe(true);
      expect(s.link).toMatch(/^https:\/\/www\.ebay\.com\//);
    }
  });

  // The case that will happen first in production: rows arrive, dates do not
  // parse. Prices are still real, so they still price the item — but the
  // window and the velocity must go quiet rather than be invented.
  it('still prices the item when no date parses, with no window and no velocity', () => {
    const undated = shapeComps(ACTIVE);
    expect(undated.count).toBeGreaterThan(0);
    expect(Number.isFinite(undated.median)).toBe(true);
    expect(undated.windowDays).toBeNull();
    expect(undated.velocityPerWeek).toBeNull();
    expect(undated.samples.every(s => s.date === null)).toBe(true);
  });

  it('needs two dated sales before it will claim a window', () => {
    const one = { organic_results: [{ title: 'x', price: { extracted: 10 }, sold_date: 'Sold Jul 1, 2026' }] };
    expect(shapeComps(one).windowDays).toBeNull();
    expect(shapeComps(one).velocityPerWeek).toBeNull();
  });

  // Zero results is the honest, common answer for thrift inventory — and it is
  // what this relay returns for EVERY query today. It must never read as an
  // error, or the app would blame the item for eBay's gate.
  it.each([
    ['an empty result set', { organic_results: [] }],
    ['no organic_results at all', {}],
    ['null', null],
    ['a SerpApi error body', { error: "eBay hasn't returned any results for this query." }],
    ['rows with no usable price', { organic_results: [{ title: 'x', price: { raw: 'Free' } }] }],
    ['only sponsored rows', { organic_results: [{ title: 'x', sponsored: true, price: { extracted: 9 } }] }],
    ['a negative price', { organic_results: [{ title: 'x', price: { extracted: -5 } }] }],
  ])('reports unavailable for %s', (_label, payload) => {
    expect(shapeComps(payload)).toEqual({ unavailable: true });
  });

  // The narrowing is the point: the client gets a summary, never eBay's rows.
  it('returns only derived fields — no passthrough of the raw payload', () => {
    expect(Object.keys(shaped).sort()).toEqual(
      ['count', 'high', 'low', 'median', 'samples', 'velocityPerWeek', 'windowDays'],
    );
    expect(JSON.stringify(shaped)).not.toContain('serpapi_link');
    expect(JSON.stringify(shaped)).not.toContain('thumbnail');
  });
});

// ── The handler's gate and its degradation ──────────────────────────────────
function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const req = (over = {}) => ({ method: 'GET', url: '/api/serpapi/comps?q=nike+air+force', headers: {}, ...over });

describe('the comps relay handler', () => {
  beforeEach(() => {
    process.env.RELAY_SECRET = 'test-secret';
    process.env.SERPAPI_KEY = 'test-serp-key';
    globalThis.fetch = vi.fn();
  });

  const authed = (over = {}) => req({ headers: { authorization: 'Bearer test-secret' }, ...over });

  it('refuses an unauthenticated caller', async () => {
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses the wrong secret, and never ships one to SerpApi on the way', async () => {
    const res = mockRes();
    await handler(req({ headers: { authorization: 'Bearer wrong' } }), res);
    expect(res.statusCode).toBe(401);
  });

  // Never ungated. An unset RELAY_SECRET must close the door, not open it.
  it('refuses everything when no relay secret is configured', async () => {
    delete process.env.RELAY_SECRET;
    const res = mockRes();
    await handler(authed(), res);
    expect(res.statusCode).toBe(401);
  });

  it('is GET only', async () => {
    const res = mockRes();
    await handler(authed({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('needs a query', async () => {
    const res = mockRes();
    await handler(authed({ url: '/api/serpapi/comps?q=%20%20' }), res);
    expect(res.statusCode).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends show_only=Sold,Complete and never eBay\'s own LH_ params', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => SOLD });
    await handler(authed(), mockRes());
    const url = String(globalThis.fetch.mock.calls[0][0]);
    expect(url).toContain('show_only=Sold%2CComplete');
    expect(url).not.toContain('LH_Sold');
  });

  // Every failure converges on the same answer. A 502 would render beside a
  // photo of a mug as something wrong with the mug.
  it.each([
    ['SerpApi is down', () => globalThis.fetch.mockResolvedValue({ ok: false, json: async () => ({}) })],
    ['the search times out', () => globalThis.fetch.mockRejectedValue(new Error('timeout'))],
    ['eBay returns nothing', () => globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ organic_results: [] }) })],
    ['the body is not JSON', () => globalThis.fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('x'); } })],
  ])('answers 200 unavailable when %s', async (_label, arrange) => {
    arrange();
    const res = mockRes();
    await handler(authed(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ unavailable: true });
  });

  it('answers unavailable rather than erroring when no SerpApi key is set', async () => {
    delete process.env.SERPAPI_KEY;
    const res = mockRes();
    await handler(authed(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ unavailable: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns the shaped summary, and none of SerpApi\'s payload', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => SOLD });
    const res = mockRes();
    await handler(authed(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.search_metadata).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('test-serp-key');
  });
});
