// The three calls that stopped being mocks at V3. The assertion that matters
// most is the contents ordering: Gemini has no session, so if the photos are
// not on the wire the model is answering blind — and it will still sound sure.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { primeSession, __testSeam } = await import('./credentials');
const photoStore = await import('./photoStore');
const {
  buildChatContents, sendChatMessage, generateListing, regenerateField, __regenOps,
} = await import('./ai');
const { CHAT_PROMPT, SYSTEM_PROMPT } = await import('../config/prompt');

const KEY = 'AIzaSyDUMMY-key-000000000000000000';
const ITEM = 1730000000000;
const PHOTOS = [
  { base64: 'AAAA', mimeType: 'image/jpeg' },
  { base64: 'BBBB', mimeType: 'image/png' },
];

function gemini(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const r = typeof responder === 'function' ? responder(body, calls) : responder;
    if (r?.status && r.status >= 400) {
      return { ok: false, status: r.status, json: async () => ({}), text: async () => '{}' };
    }
    return { ok: true, status: 200, json: async () => r.body };
  };
  return calls;
}

const prose = (text) => ({
  body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] },
});
const structured = (obj) => prose(JSON.stringify(obj));

const ANALYSIS = {
  identification: { name: 'Pendleton blanket', brand: 'Pendleton', confidence: 'high' },
  condition_read: { grade: 'Good', notes: 'light pilling' },
  listing: {
    title: 'Pendleton Beaver State Wool Blanket Southwest Vintage',
    description_html: '<p>Vintage Pendleton wool blanket.</p><p>Clean, no odors.</p>',
    item_specifics: { Brand: 'Pendleton', Size: 'Twin', MPN: '' },
    condition_description: 'Light pilling on one corner',
  },
  listing_mercari: { title: 'pendleton blanket', description: 'd', hashtags: ['#a'], suggested_price: 79 },
  pricing: { estimate: 94.5, range_low: 80, range_high: 110, confidence: 'medium', rationale: 'r' },
  strategy: { note: 'n' },
};

beforeEach(async () => {
  store.clear();
  vi.unstubAllEnvs();
  await __testSeam.resetAll();
  await photoStore.remove(ITEM);
  await photoStore.remove(photoStore.IN_FLIGHT);
  primeSession('ai-key', KEY);
});

describe('buildChatContents', () => {
  const base = { message: 'is that a stain on the cuff?', itemContext: { details: 'wool blanket', condition: 'Good', goodwillPrice: 8 } };

  it('puts every photo on the first turn, before the text', () => {
    const contents = buildChatContents({ ...base, photos: PHOTOS, chatHistory: [{ role: 'ai', text: 'teaser' }] });
    const first = contents[0];
    expect(first.role).toBe('user');
    expect(first.parts[0].inline_data).toEqual({ mime_type: 'image/jpeg', data: 'AAAA' });
    expect(first.parts[1].inline_data).toEqual({ mime_type: 'image/png', data: 'BBBB' });
    expect(first.parts[2].text).toContain('wool blanket');
  });

  it('never opens with a model turn', () => {
    // The stored history begins with the analysis teaser, which is a model
    // turn. Gemini rejects contents that start with one.
    const contents = buildChatContents({ ...base, photos: PHOTOS, chatHistory: [{ role: 'ai', text: 'teaser' }] });
    expect(contents[0].role).toBe('user');
  });

  it('maps roles and preserves the order of the exchange', () => {
    const contents = buildChatContents({
      ...base,
      photos: PHOTOS,
      chatHistory: [
        { role: 'ai', text: 'teaser' },
        { role: 'user', text: 'what is it worth?' },
        { role: 'ai', text: 'about ninety' },
      ],
    });
    expect(contents.map(c => c.role)).toEqual(['user', 'model', 'user', 'model', 'user']);
    expect(contents.at(-1).parts[0].text).toBe(base.message);
    expect(contents[2].parts[0].text).toBe('what is it worth?');
  });

  it('sends photos exactly once, not on every turn of the history', () => {
    const contents = buildChatContents({
      ...base, photos: PHOTOS,
      chatHistory: [{ role: 'ai', text: 'a' }, { role: 'user', text: 'b' }],
    });
    const withPhotos = contents.filter(c => c.parts.some(p => p.inline_data));
    expect(withPhotos).toHaveLength(1);
    // ...but that once is per REQUEST, which is what "in context across the
    // conversation" means with no server-side session.
    expect(contents[0].parts.filter(p => p.inline_data)).toHaveLength(2);
  });

  it('folds the question into the opening turn when there is no history', () => {
    // Two consecutive user turns would otherwise open the conversation.
    const contents = buildChatContents({ ...base, photos: PHOTOS, chatHistory: [] });
    expect(contents).toHaveLength(1);
    expect(contents[0].parts.at(-1).text).toBe(base.message);
  });

  it('goes text-only when there are no photos', () => {
    const contents = buildChatContents({ ...base, photos: [], chatHistory: [] });
    expect(contents[0].parts.some(p => p.inline_data)).toBe(false);
    expect(contents[0].parts[0].text).toContain('wool blanket');
  });

  it('drops empty history turns rather than sending blank parts', () => {
    const contents = buildChatContents({
      ...base, photos: [], chatHistory: [{ role: 'ai', text: '' }, { role: 'user', text: 'real' }],
    });
    expect(contents.map(c => c.parts[0].text)).not.toContain('');
  });
});

