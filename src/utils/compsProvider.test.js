// Comps tier 0 — Dad's own completed sales.
//
// The threshold tests are the point of this file. A miss costs nothing: the
// verdict falls back to the model's own read, which is where it has been since
// V1. A FALSE match tells him a $12 lamp is worth $95 because he once sold a
// different lamp, and he buys it with real money.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { tokenize, scoreMatch, getComps, buildCompsBlock, pickComps, MIN_SOLD_FOR_PRICING }
  = await import('./compsProvider');
const { primeSession, __testSeam } = await import('./credentials');
const { buildUserMessage, analyzeItem } = await import('./ai');

const DAY = 24 * 60 * 60 * 1000;
const SKU = '1730000000000';

function seed({ title = 'Pendleton Beaver State Wool Blanket Twin', sales } = {}) {
  store.set('thrift-flip-history', JSON.stringify([{
    id: 1, sku: SKU, title, price: 94.5, goodwillPrice: 8, shipping: 12,
    sentAt: Date.now() - 30 * DAY, liveAt: Date.now() - 28 * DAY,
  }]));
  store.set('thrift-flip-sold-history', JSON.stringify({
    [SKU]: sales ?? [{
      orderId: 'O-1', soldAt: Date.now() - 14 * DAY, soldPrice: 94.5, marketplaceFee: 12.82,
    }],
  }));
}

beforeEach(async () => {
  store.clear();
  vi.unstubAllEnvs();
  await __testSeam.resetAll();
});

describe('tokenize', () => {
  it('drops the words that appear in half of all thrift listings', () => {
    expect(tokenize('Vintage Rare Mens Wool Blanket EUC')).toEqual(['wool', 'blanket']);
  });

  it('drops bare numbers and punctuation', () => {
    expect(tokenize('Pendleton 64x80 — Twin!')).toEqual(['pendleton', '64x80', 'twin']);
  });

  it('is duplicate-free', () => {
    expect(tokenize('blanket blanket blanket')).toEqual(['blanket']);
  });
});

describe('the threshold', () => {
  const query = tokenize('Pendleton wool blanket');

  it('matches the same item described differently', () => {
    expect(scoreMatch(query, 'Pendleton Beaver State Wool Blanket Twin').matched).toBe(true);
  });

  it('refuses a single shared word', () => {
    // "blanket" alone is not evidence: an electric blanket and a wool blanket
    // are not comparable sales.
    expect(scoreMatch(query, 'Sunbeam Electric Blanket Queen').matched).toBe(false);
  });

  it('refuses a near-miss that shares a brand but nothing else', () => {
    expect(scoreMatch(query, 'Pendleton Board Shirt Medium').matched).toBe(false);
  });

  it('refuses an unrelated item outright', () => {
    expect(scoreMatch(query, 'Nike Air Max 90 Sneakers').matched).toBe(false);
  });
});

describe('getComps', () => {
  it('returns the sale, its net and how long it took', () => {
    seed();
    const comps = getComps({ brand: 'Pendleton', name: 'wool blanket' });
    expect(comps.source).toBe('own-sales');
    expect(comps.samples).toHaveLength(1);
    expect(comps.samples[0]).toMatchObject({ price: 94.5, daysToSell: 14, approxDays: false });
    expect(comps.samples[0].net).toBeCloseTo(61.68, 2);
    expect(comps.median).toBe(94.5);
  });

  it('returns null on an empty store, not an empty finding', () => {
    expect(getComps({ brand: 'Pendleton', name: 'wool blanket' })).toBeNull();
  });

  it('returns null when nothing sold is comparable', () => {
    seed({ title: 'Nike Air Max 90 Sneakers Size 10' });
    expect(getComps({ brand: 'Pendleton', name: 'wool blanket' })).toBeNull();
  });

  it('returns null when the query is too thin to match on', () => {
    seed();
    // One usable token cannot clear a two-token minimum, and should not.
    expect(getComps({ name: 'blanket' })).toBeNull();
    expect(getComps({})).toBeNull();
  });

  it('takes the median of several sales and orders them newest first', () => {
    seed({
      sales: [
        { orderId: 'A', soldAt: Date.now() - 40 * DAY, soldPrice: 80, marketplaceFee: 10 },
        { orderId: 'B', soldAt: Date.now() - 10 * DAY, soldPrice: 100, marketplaceFee: 13 },
        { orderId: 'C', soldAt: Date.now() - 20 * DAY, soldPrice: 90, marketplaceFee: 12 },
      ],
    });
    const comps = getComps({ brand: 'Pendleton', name: 'wool blanket' });
    expect(comps.median).toBe(90);
    expect(comps.samples.map(s => s.price)).toEqual([100, 90, 80]);
  });
});

