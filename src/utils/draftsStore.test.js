import { describe, it, expect, beforeEach } from 'vitest';
import { saveDraft, getDrafts, getDraft, deleteDraft, clearDrafts } from './draftsStore';

// A Map standing in for localStorage; the store reads and writes it directly.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});

describe('draftsStore', () => {
  // M1: the mobile harness seeded a draft the way the app's auto-save writes
  // one and the Drafts screen threw. App.jsx spreads the editor's persisted
  // edits into saveDraft, where `price` is a controlled input's value, and
  // DraftsMode renders it with toFixed(2) — so every auto-saved draft took the
  // screen down. Only ListingMode's explicit Save draft coerced.
  it('stores a string price as a number, because that is how auto-save arrives', () => {
    saveDraft({ id: 1, title: 'Pendleton blanket', price: '94.5', goodwillPrice: 8 });
    const [draft] = getDrafts();
    expect(draft.price).toBe(94.5);
    expect(() => draft.price.toFixed(2)).not.toThrow();
  });

  it('treats an empty or unparseable price as 0 rather than NaN', () => {
    saveDraft({ id: 1, title: 'a', price: '' });
    saveDraft({ id: 2, title: 'b', price: 'four dollars' });
    saveDraft({ id: 3, title: 'c' });
    expect(getDrafts().map((d) => d.price)).toEqual([0, 0, 0]);
  });

  it('leaves a number price alone', () => {
    saveDraft({ id: 1, title: 'a', price: 40 });
    expect(getDraft(1).price).toBe(40);
  });

  it('heals a draft already on disk from before the fix', () => {
    // A write-side fix alone never reaches these — they are the ones that were
    // taking the screen down.
    localStorage.setItem('thrift-flip-drafts', JSON.stringify([{ id: 9, title: 'legacy', price: '40' }]));
    expect(getDrafts()[0].price).toBe(40);
    expect(getDraft(9).price).toBe(40);
  });

  it('survives a corrupt store rather than throwing', () => {
    localStorage.setItem('thrift-flip-drafts', '{"not":"an array"}');
    expect(getDrafts()).toEqual([]);
  });

  it('replaces a draft in place on re-save and prepends a new one', () => {
    saveDraft({ id: 1, title: 'first', price: '10' });
    saveDraft({ id: 2, title: 'second', price: '20' });
    saveDraft({ id: 1, title: 'first, edited', price: '15' });
    expect(getDrafts().map((d) => d.title)).toEqual(['second', 'first, edited']);
    expect(getDraft(1).price).toBe(15);
  });

  it('deletes and clears', () => {
    saveDraft({ id: 1, title: 'a', price: '1' });
    saveDraft({ id: 2, title: 'b', price: '2' });
    deleteDraft(1);
    expect(getDrafts().map((d) => d.id)).toEqual([2]);
    clearDrafts();
    expect(getDrafts()).toEqual([]);
  });
});