describe('sendChatMessage', () => {
  it('attaches the item’s stored photos and uses the chat prompt', async () => {
    await photoStore.put(ITEM, PHOTOS);
    const calls = gemini(prose('That looks like pilling, not a stain.'));

    const res = await sendChatMessage({ itemId: ITEM, message: 'stain?', chatHistory: [], itemContext: {} });

    expect(res.text).toBe('That looks like pilling, not a stain.');
    const body = calls[0].body;
    expect(body.systemInstruction.parts[0].text).toBe(CHAT_PROMPT);
    expect(body.contents[0].parts.filter(p => p.inline_data)).toHaveLength(2);
    // Prose, not structured output — a schema here would produce JSON in a bubble.
    expect(body.generationConfig.responseSchema).toBeUndefined();
    expect(body.generationConfig.maxOutputTokens).toBe(500);
  });

  it('degrades to text-only for a conversation from before V3', async () => {
    const calls = gemini(prose('answer'));
    await sendChatMessage({ itemId: 999, message: 'q', chatHistory: [], itemContext: {} });
    expect(calls[0].body.contents[0].parts.some(p => p.inline_data)).toBe(false);
  });

  it('refuses without a key rather than calling out', async () => {
    await __testSeam.resetAll();
    const calls = gemini(prose('x'));
    await expect(sendChatMessage({ itemId: ITEM, message: 'q' })).rejects.toMatchObject({ code: 'no-key' });
    expect(calls).toHaveLength(0);
  });

  it('maps a 429 to the quota code the UI has copy for', async () => {
    gemini({ status: 429 });
    await expect(sendChatMessage({ itemId: ITEM, message: 'q' })).rejects.toMatchObject({ code: 'quota' });
  });

  it('treats an empty answer as a bad response, not as silence', async () => {
    gemini(prose('   '));
    await expect(sendChatMessage({ itemId: ITEM, message: 'q' })).rejects.toMatchObject({ code: 'bad-response' });
  });
});

