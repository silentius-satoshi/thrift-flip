// Comps tier A, client half (V2): build the query, spend at most one credit
// per distinct item, and never let a comps failure become the item's problem.
//
// The relay computes; this file decides WHETHER to ask. That split is the
// spend discipline: Dad's SerpApi plan is 250 searches a month and a Saturday
// is ~35 items, so a second look at the same thing must be free.
import { queryTokens, pickComps } from './compsProvider';
import { compsService } from './storageService';
import { calcProfit, checkRules } from './calculations';
import { DEFAULT_SHIPPING } from '../config/gemini';

const RELAY = '/api/serpapi/comps';
const relaySecret = () => import.meta.env.VITE_RELAY_SECRET;

// A week. Sold prices move over months, not days, and a thrift trip revisited
// the same afternoon must never re-spend.
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
// localStorage is ~5MB and already holds the cart, drafts and history. Comps
// entries are small, but unbounded growth over months is still a quota bug
// waiting for a Saturday, so the cache is capped and evicts oldest-first.
const MAX_ENTRIES = 200;

/**
 * The model's own read, reduced to a search string — brand and name, minus the
 * thrift-listing filler `tokenize` already strips.
 *
 * Falls back to the generated listing title, which is the only other text that
 * describes the item in the model's words. Returns null when there is nothing
 * identifying enough to search on; a two-token minimum matches tier 0's
 * MIN_OVERLAP, and for the same reason — a one-word query returns a category,
 * not a comp.
 *
 * @returns {string|null} normalized, order-independent, safe as a cache key
 */
export function compsQuery({ identification, listingTitle } = {}) {
  const fromId = `${identification?.brand ?? ''} ${identification?.name ?? ''}`.trim();
  const tokens = queryTokens(fromId || listingTitle || '');
  if (tokens.length < 2) return null;
  // Model numbers earn their place next to a word, not instead of one. "12 34"
  // is not an item, and finding that out would still cost a credit.
  if (!tokens.some(t => /[a-z]/.test(t))) return null;
  // Natural order goes to eBay — "nike air force 1" reads to their ranker the
  // way a person would type it.
  return tokens.join(' ');
}

/**
 * The cache key, which is a different job from the query.
 *
 * Sorting here and not in `compsQuery` means "nike air force" and "air force
 * nike" cost ONE credit between them while eBay still receives each in the
 * order the model wrote it.
 */
export function cacheKeyFor(query) {
  return String(query ?? '').split(' ').sort().join(' ');
}

function readCache() {
  return compsService.get().then(c => (c && typeof c === 'object' ? c : {})).catch(() => ({}));
}

async function writeCache(query, comps) {
  const cache = await readCache();
  cache[query] = { at: Date.now(), comps };
  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => (cache[a]?.at ?? 0) - (cache[b]?.at ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach(k => delete cache[k]);
  }
  // A full quota here costs a cached lookup, never a verdict — setItem already
  // returns false rather than throwing.
  await compsService.set(cache);
}

export function isFresh(entry, now = Date.now()) {
  return Boolean(entry) && Number.isFinite(entry.at) && now - entry.at < TTL_MS;
}

/**
 * One relay round-trip. Resolves to the shaped payload or null — it never
 * rejects, because there is no comps failure that should surface as an error
 * next to a photo of a mug.
 */
async function fetchFromRelay(query) {
  try {
    const response = await fetch(`${RELAY}?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${relaySecret()}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.unavailable || !Number.isFinite(data.count) || data.count < 1) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * The tier-A entry point.
 *
 * A cached MISS is cached too — `comps: null` with a timestamp — because
 * "eBay has no sold record of this" is a real and permanent-ish answer for
 * most thrift inventory, and re-asking it every time would burn the month's
 * plan on the items least likely to ever have comps.
 *
 * @returns {Promise<object|null>} shaped comps, or null for no usable data
 */
export async function getSoldComps({ identification, listingTitle } = {}) {
  const query = compsQuery({ identification, listingTitle });
  if (!query) return null;
  const key = cacheKeyFor(query);

  const cache = await readCache();
  const hit = cache[key];
  if (isFresh(hit)) return hit.comps ?? null;

  const comps = await fetchFromRelay(query);
  try { await writeCache(key, comps); } catch { /* a cache write is never load-bearing */ }
  return comps;
}

/**
 * Sold data taking the wheel — the whole repricing, pure, so the arithmetic is
 * testable without a component.
 *
 * When tier A is thick enough (`pickComps` decides), the sold median becomes
 * the price of record and fees, net and the two house rules all recompute from
 * it. When it is not, the model's price stands and the comps ride along as
 * context for the Why sheet. Either way `modelEstimate` is preserved, because a
 * receipt that cannot show what the model thought is not a receipt.
 *
 * @returns {{ next: object, flipped: boolean, choice: object }} `flipped` is
 *   true only when the VERDICT changed, not merely the price — a number that
 *   moves is routine, a BUY that becomes a LEAVE IT is not.
 */
export function repriceFromComps(result, sold, goodwillPrice) {
  const choice = pickComps({ sold, own: result?.comps });
  const withComps = {
    ...result,
    soldComps: sold ?? null,
    compsSource: choice.source ?? result?.compsSource ?? null,
    // The cart renders this straight into a pill. Real for the first time.
    soldCount: choice.source === 'ebay-sold' ? choice.count : (result?.soldCount ?? null),
  };
  if (!choice.pricesTheItem) return { next: withComps, flipped: false, choice };

  const gp = Number(goodwillPrice) || 0;
  const shipping = Number.isFinite(result?.shipping) ? result.shipping : DEFAULT_SHIPPING;
  const estSellPrice = choice.median;
  const { ebayFee, net } = calcProfit(estSellPrice, gp, shipping);

  const before = checkRules(result?.estSellPrice ?? 0, gp, result?.netProfit ?? 0).verdict;
  const after = checkRules(estSellPrice, gp, net).verdict;

  return {
    next: {
      ...withComps,
      estSellPrice,
      fees: ebayFee,
      netProfit: net,
      // Range comes from the sold spread now, not the model's guess at one.
      priceRange: [sold.low, sold.high],
      source: 'ebay-sold',
    },
    flipped: before !== after,
    choice,
  };
}

export const __testing = { MAX_ENTRIES };