describe('buildCompsBlock', () => {
  it('says whose results these are, in plain language', () => {
    seed();
    const block = buildCompsBlock(getComps({ brand: 'Pendleton', name: 'wool blanket' }));
    expect(block).toContain('The seller previously sold similar items');
    expect(block).toContain('$94.50');
    expect(block).toContain('in 14 days');
    expect(block).toContain("the seller's own results");
  });

  it('is null when there is nothing to say', () => {
    expect(buildCompsBlock(null)).toBeNull();
    expect(buildCompsBlock({ samples: [] })).toBeNull();
  });

  it('caps at three so the message stays a message', () => {
    seed({
      sales: Array.from({ length: 6 }, (_, i) => ({
        orderId: `O-${i}`, soldAt: Date.now() - i * DAY, soldPrice: 90 + i, marketplaceFee: 12,
      })),
    });
    const block = buildCompsBlock(getComps({ brand: 'Pendleton', name: 'wool blanket' }));
    expect(block.split('\n').filter(l => l.startsWith('- '))).toHaveLength(3);
  });
});

describe('injection into the analyze request', () => {
  it('leaves the message untouched when there are no comps', () => {
    const msg = buildUserMessage({ details: 'wool blanket', condition: 'Good', goodwillPrice: 8 });
    expect(msg).not.toContain('previously sold');
    expect(msg.split('\n')).toHaveLength(2); // notes + condition; the price line went at D1
  });

  it('appends the block last, and never sends the purchase price', () => {
    const msg = buildUserMessage({
      details: 'wool blanket', condition: 'Good', goodwillPrice: 8,
      compsBlock: 'The seller previously sold similar items:\n- "x" sold for $94.50',
    });
    // This assertion used to prove the anchoring line survived comps injection.
    // The anchoring test failed on 2026-07-28 (57.1% drift) and that line is
    // gone, so it now guards the opposite: the purchase price must never reach
    // the model again, by this route or any other.
    expect(msg).not.toContain('Goodwill price');
    expect(msg).not.toContain('$8.00');
    // Comps are SOLD data — vision §5 says to weight them, and they still ride
    // last, below the condition line.
    expect(msg.indexOf('Condition as I see it')).toBeLessThan(msg.indexOf('previously sold'));
  });

  it('rides the real request when a matching sale exists', async () => {
    seed();
    primeSession('ai-key', 'AIzaSyDUMMY');
    const sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push(JSON.parse(init.body));
      return {
        ok: true, status: 200,
        json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{
          text: JSON.stringify({ pricing: { estimate: 94.5, confidence: 'high', rationale: 'r' } }),
        }] } }] }),
      };
    };

    const result = await analyzeItem({ details: 'Pendleton wool blanket', condition: 'Good', goodwillPrice: 8 });
    const text = sent[0].contents[0].parts.at(-1).text;
    expect(text).toContain('previously sold similar items');
    // The verdict can say "via your own sales" exactly when it is true.
    expect(result.compsSource).toBe('own-sales');
    expect(result.comps.samples).toHaveLength(1);
  });

  it('sends no block and claims no source when nothing matches', async () => {
    seed({ title: 'Nike Air Max 90 Sneakers' });
    primeSession('ai-key', 'AIzaSyDUMMY');
    const sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push(JSON.parse(init.body));
      return {
        ok: true, status: 200,
        json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{
          text: JSON.stringify({ pricing: { estimate: 40, confidence: 'low', rationale: 'r' } }),
        }] } }] }),
      };
    };

    const result = await analyzeItem({ details: 'Pendleton wool blanket', condition: 'Good', goodwillPrice: 8 });
    expect(sent[0].contents[0].parts.at(-1).text).not.toContain('previously sold');
    expect(result.compsSource).toBeNull();
    expect(result.comps).toBeNull();
  });
});

