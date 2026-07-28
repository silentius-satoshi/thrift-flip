// W1's Re-check: "The box is a but rough." arrives after a verdict is already on
// screen, and he expects a Revised Verdict rather than a conversation. The app
// answers that with a *second analyze* over the same photos — so what these
// specs pin is that the second call is a real, independent analysis carrying the
// new information, not a cached first one wearing a new label.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { primeSession, __testSeam } = await import('./credentials');
const { analyzeItem } = await import('./ai');
const { DEFAULT_SHIPPING } = await import('../config/gemini');

const KEY = 'AIzaSyDUMMY-key-000000000000000000';
const PHOTOS = { photoBase64s: ['AAAA', 'BBBB'], mimeTypes: ['image/jpeg', 'image/png'] };

const analysis = (over = {}) => ({
  identification: { name: 'Pendleton blanket', brand: 'Pendleton', confidence: 'high' },
  condition_read: { grade: 'Good', visible_flaws: [] },
  listing: {
    title: 'Pendleton Beaver State Wool Blanket',
    description_html: '<p>x</p>',
    item_specifics: { Brand: 'Pendleton' },
    condition_description: 'ok',
  },
  listing_mercari: { title: 'a', description: 'd', hashtags: ['#v'], suggested_price: 79 },
  pricing: {
    estimate: 94.5, range_low: 80, range_high: 110,
    confidence: 'medium', rationale: 'comparable sales', shipping_estimate: 9,
  },
  strategy: { note: 'n' },
  ...over,
});

// Answers each request from a queue, recording what was actually sent.
function gemini(queue) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const next = queue[Math.min(calls.length - 1, queue.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(next) }] } }] }),
    };
  };
  return calls;
}

const textOf = (body) => body.contents[0].parts.at(-1).text;

beforeEach(async () => {
  store.clear();
  vi.unstubAllEnvs();
  await __testSeam.resetAll();
  primeSession('ai-key', KEY);
});

describe('a re-check is a second analyze, not a replay', () => {
  it('sends the new notes and condition, and the same photos', async () => {
    const calls = gemini([analysis()]);

    await analyzeItem({ ...PHOTOS, details: 'wool blanket', condition: 'Good', goodwillPrice: 8 });
    await analyzeItem({ ...PHOTOS, details: 'wool blanket, the box is a bit rough', condition: 'Fair', goodwillPrice: 8 });

    expect(calls).toHaveLength(2);
    expect(textOf(calls[0])).toContain('wool blanket');
    expect(textOf(calls[0])).not.toContain('box is a bit rough');
    expect(textOf(calls[1])).toContain('box is a bit rough');
    expect(textOf(calls[1])).toContain('Fair');

    // The frames are what make it the same item. Both requests carry both.
    for (const body of calls) {
      const inline = body.contents[0].parts.filter((p) => p.inline_data);
      expect(inline.map((p) => p.inline_data.data)).toEqual(['AAAA', 'BBBB']);
    }
  });

  it('returns a second, independently adapted result', async () => {
    gemini([
      analysis(),
      analysis({ pricing: { estimate: 40, range_low: 30, range_high: 50, confidence: 'low', rationale: 'damaged box', shipping_estimate: 9 } }),
    ]);

    const first = await analyzeItem({ ...PHOTOS, details: 'wool blanket', condition: 'Good', goodwillPrice: 8 });
    const revised = await analyzeItem({ ...PHOTOS, details: 'wool blanket, box rough', condition: 'Fair', goodwillPrice: 8 });

    // Same shape — whatever renders the first verdict renders the second.
    expect(Object.keys(revised).sort()).toEqual(Object.keys(first).sort());

    // Different answer, arithmetic redone rather than carried over.
    expect(first.estSellPrice).toBe(94.5);
    expect(revised.estSellPrice).toBe(40);
    expect(revised.fees).toBe(5.6);              // 40 * 0.1325 + 0.30
    expect(revised.netProfit).toBe(17.4);        // 40 - 5.60 - 9 - 8
    expect(revised.confidence).toBe('low');
    expect(revised.rationale).toBe('damaged box');
  });

  // The revision is the moment a BUY is supposed to be able to become a LEAVE IT.
  it('can turn a passing item into a failing one', async () => {
    const { checkRules } = await import('./calculations');
    gemini([
      analysis(),
      analysis({ pricing: { estimate: 40, range_low: 30, range_high: 50, confidence: 'low', rationale: 'r', shipping_estimate: 9 } }),
    ]);

    const first = await analyzeItem({ ...PHOTOS, details: 'blanket', condition: 'Good', goodwillPrice: 8 });
    const revised = await analyzeItem({ ...PHOTOS, details: 'blanket, box rough', condition: 'Fair', goodwillPrice: 8 });

    expect(checkRules(first.estSellPrice, 8, first.netProfit).verdict).toBe('buy');
    expect(checkRules(revised.estSellPrice, 8, revised.netProfit).verdict).toBe('skip');
  });

  it('carries its own fresh teaser rather than the first one', async () => {
    gemini([
      analysis(),
      analysis({ pricing: { estimate: 40, range_low: 30, range_high: 50, confidence: 'low', rationale: 'the damage shows', shipping_estimate: 9 } }),
    ]);

    const first = await analyzeItem({ ...PHOTOS, details: 'blanket', condition: 'Good', goodwillPrice: 8 });
    const revised = await analyzeItem({ ...PHOTOS, details: 'blanket, rough', condition: 'Fair', goodwillPrice: 8 });

    expect(first.chatHistory[0].text).toBe('comparable sales');
    expect(revised.chatHistory[0].text).toBe('the damage shows');
  });

  it('re-estimates shipping on the revision too, still clamped', async () => {
    gemini([
      analysis(),
      analysis({ pricing: { estimate: 94.5, range_low: 80, range_high: 110, confidence: 'medium', rationale: 'r', shipping_estimate: 400 } }),
    ]);

    await analyzeItem({ ...PHOTOS, details: 'blanket', condition: 'Good', goodwillPrice: 8 });
    const revised = await analyzeItem({ ...PHOTOS, details: 'blanket, huge box', condition: 'Good', goodwillPrice: 8 });

    expect(revised.shipping).toBe(100);
    expect(revised.shippingFromModel).toBe(true);
  });

  it('falls back to the house shipping figure when a revision omits one', async () => {
    gemini([analysis({ pricing: { estimate: 94.5, range_low: 80, range_high: 110, confidence: 'medium', rationale: 'r' } })]);

    const result = await analyzeItem({ ...PHOTOS, details: 'blanket', condition: 'Good', goodwillPrice: 8 });
    expect(result.shipping).toBe(DEFAULT_SHIPPING);
    expect(result.shippingFromModel).toBe(false);
  });
});
