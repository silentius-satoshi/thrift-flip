// The manual sold rails.
//
// These are the last mile of the pricing story: V2's automated tier A is dark,
// so the only sold data Dad will actually see is the data one of these rails
// puts in front of him. A rail that searches for the wrong thing, or silently
// fails to copy, sends him to another app to price an item off nothing.
// `globalThis.navigator` is getter-only on modern Node, so every global here
// goes through vi.stubGlobal rather than assignment.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  researchQuery, soldSearchUrl, productResearchUrl, copyText, RESEARCH_STEPS,
} from './researchRails';

describe('researchQuery', () => {
  it('normalizes the model\'s read the way the comps lookup does', () => {
    expect(researchQuery({ identification: { brand: 'Pendleton', name: 'wool blanket' } }))
      .toBe('pendleton wool blanket');
  });

  it('keeps the model number, which is the whole point of a sold search', () => {
    expect(researchQuery({ identification: { brand: 'Sony', name: 'Walkman WM-10' } }))
      .toBe('sony walkman wm-10');
    expect(researchQuery({ identification: { brand: 'Nike', name: 'Air Force 1' } }))
      .toBe('nike air force 1');
  });

  it('strips the thrift filler that matches half of eBay', () => {
    const q = researchQuery({ identification: { brand: 'Pyrex', name: 'vintage used bowl' } });
    expect(q).not.toContain('vintage');
    expect(q).not.toContain('used');
    expect(q).toContain('pyrex');
  });

  it('falls back to the listing title when identification is too thin', () => {
    expect(researchQuery({ identification: { name: 'lamp' }, listingTitle: 'Brass Table Lamp' }))
      .toBe('Brass Table Lamp');
  });

  // A pencil item was never analyzed, so his own note is the best — and only —
  // description of the thing in his hand.
  it('falls back to his own note when there is no listing either', () => {
    expect(researchQuery({ note: 'weird brass lamp' })).toBe('weird brass lamp');
  });

  it('prefers the normalized read over both fallbacks when it has one', () => {
    expect(researchQuery({
      identification: { brand: 'Pendleton', name: 'wool blanket' },
      listingTitle: 'Some Other Title Entirely',
      note: 'and another',
    })).toBe('pendleton wool blanket');
  });

  it.each([
    ['nothing at all', {}],
    ['empty strings', { identification: {}, listingTitle: '', note: '' }],
    ['undefined', undefined],
    ['whitespace only', { note: '   ' }],
  ])('returns empty for %s rather than a URL that searches for nothing', (_label, input) => {
    expect(researchQuery(input)).toBe('');
  });
});

describe('the URLs', () => {
  it('asks eBay for sold AND completed, which is the whole filter', () => {
    const url = soldSearchUrl('pyrex bowl');
    expect(url).toContain('LH_Sold=1');
    expect(url).toContain('LH_Complete=1');
    expect(url).toContain('_nkw=pyrex%20bowl');
  });

  it('points Product Research at its keywords parameter', () => {
    expect(productResearchUrl('pyrex bowl'))
      .toBe('https://www.ebay.com/sh/research?keywords=pyrex%20bowl');
  });

  // A title carrying an ampersand would otherwise truncate the query and search
  // for half the item; a `#` would drop it entirely into a fragment.
  it.each([
    ['an ampersand', 'salt & pepper', '%26'],
    ['a hash', 'model #42 lamp', '%2342'],
    ['a plus', 'a+b speakers', '%2B'],
    // An apostrophe is left literal by encodeURIComponent and is harmless in a
    // query VALUE — it survives to eBay as typed, which is what we want.
    ['a quote', 'levi\'s 501', 'levi\'s%20501'],
    ['non-ASCII', 'café press mug', 'caf%C3%A9'],
    ['a slash', 'am/fm radio', '%2F'],
    ['a question mark', 'what is it? lamp', '%3F'],
  ])('encodes %s in both URLs', (_label, query, encoded) => {
    expect(soldSearchUrl(query)).toContain(encoded);
    expect(productResearchUrl(query)).toContain(encoded);
    // And the query cannot escape into the URL's own parameter structure.
    expect(soldSearchUrl(query).split('?')[1].split('&').length).toBe(3);
    expect(productResearchUrl(query).split('?')[1].split('&').length).toBe(1);
  });

  // The reason both rails share one builder: two adjacent buttons must never
  // describe two different items.
  it('sends the identical string to the search, the research page and the clipboard', async () => {
    const written = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t) => { written.push(t); } } });
    const item = { identification: { brand: 'Pendleton', name: 'wool blanket' } };
    const q = researchQuery(item);

    await copyText(q);
    expect(written[0]).toBe(q);
    expect(soldSearchUrl(q)).toContain(encodeURIComponent(q));
    expect(productResearchUrl(q)).toContain(encodeURIComponent(q));
    vi.unstubAllGlobals();
  });
});

