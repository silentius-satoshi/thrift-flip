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

const { tokenize, scoreMatch, getComps, buildCompsBlock } = await import('./compsProvider');
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
    expect(msg.split('\n')).toHaveLength(3);
  });

  it('appends the block below the anchoring line, not in place of it', () => {
    const msg = buildUserMessage({
      details: 'wool blanket', condition: 'Good', goodwillPrice: 8,
      compsBlock: 'The seller previously sold similar items:\n- "x" sold for $94.50',
    });
    // The anchoring line is the one the calibration test deletes; comps must
    // not disturb it. This is SOLD data, which vision §5 says to weight — not
    // the purchase price the anchoring rule guards against.
    expect(msg).toContain('Goodwill price: $8.00');
    expect(msg.indexOf('Goodwill price')).toBeLessThan(msg.indexOf('previously sold'));
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
