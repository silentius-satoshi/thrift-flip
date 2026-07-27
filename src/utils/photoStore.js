// Shopping photos, out of localStorage (nostr §2's "N4 local half" — no Nostr
// dependency, lifted out and shipped alone at V3).
//
// Before this, photos lived as base64 inside `thrift-flip-shopping-form`,
// rewritten on every keystroke. localStorage caps around 5MB and a dozen items
// at three photos each blows through it mid-aisle, as a write failure. They
// live here instead, and the chat depends on them surviving the trip.
//
// The backend-selection pattern is lib/vault.js's, deliberately reused. It is
// NOT the same database: the vault holds ciphertext under a schema version that
// should never have to move because someone changed how pictures are stored.

const DB_NAME = 'thrift-flip-photos';
const DB_VERSION = 1;
const STORE = 'photos';        // keyPath 'itemId' — { itemId, photos, savedAt }

// Photos captured before "Get the verdict" have no item id yet — it is minted
// as Date.now() at that moment — so they land here and are promoted when it
// exists. One reserved key, reused by every item in turn.
export const IN_FLIGHT = 'in-flight';

// The cap. Photos are owned by their conversation and deleted with it, but a
// user who never deletes a conversation would otherwise grow this store every
// trip, forever. ~3 photos/item at 1280px/JPEG-0.8 ≈ 30MB at this cap.
const MAX_ITEMS = 50;

const OPEN_TIMEOUT_MS = 10_000;
const UNAVAILABLE_COPY =
  "This browser won't let Thrift Flip keep your photos — Private Browsing blocks it. Open the app in a normal tab.";

export class PhotoStoreError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'PhotoStoreError';
    this.code = code;
  }
}

// Three-way and deliberate, exactly as in the vault:
//   no indexedDB at all (Node: vitest) → memory. A test seam, not a fallback.
//   present but unusable (iOS Private Browsing) → a specific error. Never a
//     silent degrade, which here would mean a chat that has quietly gone blind.
//   otherwise → IndexedDB.
const useMemory = typeof indexedDB === 'undefined';
export const isMemoryBackend = () => useMemory;

const memory = new Map();
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    const fail = () => {
      dbPromise = null; // let a later attempt retry rather than caching the failure
      reject(new PhotoStoreError('photos-unavailable', UNAVAILABLE_COPY));
    };
    const timer = setTimeout(fail, OPEN_TIMEOUT_MS);
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      clearTimeout(timer);
      fail();
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'itemId' });
    };
    req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
    req.onerror = () => { clearTimeout(timer); fail(); };
    req.onblocked = () => { clearTimeout(timer); fail(); };
  });
  return dbPromise;
}

function run(mode, work) {
  return openDb().then(db => new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch {
      // Private Browsing can open the database and then refuse every
      // transaction, so this is a second, separate place it shows up.
      reject(new PhotoStoreError('photos-unavailable', UNAVAILABLE_COPY));
      return;
    }
    let result;
    const req = work(tx.objectStore(STORE));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new PhotoStoreError('photos-unavailable', UNAVAILABLE_COPY));
    tx.onabort = () => reject(new PhotoStoreError('photos-unavailable', UNAVAILABLE_COPY));
  }));
}

const key = (itemId) => String(itemId);

/** @returns {Promise<Array<{base64: string, mimeType: string}>>} — [] when absent. */
export async function get(itemId) {
  if (itemId === null || itemId === undefined) return [];
  const record = useMemory
    ? memory.get(key(itemId))
    : await run('readonly', s => s.get(key(itemId)));
  return record?.photos ?? [];
}

export async function put(itemId, photos) {
  const record = { itemId: key(itemId), photos: photos ?? [], savedAt: Date.now() };
  if (useMemory) memory.set(record.itemId, record);
  else await run('readwrite', s => s.put(record));
  await prune();
}

export async function remove(itemId) {
  if (itemId === null || itemId === undefined) return;
  if (useMemory) memory.delete(key(itemId));
  else await run('readwrite', s => s.delete(key(itemId)));
}

/**
 * Hand the in-flight photos to the item that just acquired an id. A move, not a
 * copy — leaving the in-flight record behind would hand the next item's capture
 * a set of photos belonging to the last one.
 */
export async function promote(fromId, toId) {
  if (key(fromId) === key(toId)) return;
  const photos = await get(fromId);
  if (!photos.length) return;
  await put(toId, photos);
  await remove(fromId);
}

export async function count() {
  if (useMemory) return memory.size;
  return (await run('readonly', s => s.count())) ?? 0;
}

async function allRecords() {
  if (useMemory) return [...memory.values()];
  return (await run('readonly', s => s.getAll())) ?? [];
}

/** Oldest-first prune to MAX_ITEMS. The in-flight record is never a candidate. */
async function prune() {
  const records = await allRecords();
  const prunable = records.filter(r => r.itemId !== IN_FLIGHT);
  if (prunable.length <= MAX_ITEMS) return;
  const doomed = prunable
    .sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0))
    .slice(0, prunable.length - MAX_ITEMS);
  for (const record of doomed) await remove(record.itemId);
}

export const __testing = { MAX_ITEMS };
