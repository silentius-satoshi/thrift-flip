// The photo store. Node has no IndexedDB, so this runs on the memory backend —
// the same seam lib/vault.js uses, and the reason the pattern was copied.
import { describe, it, expect, beforeEach } from 'vitest';
import * as photoStore from './photoStore';

const photo = (n) => ({ base64: `BASE64-${n}`, mimeType: 'image/jpeg' });

beforeEach(async () => {
  for (const id of ['a', 'b', 'c', photoStore.IN_FLIGHT]) await photoStore.remove(id);
  for (let i = 0; i < 80; i++) await photoStore.remove(`bulk-${i}`);
});

describe('backend', () => {
  it('runs in memory under Node, which is the test seam', () => {
    expect(photoStore.isMemoryBackend()).toBe(true);
  });
});

describe('round-trip', () => {
  it('stores and returns photos for an item', async () => {
    await photoStore.put('a', [photo(1), photo(2)]);
    expect(await photoStore.get('a')).toEqual([photo(1), photo(2)]);
  });

  it('returns an empty array for an item with none', async () => {
    expect(await photoStore.get('nothing-here')).toEqual([]);
  });

  it('returns an empty array rather than throwing on a null id', async () => {
    // A legacy conversation has no stored photos and the chat must degrade to
    // text-only rather than fail.
    expect(await photoStore.get(null)).toEqual([]);
    expect(await photoStore.get(undefined)).toEqual([]);
  });

  it('keys numbers and their strings the same', async () => {
    // itemId is Date.now() — a number in ShoppingMode, a string once it has
    // been through JSON or a DOM attribute.
    await photoStore.put(1730000000000, [photo(1)]);
    expect(await photoStore.get('1730000000000')).toEqual([photo(1)]);
  });

  it('replaces rather than appends on a second write', async () => {
    await photoStore.put('a', [photo(1)]);
    await photoStore.put('a', [photo(2)]);
    expect(await photoStore.get('a')).toEqual([photo(2)]);
  });

  it('remove clears the record', async () => {
    await photoStore.put('a', [photo(1)]);
    await photoStore.remove('a');
    expect(await photoStore.get('a')).toEqual([]);
  });
});

describe('promote', () => {
  // Photos are captured before "Get the verdict" mints an item id, so they land
  // under a reserved key and are handed over when the id exists.
  it('moves the in-flight photos onto the new item id', async () => {
    await photoStore.put(photoStore.IN_FLIGHT, [photo(1), photo(2)]);
    await photoStore.promote(photoStore.IN_FLIGHT, 'a');

    expect(await photoStore.get('a')).toEqual([photo(1), photo(2)]);
    // A move, not a copy: leaving them behind would hand the NEXT item's
    // capture a set of photos belonging to the last one.
    expect(await photoStore.get(photoStore.IN_FLIGHT)).toEqual([]);
  });

  it('does nothing when there is nothing in flight', async () => {
    await photoStore.put('a', [photo(9)]);
    await photoStore.promote(photoStore.IN_FLIGHT, 'a');
    expect(await photoStore.get('a')).toEqual([photo(9)]);
  });

  it('is a no-op onto the same id', async () => {
    await photoStore.put('a', [photo(1)]);
    await photoStore.promote('a', 'a');
    expect(await photoStore.get('a')).toEqual([photo(1)]);
  });
});

describe('the cap', () => {
  it('prunes oldest-first once past MAX_ITEMS', async () => {
    const cap = photoStore.__testing.MAX_ITEMS;
    for (let i = 0; i < cap + 5; i++) await photoStore.put(`bulk-${i}`, [photo(i)]);

    expect(await photoStore.count()).toBe(cap);
    // The five oldest went; the newest survived.
    expect(await photoStore.get('bulk-0')).toEqual([]);
    expect(await photoStore.get('bulk-4')).toEqual([]);
    expect(await photoStore.get(`bulk-${cap + 4}`)).toEqual([photo(cap + 4)]);
  });

  it('never prunes the in-flight record', async () => {
    const cap = photoStore.__testing.MAX_ITEMS;
    await photoStore.put(photoStore.IN_FLIGHT, [photo('flight')]);
    for (let i = 0; i < cap + 3; i++) await photoStore.put(`bulk-${i}`, [photo(i)]);
    // The capture in progress is the one thing that must not vanish because a
    // trip got long.
    expect(await photoStore.get(photoStore.IN_FLIGHT)).toEqual([photo('flight')]);
  });
});