describe('copyText', () => {
  let execResult;
  let appended;
  let doc;

  beforeEach(() => {
    execResult = true;
    appended = [];
    const el = () => ({
      value: '', style: {}, setAttribute: vi.fn(), select: vi.fn(),
    });
    doc = {
      createElement: vi.fn(el),
      execCommand: vi.fn(() => execResult),
      body: {
        appendChild: vi.fn((n) => appended.push(n)),
        removeChild: vi.fn((n) => { appended = appended.filter((x) => x !== n); }),
      },
    };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses the modern clipboard API when it is there', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('pyrex bowl')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('pyrex bowl');
    expect(doc.execCommand).not.toHaveBeenCalled();
  });

  // navigator.clipboard is undefined outside a secure context — which includes
  // a phone reaching a dev server over plain http on the LAN, exactly how this
  // gets demonstrated before it is ever deployed.
  it('falls back to execCommand when there is no clipboard API at all', async () => {
    expect(await copyText('pyrex bowl')).toBe(true);
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back when the clipboard API rejects — a lost gesture or a policy', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
    expect(await copyText('pyrex bowl')).toBe(true);
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
  });

  // The failure has to be reported, not swallowed. A silent miss sends him to
  // the eBay app to paste whatever he happened to copy last.
  it('reports failure when both routes fail', async () => {
    execResult = false;
    expect(await copyText('pyrex bowl')).toBe(false);
  });

  it('reports failure rather than throwing when the DOM route explodes', async () => {
    doc.createElement = () => { throw new Error('no dom'); };
    await expect(copyText('pyrex bowl')).resolves.toBe(false);
  });

  it('cleans up the textarea it borrowed, on success and on failure', async () => {
    await copyText('pyrex bowl');
    expect(appended).toHaveLength(0);
    execResult = false;
    await copyText('pyrex bowl');
    expect(appended).toHaveLength(0);
  });

  it.each([['empty', ''], ['null', null], ['undefined', undefined]])(
    'refuses to copy %s rather than clearing his clipboard', async (_label, value) => {
      expect(await copyText(value)).toBe(false);
      expect(doc.execCommand).not.toHaveBeenCalled();
    });
});

describe('the coach mark', () => {
  // The four steps are the whole value of the rail — there is no deep link, so
  // this text IS the navigation. It is exported so both screens and this test
  // quote one string instead of three that drift.
  it('names every step his thumb has to perform, in order', () => {
    expect(RESEARCH_STEPS).toContain('eBay app');
    expect(RESEARCH_STEPS).toContain('Selling');
    expect(RESEARCH_STEPS).toContain('Product Research');
    expect(RESEARCH_STEPS).toContain('paste');
    expect(RESEARCH_STEPS.indexOf('Selling')).toBeLessThan(RESEARCH_STEPS.indexOf('Product Research'));
    expect(RESEARCH_STEPS.indexOf('Product Research')).toBeLessThan(RESEARCH_STEPS.indexOf('paste'));
  });
});
