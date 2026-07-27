// src/utils/storageService.js
// Storage abstraction layer.
// Currently uses localStorage. Replace implementations here when migrating to Supabase.
// All methods are async so the calling code is already shaped correctly for remote DB calls.

export async function getItem(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function setItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (err.name === 'QuotaExceededError') return false;
    throw err;
  }
}

export async function removeItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch { return false; }
}

// Cart
export const cartService = {
  get: () => getItem('thrift-flip-cart'),
  set: (cart) => setItem('thrift-flip-cart', cart),
};

// History
export const historyService = {
  get: () => getItem('thrift-flip-history'),
  set: (history) => setItem('thrift-flip-history', history),
  clear: () => removeItem('thrift-flip-history'),
};

// Shopping
export const shoppingService = {
  getForm: () => getItem('thrift-flip-shopping-form'),
  setForm: (form) => setItem('thrift-flip-shopping-form', form),
  getVerdict: () => getItem('thrift-flip-shopping-verdict'),
  setVerdict: (verdict) => setItem('thrift-flip-shopping-verdict', verdict),
  clearVerdict: () => removeItem('thrift-flip-shopping-verdict'),
  clearAll: async () => {
    await removeItem('thrift-flip-shopping-form');
    await removeItem('thrift-flip-shopping-verdict');
  },
};

// Listing edits
export const listingEditsService = {
  get: () => getItem('thrift-flip-listing-edits'),
  set: (edits) => setItem('thrift-flip-listing-edits', edits),
  clear: () => removeItem('thrift-flip-listing-edits'),
};

// Listing (item + data)
export const listingService = {
  get: () => getItem('thrift-flip-listing'),
  set: (listing) => setItem('thrift-flip-listing', listing),
  clear: () => removeItem('thrift-flip-listing'),
};

// Screen
export const screenService = {
  get: () => getItem('thrift-flip-screen'),
  set: (screen) => setItem('thrift-flip-screen', screen),
};

// AI key (BYOK). Plaintext by explicit decision — the honest threat note is in
// Settings, and the key is revocable in one tap. Two rules hold from day one:
// it never appears in logs or error messages, and the JSON backup excludes it.
export const aiKeyService = {
  get: () => getItem('thrift-flip-ai-key'),
  // TODO(N1): migrate to vault STORE_ENC_INFO
  set: (key) => setItem('thrift-flip-ai-key', key),
  clear: () => removeItem('thrift-flip-ai-key'),
};
