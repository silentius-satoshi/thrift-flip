// Comps tier A, client half: what we ask, how often we pay for it, and what
// happens to the money when the answer arrives.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compsQuery, getSoldComps, repriceFromComps, isFresh, TTL_MS } from './soldComps';
import { calcProfit, checkRules, pencilFloor } from './calculations';

const ok = (body) => ({ ok: true, json: async () => body });

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.fetch = vi.fn();
});

const comps = (over = {}) => ({
  median: 40, low: 30, high: 55, count: 6, windowDays: 28, velocityPerWeek: 1.5,
  samples: [{ title: 'a', price: 40, date: '2026-07-20', link: 'https://www.ebay.com/itm/1' }],
  ...over,
});

describe('compsQuery', () => {
  it('builds from the model\'s brand and name, in the order a person would type', () => {
    expect(compsQuery({ identification: { brand: 'Pendleton', name: 'wool blanket' } }))
      .toBe('pendleton wool blanket');
  });

  // Regression, and it was caught by this suite rather than by a live search.
  // `tokenize` drops <=2-char and all-digit tokens, which is correct when
  // SCORING a candidate title and wrong when composing a query: it turned
  // "Sony Walkman WM-10" into "sony walkman" and dropped the 1 from "Air Force
  // 1". Those fragments are the most identifying part of the string.
  it('keeps model numbers, which are the whole point of the search', () => {
    expect(compsQuery({ identification: {}, listingTitle: 'Sony Walkman WM-10' }))
      .toBe('sony walkman wm-10');
    expect(compsQuery({ identification: { brand: 'Nike', name: 'Air Force 1' } }))
      .toBe('nike air force 1');
    expect(compsQuery({ identification: { brand: 'Pyrex', name: '404 mixing bowl' } }))
      .toContain('404');
  });

  it('strips the thrift filler that matches everything', () => {
    const q = compsQuery({ identification: { brand: 'Pyrex', name: 'vintage used bowl' } });
    expect(q).not.toContain('vintage');
    expect(q).not.toContain('used');
  });

  // The cache key is sorted even though the query is not, so two orderings of
  // the same words cost one credit between them.
  it('bills word-order variants once, while eBay still sees natural order', async () => {
    globalThis.fetch.mockResolvedValue(ok(comps()));
    await getSoldComps({ identification: { brand: 'Nike', name: 'Air Force 1' } });
    await getSoldComps({ identification: { brand: '1 Force', name: 'Air Nike' } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(globalThis.fetch.mock.calls[0][0])).toContain('q=nike air force 1');
  });

  // A one-word query returns a category, not a comp — and it would still cost
  // a credit to find that out.
  it.each([
    ['nothing at all', {}],
    ['a single token', { identification: { name: 'lamp' } }],
    ['only stopwords', { identification: { name: 'vintage used lot' } }],
    ['only digits', { identification: { name: '12 34' } }],
  ])('refuses to spend a credit on %s', (_label, input) => {
    expect(compsQuery(input)).toBeNull();
  });
});

describe('the cache — the whole of the spend discipline', () => {
  it('asks the relay once, then answers from cache', async () => {
    globalThis.fetch.mockResolvedValue(ok(comps()));
    const id = { identification: { brand: 'Nike', name: 'Air Force 1' } };

    expect((await getSoldComps(id)).median).toBe(40);
    expect((await getSoldComps(id)).median).toBe(40);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // The Re-check button is a third door into analyze; it must not be a third
  // door into his SerpApi plan.
  it('does not re-spend when the same item is re-checked', async () => {
    globalThis.fetch.mockResolvedValue(ok(comps()));
    await getSoldComps({ identification: { brand: 'Pyrex', name: 'mixing bowl' } });
    await getSoldComps({ identification: { brand: 'Pyrex', name: 'mixing bowl' } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // Most thrift inventory has no sold record at all. Re-asking every time
  // would burn the month's plan on exactly the items least likely to answer.
  it('caches a MISS too', async () => {
    globalThis.fetch.mockResolvedValue(ok({ unavailable: true }));
    const id = { identification: { brand: 'Nobrand', name: 'odd trinket' } };

    expect(await getSoldComps(id)).toBeNull();
    expect(await getSoldComps(id)).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('expires after seven days', () => {
    const now = 1_000_000_000_000;
    expect(isFresh({ at: now - TTL_MS + 1000 }, now)).toBe(true);
    expect(isFresh({ at: now - TTL_MS - 1000 }, now)).toBe(false);
    expect(isFresh(undefined, now)).toBe(false);
    expect(isFresh({ at: 'yesterday' }, now)).toBe(false);
  });

  it('spends nothing when there is no query to spend on', async () => {
    expect(await getSoldComps({ identification: { name: 'lamp' } })).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // A scraper that cannot reach eBay is not a fact about the mug in his hand.
  it.each([
    ['the relay is down', () => globalThis.fetch.mockResolvedValue({ ok: false, status: 502 })],
    ['the network is gone', () => globalThis.fetch.mockRejectedValue(new Error('offline'))],
    ['the body is nonsense', () => globalThis.fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } })],
    ['the relay says unavailable', () => globalThis.fetch.mockResolvedValue(ok({ unavailable: true }))],
    ['the count is zero', () => globalThis.fetch.mockResolvedValue(ok({ count: 0, median: 40 }))],
  ])('returns null rather than throwing when %s', async (_label, arrange) => {
    arrange();
    await expect(getSoldComps({ identification: { brand: 'Nike', name: 'Air Force' } }))
      .resolves.toBeNull();
  });

  it('sends the relay bearer, never a SerpApi key', async () => {
    globalThis.fetch.mockResolvedValue(ok(comps()));
    await getSoldComps({ identification: { brand: 'Nike', name: 'Air Force' } });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/serpapi/comps?q=');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(JSON.stringify(globalThis.fetch.mock.calls[0])).not.toMatch(/api_key/);
  });
});

describe('repriceFromComps — sold data takes the wheel', () => {
  // $12 cost, model says $60: clears 3x and $20 net, so BUY.
  const model = () => ({
    estSellPrice: 60, modelEstimate: 60, shipping: 9,
    ...calcProfitFields(60, 12, 9),
    confidence: 'high', source: 'model', comps: null,
  });
  function calcProfitFields(price, gp, ship) {
    const { ebayFee, net } = calcProfit(price, gp, ship);
    return { fees: ebayFee, netProfit: net };
  }

  it('replaces the model price with the sold median and recomputes the money', () => {
    const { next } = repriceFromComps(model(), comps({ median: 45, count: 6 }), 12);
    expect(next.estSellPrice).toBe(45);
    const { ebayFee, net } = calcProfit(45, 12, 9);
    expect(next.fees).toBe(ebayFee);
    expect(next.netProfit).toBe(net);
    expect(next.source).toBe('ebay-sold');
    expect(next.priceRange).toEqual([30, 55]);
  });

  // The entire point of verifiable data: it is allowed to disagree, out loud.
  it('reports a flip when sold data turns a BUY into a LEAVE IT', () => {
    // $12 cost → floor is well above $20, so a $20 median fails both rules.
    const { next, flipped } = repriceFromComps(model(), comps({ median: 20, count: 8 }), 12);
    expect(flipped).toBe(true);
    expect(checkRules(next.estSellPrice, 12, next.netProfit).verdict).toBe('skip');
    expect(next.estSellPrice).toBeLessThan(pencilFloor(12, 9));
  });

  it('reports no flip when the price moves but the verdict does not', () => {
    const { next, flipped } = repriceFromComps(model(), comps({ median: 52, count: 6 }), 12);
    expect(next.estSellPrice).toBe(52);
    expect(flipped).toBe(false);
  });

  // Three is the smallest n with a median worth the name. Below it the model
  // keeps the wheel and the sales become context.
  it.each([[1], [2]])('leaves the model price alone on %i sale(s)', (count) => {
    const before = model();
    const { next, flipped, choice } = repriceFromComps(before, comps({ count }), 12);
    expect(next.estSellPrice).toBe(60);
    expect(next.fees).toBe(before.fees);
    expect(next.source).toBe('model');
    expect(flipped).toBe(false);
    expect(choice.thin).toBe(true);
    // Still attached, so the Why sheet can show it as thin data.
    expect(next.soldComps.count).toBe(count);
  });

  it('preserves the model\'s own estimate for the receipt', () => {
    const { next } = repriceFromComps(model(), comps({ median: 45, count: 6 }), 12);
    expect(next.modelEstimate).toBe(60);
    expect(next.estSellPrice).toBe(45);
  });

  it('fills the cart\'s sold-count pill, which was null through all of V1', () => {
    const { next } = repriceFromComps(model(), comps({ count: 7 }), 12);
    expect(next.soldCount).toBe(7);
  });

  it('changes nothing at all when there are no comps', () => {
    const before = model();
    const { next, flipped } = repriceFromComps(before, null, 12);
    expect(next.estSellPrice).toBe(before.estSellPrice);
    expect(next.soldComps).toBeNull();
    expect(flipped).toBe(false);
  });
});