// ── The ladder's precedence (V2) ────────────────────────────────────────────
describe('pickComps — tier A over tier 0 over the model', () => {
  const sold = (over = {}) => ({ median: 40, low: 30, high: 55, count: 6, ...over });
  const own = (n = 2) => ({
    source: 'own-sales',
    median: 88,
    samples: Array.from({ length: n }, (_, i) => ({ title: 't', price: 88, soldAt: i })),
  });

  it('puts eBay sold data at the top and lets it price the item', () => {
    const choice = pickComps({ sold: sold(), own: own() });
    expect(choice.source).toBe('ebay-sold');
    expect(choice.pricesTheItem).toBe(true);
    expect(choice.median).toBe(40);
  });

  // The reason tier 0 does not re-price, spelled out as a test so nobody
  // "fixes" it later: buildCompsBlock already injected these sales into the
  // analyze request, so the model's estimate has SEEN them. Overriding the
  // estimate with the same numbers would count them twice and call it
  // corroboration.
  it('ranks his own sales above the model but never lets them re-price', () => {
    const choice = pickComps({ sold: null, own: own() });
    expect(choice.source).toBe('own-sales');
    expect(choice.pricesTheItem).toBe(false);
  });

  it('falls through to the model when neither tier has anything', () => {
    expect(pickComps({ sold: null, own: null }))
      .toEqual({ source: null, pricesTheItem: false, median: null, count: 0, thin: false });
    expect(pickComps()).toEqual(pickComps({ sold: null, own: null }));
  });

  it.each([[0], [1], [2]])('calls %i sold thin, so the model keeps the wheel', (count) => {
    const choice = pickComps({ sold: sold({ count }), own: null });
    if (count === 0) {
      expect(choice.source).toBeNull();
    } else {
      expect(choice.source).toBe('ebay-sold');
      expect(choice.thin).toBe(true);
    }
    expect(choice.pricesTheItem).toBe(false);
  });

  it('prices from exactly the documented threshold upward', () => {
    expect(MIN_SOLD_FOR_PRICING).toBe(3);
    expect(pickComps({ sold: sold({ count: 3 }) }).pricesTheItem).toBe(true);
    expect(pickComps({ sold: sold({ count: 2 }) }).pricesTheItem).toBe(false);
  });

  // A count with no median is a shape the relay should never emit — but the
  // relay is across a network boundary, and money moves on this answer.
  it.each([
    ['the median is missing', { count: 9 }],
    ['the median is null', { count: 9, median: null }],
    ['the median is NaN', { count: 9, median: NaN }],
    ['the payload says unavailable', { unavailable: true }],
  ])('refuses to price when %s', (_label, payload) => {
    expect(pickComps({ sold: payload, own: null }).pricesTheItem).toBe(false);
  });
});

// ── The query builder's split from the matcher (V2) ─────────────────────────
describe('queryTokens vs tokenize', () => {
  it('keeps the model number that the matcher deliberately drops', async () => {
    const { queryTokens } = await import('./compsProvider');
    expect(tokenize('Sony Walkman WM-10')).toEqual(['sony', 'walkman']);
    expect(queryTokens('Sony Walkman WM-10')).toEqual(['sony', 'walkman', 'wm-10']);
  });

  it('still strips the stopwords both share', async () => {
    const { queryTokens } = await import('./compsProvider');
    expect(queryTokens('vintage used Pyrex bowl')).toEqual(['pyrex', 'bowl']);
  });
});
