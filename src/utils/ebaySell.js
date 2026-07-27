// Outbound drafts (ebay-connect §6 — step E2).
//
// createOrReplaceInventoryItem + an UNPUBLISHED createOffer is, precisely, a
// draft in Seller Hub. E2 stops there on purpose: `publishOffer` is never
// called, because human review before a listing goes live is a feature.
//
// Errors thrown here carry a { code } and, for validation failures, eBay's own
// errors[] so they can be mapped onto the editor field that caused them. They
// never carry a token.
import { getEbayTokens, refreshAccessToken } from './ebayAuth';

const MARKETPLACE = 'EBAY_US';
const CONTENT_LANGUAGE = 'en-US';
const CURRENCY = 'USD';

function err(code, extra = {}) {
  const e = new Error(code);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

// ── Condition ───────────────────────────────────────────────────────────────

/**
 * The app's own condition vocabulary (config/schema.js's grade enum and
 * ListingMode's CONDITIONS, which agree) mapped onto eBay's.
 *
 * ⚠ TWO DEVIATIONS FROM E2's PROMPT, both deliberate:
 *
 * 1. The prompt's labels — Like New / Excellent / Good / Fair — are not what
 *    this app produces. The real vocabulary is New / Like New / Good /
 *    Acceptable / For Parts. Both sets are mapped, so a stale label still
 *    lands somewhere sensible rather than falling through.
 * 2. "Like New" maps to USED_EXCELLENT, NOT eBay's LIKE_NEW. LIKE_NEW
 *    (condition id 2750) is accepted only in books, music and DVD categories;
 *    sending it for a jacket or a lamp is rejected. E2 has no category
 *    awareness at the moment it picks a condition, so it uses the enum that is
 *    valid across every used-goods category.
 */
export const CONDITION_MAP = {
  'New': 'NEW',
  'Like New': 'USED_EXCELLENT',
  'Excellent': 'USED_EXCELLENT',
  'Good': 'USED_GOOD',
  'Acceptable': 'USED_ACCEPTABLE',
  'Fair': 'USED_ACCEPTABLE',
  'For Parts': 'FOR_PARTS_OR_NOT_WORKING',
};

export const CONDITION_FALLBACK = 'USED_GOOD';

/** @returns {{ value: string, fellBack: boolean }} */
export function toEbayCondition(label) {
  const value = CONDITION_MAP[String(label ?? '').trim()];
  // The fallback is recorded rather than silent: a draft that quietly claims
  // "Good" for something described as broken is a refund waiting to happen.
  return value ? { value, fellBack: false } : { value: CONDITION_FALLBACK, fellBack: true };
}

// ── Transport ───────────────────────────────────────────────────────────────

const relaySecret = () => import.meta.env.VITE_RELAY_SECRET;
const proxyUrl = (path) => `/api/ebay/proxy?path=${encodeURIComponent(path)}`;

function relayFetch(path, { method = 'GET', body, token, sendContentLanguage } = {}) {
  const headers = {
    // The relay's own gate. The eBay token cannot share this header, so it
    // travels beside it and the relay moves it across on the way out.
    Authorization: `Bearer ${relaySecret()}`,
    'X-Ebay-Authorization': `Bearer ${token}`,
  };
  // createOrReplaceInventoryItem rejects a request without this, with a message
  // that never mentions the header. Sent on every write for consistency.
  if (sendContentLanguage) headers['Content-Language'] = CONTENT_LANGUAGE;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(proxyUrl(path), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * A user-token call through the proxy. On 401 it refreshes and retries exactly
 * once — never twice, so an expired refresh token fails fast instead of
 * looping. refreshAccessToken() preserves the stored refresh token, which
 * eBay's refresh grant does not return.
 */
export async function authedFetch(path, init = {}) {
  const tokens = await getEbayTokens();
  if (!tokens?.accessToken) throw err('not-connected');

  let response;
  try {
    response = await relayFetch(path, { ...init, token: tokens.accessToken });
  } catch { throw err('offline'); }

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    try {
      response = await relayFetch(path, { ...init, token: refreshed.accessToken });
    } catch { throw err('offline'); }
  }
  return response;
}

// The application token, held in memory for its short life. The relay stays
// stateless by design (§3), so any caching that happens, happens here.
let appToken = null; // { value, expiresAt }

async function getAppToken() {
  if (appToken && appToken.expiresAt > Date.now() + 30_000) return appToken.value;
  let response;
  try {
    response = await fetch('/api/ebay/oauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${relaySecret()}` },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    });
  } catch { throw err('offline'); }
  if (!response.ok) throw err('app-token-failed');
  const data = await response.json();
  if (!data?.access_token) throw err('app-token-failed');
  appToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 0) * 1000 };
  return appToken.value;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

/** Throws a structured error carrying eBay's errors[] so it can be field-mapped. */
async function okOrThrow(response) {
  if (response.ok) return readJson(response);
  const data = await readJson(response);
  if (response.status === 401 || response.status === 403) throw err('not-connected');
  throw err('ebay-rejected', { status: response.status, errors: data?.errors ?? [] });
}

// ── Taxonomy ────────────────────────────────────────────────────────────────

/**
 * The minimal slice of vision §8's deferred taxonomy work: a suggestion at send
 * time, nothing more. Returns null on any failure — by your ruling a missing
 * category never blocks a send, because the draft is otherwise complete and
 * eBay's own picker in Seller Hub beats this guess anyway.
 */
export async function suggestCategory(title) {
  if (!String(title ?? '').trim()) return null;
  try {
    const token = await getAppToken();
    const app = (path) => relayFetch(path, { token });

    const tree = await readJson(await app(
      `commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${MARKETPLACE}`));
    const treeId = tree?.categoryTreeId;
    if (!treeId) return null;

    const suggestions = await readJson(await app(
      `commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(title)}`));
    const top = suggestions?.categorySuggestions?.[0];
    if (!top?.category?.categoryId) return null;

    const ancestors = (top.categoryTreeNodeAncestors ?? [])
      .map(a => a.categoryName).filter(Boolean).reverse();
    return {
      categoryId: String(top.category.categoryId),
      path: [...ancestors, top.category.categoryName].filter(Boolean).join(' > '),
    };
  } catch {
    return null;
  }
}

// ── Business policies ───────────────────────────────────────────────────────

/**
 * Policy IDs are required fields on an offer. If the seller has none, every
 * send would produce a draft that can never be published — so this refuses
 * loudly and specifically rather than letting a 25007 surface later.
 */
export async function getPolicies() {
  const q = `?marketplace_id=${MARKETPLACE}`;
  const [fulfillment, payment, returns] = await Promise.all([
    okOrThrow(await authedFetch(`sell/account/v1/fulfillment_policy${q}`)),
    okOrThrow(await authedFetch(`sell/account/v1/payment_policy${q}`)),
    okOrThrow(await authedFetch(`sell/account/v1/return_policy${q}`)),
  ]);

  const policies = {
    fulfillmentPolicyId: fulfillment?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId ?? null,
    paymentPolicyId: payment?.paymentPolicies?.[0]?.paymentPolicyId ?? null,
    returnPolicyId: returns?.returnPolicies?.[0]?.returnPolicyId ?? null,
  };
  if (Object.values(policies).some(v => !v)) throw err('no-policies');
  return policies;
}

// ── Request builders (exported so tests can pin their shape) ────────────────

export function toAspects(specifics = {}) {
  const aspects = {};
  for (const [key, value] of Object.entries(specifics)) {
    const trimmed = String(value ?? '').trim();
    // eBay takes aspect values as arrays, and rejects empty ones — the editor
    // ships six specific slots and Dad rarely fills all six.
    if (trimmed) aspects[key] = [trimmed];
  }
  return aspects;
}

export function buildInventoryItem({ title, description, specifics, qty, condition }) {
  const quantity = Math.max(1, parseInt(qty, 10) || 1);
  return {
    availability: { shipToLocationAvailability: { quantity } },
    condition: toEbayCondition(condition).value,
    product: {
      title: String(title ?? '').slice(0, 80),
      description: String(description ?? ''),
      aspects: toAspects(specifics),
    },
    // NO imageUrls, and no key for it either.
    //
    // Photo-less drafts are a Founder decision (ebay §6, July 2026): Dad adds
    // photos in Seller Hub on the big screen, where he is already reviewing
    // before publishing. App photos stay on-device and are never uploaded
    // anywhere. If trips show the Seller Hub photo step is real friction, the
    // fallback is the legacy Trading API's UploadSiteHostedPictures, which
    // takes a binary upload rather than a public URL.
  };
}

export function buildOffer({ sku, values, categoryId, policies }) {
  const quantity = Math.max(1, parseInt(values.qty, 10) || 1);
  const price = Number.parseFloat(values.price);
  return {
    sku,
    marketplaceId: MARKETPLACE,
    format: 'FIXED_PRICE',
    availableQuantity: quantity,
    ...(categoryId ? { categoryId } : {}),
    listingDescription: String(values.description ?? ''),
    pricingSummary: {
      price: { value: (Number.isFinite(price) ? price : 0).toFixed(2), currency: CURRENCY },
    },
    listingPolicies: policies,
    // No merchantLocationKey: eBay requires it to PUBLISH, not to create. E2
    // never publishes, so no inventory location and no address-collecting UI
    // is needed. Seller Hub asks for the location on Dad's first publish.
  };
}

// ── Error mapping (ebay §6's failure honesty) ───────────────────────────────

const FIELD_RULES = [
  ['title', /\btitle\b/i],
  ['price', /\bprice\b|pricingSummary/i],
  ['qty', /\bquantit(y|ies)\b|availableQuantity/i],
  ['condition', /\bcondition\b/i],
  ['category', /\bcategor/i],
  ['description', /\bdescription\b/i],
  ['specifics', /\baspect|item specific/i],
];

/**
 * eBay's validation errors are cryptic and name their field inconsistently —
 * sometimes in `parameters[].name`, sometimes only in prose. Anything that
 * cannot be placed stays visible as general text; nothing is swallowed.
 * @returns {{ fieldErrors: Record<string,string>, general: string[] }}
 */
export function mapEbayErrors(errors = []) {
  const fieldErrors = {};
  const general = [];
  for (const e of errors) {
    const text = e?.longMessage || e?.message || 'eBay rejected part of this listing';
    const names = (e?.parameters ?? []).map(p => `${p?.name ?? ''} ${p?.value ?? ''}`).join(' ');
    const haystack = `${names} ${text}`;
    const hit = FIELD_RULES.find(([, rule]) => rule.test(haystack));
    if (hit && !fieldErrors[hit[0]]) fieldErrors[hit[0]] = text;
    else if (!hit) general.push(text);
  }
  return { fieldErrors, general };
}

// ── The send ────────────────────────────────────────────────────────────────

/**
 * @param {object} values the editor's CURRENT values, not the original analysis
 * @param {string|number} itemId the item's local id
 * @returns {Promise<{ offerId: string, sku: string, categoryId: string|null, categoryPath: string|null, conditionFellBack: boolean }>}
 */
export async function sendToEbayDraft(values, itemId) {
  // SKU = the item's local id. One identifier, three lives (plan §6.1): the id
  // saveDraft upserts by, the eBay SKU, and — if Nostr ever ships — the event
  // id, unchanged. Never mint a second one.
  const sku = String(itemId ?? '').trim();
  if (!sku) throw err('no-item-id');

  const policies = await getPolicies();          // throws no-policies → refuse
  const category = await suggestCategory(values.title); // null never blocks

  // 1. Inventory item. PUT, so a re-send is idempotent by construction.
  await okOrThrow(await authedFetch(
    `sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    { method: 'PUT', sendContentLanguage: true, body: buildInventoryItem(values) },
  ));

  // 2. Offer. Look first: a second createOffer for the same SKU is rejected,
  // and a re-send after an edit must update the existing draft rather than
  // error or silently do nothing.
  const existingId = await findOfferId(sku);
  const offerBody = buildOffer({ sku, values, categoryId: category?.categoryId, policies });

  const result = await okOrThrow(existingId
    ? await authedFetch(`sell/inventory/v1/offer/${encodeURIComponent(existingId)}`,
      { method: 'PUT', sendContentLanguage: true, body: offerBody })
    : await authedFetch('sell/inventory/v1/offer',
      { method: 'POST', sendContentLanguage: true, body: offerBody }));

  // 3. Stop. An unpublished offer IS the draft.
  return {
    offerId: String(existingId ?? result?.offerId ?? ''),
    sku,
    categoryId: category?.categoryId ?? null,
    categoryPath: category?.path ?? null,
    conditionFellBack: toEbayCondition(values.condition).fellBack,
  };
}

async function findOfferId(sku) {
  const response = await authedFetch(
    `sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`);
  // 404 is eBay's answer for "no offers for this SKU" — not a failure.
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const data = await readJson(response);
  return data?.offers?.[0]?.offerId ?? null;
}

/** ListingMode's call site: the editor's current values, plus the item id. */
export async function sendToEbay(values) {
  const result = await sendToEbayDraft(values, values.cartItemId);
  return { success: true, ...result };
}