describe('generateListing', () => {
  const PENCIL = {
    id: ITEM, name: 'wool blanket', condition: 'Good',
    goodwillPrice: 8, shipping: 12,
    estSellPrice: 46.5, // a pencil item's estSellPrice IS the floor
  };

  it('runs a real analysis on the item’s photos and seeds the editor', async () => {
    await photoStore.put(ITEM, PHOTOS);
    const calls = gemini(structured(ANALYSIS));

    const seed = await generateListing(PENCIL);

    expect(calls[0].body.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT);
    expect(calls[0].body.contents[0].parts.filter(p => p.inline_data)).toHaveLength(2);
    expect(seed.title).toBe(ANALYSIS.listing.title);
    expect(seed.specifics).toEqual(ANALYSIS.listing.item_specifics);
    expect(seed.conditionDescription).toBe('Light pilling on one corner');
    expect(seed.listingMercari).toEqual(ANALYSIS.listing_mercari);
  });

  it('seeds the MODEL’s price and carries the floor separately', async () => {
    gemini(structured(ANALYSIS));
    const seed = await generateListing(PENCIL);
    // The floor governed the buy; the market governs the listing.
    expect(seed.price).toBe(94.5);
    expect(seed.pencilFloor).toBe(46.5);
  });

  it('does NOT clamp an estimate that lands below the floor', async () => {
    // A below-floor estimate means the buy did not work out, and the editor's
    // rule checks are where that shows. Hiding it behind max() would hide the
    // one piece of bad news worth having.
    gemini(structured({ ...ANALYSIS, pricing: { ...ANALYSIS.pricing, estimate: 31 } }));
    const seed = await generateListing(PENCIL);
    expect(seed.price).toBe(31);
    expect(seed.pencilFloor).toBe(46.5);
  });

  it('strips the description HTML the editor cannot render', async () => {
    gemini(structured(ANALYSIS));
    const seed = await generateListing(PENCIL);
    expect(seed.description).not.toContain('<p>');
    expect(seed.description).toContain('Vintage Pendleton wool blanket');
  });

  it('emits none of the mock’s filler', async () => {
    gemini(structured(ANALYSIS));
    const seed = await generateListing(PENCIL);
    const dump = JSON.stringify(seed);
    // prompt.js tells the model explicitly not to write these; the mock wrote
    // them anyway, every time.
    for (const filler of ['See description', 'Does Not Apply', 'See photos', 'As pictured', 'See label']) {
      expect(dump).not.toContain(filler);
    }
  });

  it('works with no stored photos, on notes alone', async () => {
    const calls = gemini(structured(ANALYSIS));
    const seed = await generateListing({ ...PENCIL, id: 555 });
    expect(calls[0].body.contents[0].parts.some(p => p.inline_data)).toBe(false);
    expect(seed.title).toBe(ANALYSIS.listing.title);
  });

  it('propagates the no-key code so the editor can stay hand-usable', async () => {
    await __testSeam.resetAll();
    gemini(structured(ANALYSIS));
    await expect(generateListing(PENCIL)).rejects.toMatchObject({ code: 'no-key' });
  });
});

describe('regenerateField', () => {
  it('has an instruction for every op the editor can fire', () => {
    expect(Object.keys(__regenOps).sort()).toEqual([
      'description-longer', 'description-rewrite', 'description-shorter', 'title',
    ]);
  });

  it('sends the op’s instruction, the context and the current text', async () => {
    const calls = gemini(prose('Pendleton Wool Blanket Twin Southwest Vintage'));
    const res = await regenerateField({ field: 'title', currentValue: 'blanket', context: 'wool blanket' });

    expect(res.value).toBe('Pendleton Wool Blanket Twin Southwest Vintage');
    const sent = calls[0].body.contents[0].parts[0].text;
    expect(sent).toContain('80 characters or fewer');
    expect(sent).toContain('wool blanket');
    expect(sent).toContain('blanket');
    expect(calls[0].body.generationConfig.maxOutputTokens).toBe(300);
  });

  it('asks for shortening and lengthening differently', async () => {
    let sent = [];
    gemini((body) => { sent.push(body.contents[0].parts[0].text); return prose('x'); });
    await regenerateField({ field: 'description-shorter', currentValue: 'long text' });
    await regenerateField({ field: 'description-longer', currentValue: 'short' });
    expect(sent[0]).toContain('Shorten');
    expect(sent[1]).toContain('Expand');
    // The longer op must not invite invention — a made-up measurement is a return.
    expect(sent[1]).toContain('invent nothing');
  });

  it('refuses an unknown field rather than guessing', async () => {
    const calls = gemini(prose('x'));
    await expect(regenerateField({ field: 'price-but-cheaper', currentValue: '1' }))
      .rejects.toMatchObject({ code: 'bad-request' });
    expect(calls).toHaveLength(0);
  });

  it('trims the model’s answer so it drops straight into the field', async () => {
    gemini(prose('\n  A Clean Title  \n'));
    expect((await regenerateField({ field: 'title', currentValue: 'x' })).value).toBe('A Clean Title');
  });
});
