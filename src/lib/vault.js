// The blob store behind the credential vault (nostr spec §13, Step N1-lite).
// It holds ciphertext and non-secret metadata. It performs no crypto and knows
// nothing about what the bytes mean — that is keyVault.js's job.
//
// Deliberately NOT localStorage: IndexedDB keeps the vault out of the JSON
// backup by construction (backup.js scans localStorage only), so there is no
// deny-list to forget to update.
import { vaultErr } from './vaultError';

const DB_NAME = 'thrift-flip-vault';
const DB_VERSION = 1;
const BLOBS = 'blobs';   // keyPath 'name'  — { name, ciphertext, meta }
const META = 'meta';     // keyPath 'key'   — { key, value }

// iOS Safari in Private Browsing can leave indexedDB.open() pending forever
// rather than erroring (§13 QA note). A hang is the worst failure here: the
// unlock ceremony never starts and nothing at all appears to happen.
const OPEN_TIMEOUT_MS = 10_000;

const PRIVATE_BROWSING_COPY =
  "This browser won't let Thrift Flip store your key safely — Private Browsing blocks it. Open the app in a normal tab.";

// ── Backend selection ───────────────────────────────────────────────────────
// Three-way and deliberate:
//   no indexedDB at all (Node: vitest, scripts/live-check.mjs) → memory. A test
//     seam, not a fallback.
//   indexedDB present but unusable (iOS Private Browsing) → a specific error.
//     Never silently degrade to memory in a browser — that is data loss wearing
//     a success message.
//   otherwise → IndexedDB.
const useMemory = typeof indexedDB === 'undefined';

export const isMemoryBackend = () => useMemory;

const memBlobs = new Map();
const memMeta = new Map();

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    const fail = () => {
      dbPromise = null; // let a later attempt retry rather than caching the failure
      reject(vaultErr('vault-unavailable', PRIVATE_BROWSING_COPY));
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
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'name' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
    req.onerror = () => { clearTimeout(timer); fail(); };
    req.onblocked = () => { clearTimeout(timer); fail(); };
  });
  return dbPromise;
}

function run(storeName, mode, work) {
  return openDb().then(db => new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch {
      // Private Browsing can open the database and then refuse every
      // transaction, so this is a second, separate place it shows up.
      reject(vaultErr('vault-unavailable', PRIVATE_BROWSING_COPY));
      return;
    }
    let result;
    const req = work(tx.objectStore(storeName));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(vaultErr('vault-unavailable', PRIVATE_BROWSING_COPY));
    tx.onabort = () => reject(vaultErr('vault-unavailable', PRIVATE_BROWSING_COPY));
  }));
}

// ── Blobs ───────────────────────────────────────────────────────────────────

/** @returns {Promise<{ name: string, ciphertext: ArrayBuffer, meta: object } | null>} */
export async function getBlob(name) {
  if (useMemory) return memBlobs.get(name) ?? null;
  return (await run(BLOBS, 'readonly', s => s.get(name))) ?? null;
}

export async function putBlob(name, ciphertext, meta) {
  const record = { name, ciphertext, meta };
  if (useMemory) { memBlobs.set(name, record); return; }
  await run(BLOBS, 'readwrite', s => s.put(record));
}

export async function deleteBlob(name) {
  if (useMemory) { memBlobs.delete(name); return; }
  await run(BLOBS, 'readwrite', s => s.delete(name));
}

export async function listBlobNames() {
  if (useMemory) return [...memBlobs.keys()];
  return (await run(BLOBS, 'readonly', s => s.getAllKeys())) ?? [];
}

// ── Meta ────────────────────────────────────────────────────────────────────
// Non-secret: the enrollment record (scheme, credentialId, salt) and the PIN
// attempt counter. Kept here rather than in localStorage so this step adds no
// storage keys and nothing new reaches the JSON export.

export async function getMeta(key) {
  if (useMemory) return memMeta.get(key) ?? null;
  const row = await run(META, 'readonly', s => s.get(key));
  return row ? row.value : null;
}

export async function putMeta(key, value) {
  if (useMemory) { memMeta.set(key, value); return; }
  await run(META, 'readwrite', s => s.put({ key, value }));
}

export async function deleteMeta(key) {
  if (useMemory) { memMeta.delete(key); return; }
  await run(META, 'readwrite', s => s.delete(key));
}

/** Wipes the whole vault — the destructive reset behind "Can't unlock?". */
export async function clearAll() {
  if (useMemory) { memBlobs.clear(); memMeta.clear(); return; }
  await run(BLOBS, 'readwrite', s => s.clear());
  await run(META, 'readwrite', s => s.clear());
}
