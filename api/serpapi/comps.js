// Sold-comps relay (V2, comps tier A).
//
// SerpApi is server-to-server — the key may never reach a browser — so this
// exists for the same reason api/ebay/proxy.js does. Same posture: stateless,
// gated by the shared bearer secret, and NOT ONE console statement that
// receives a query, a body or a key.
//
// It returns a small computed summary, never SerpApi's payload. That is a
// deliberate narrowing: the raw response is ~240 rows of listing HTML, none of
// which the client needs, and forwarding it would put eBay listing content the
// app has no display rights to onto the device.
//
// ── What this relay cannot currently get ────────────────────────────────────
// eBay gates sold/completed search, and SerpApi's eBay engine does not get
// through it. Measured 2026-07-28 on a healthy account, healthy engine:
//
//   no filter                        HTTP 200, 240 results
//   show_only=Sold,Complete          HTTP 200,   0 results
//   show_only=Sold                   HTTP 503,   archive status "Error"
//   popular_filters=LH_Sold=1&...    HTTP 200,   0 results
//
// The filter is recognised — SerpApi echoes it in search_parameters, and an
// illegal value 400s with "Unsupported option" — so the request is right and
// the source is empty. That reproduces every sold lookup this project has made
// across R1, D1 and H2. So this relay is correct and, today, always answers
// `unavailable`. It is built rather than deferred because the ladder above it
// is source-agnostic: pointing tier A at a working sold feed later replaces
// `fetchSold` and nothing else.
import { authorized } from '../_lib/relayAuth.js';

const ENDPOINT = 'https://serpapi.com/search.json';
const ARCHIVE = 'https://serpapi.com/searches';

// D1 measured eBay-engine searches running 22–74s and billing even when the
// client gave up. The harness answered that with a 120s timeout and a 60s
// sleep; a serverless function cannot — it would hit the platform's own
// execution ceiling first and return nothing, having still paid for the search.
// So the patience moves: fail fast here, and recover the completed search from
// the archive, which is a free lookup rather than a second billed search.
const SEARCH_TIMEOUT_MS = 6_500;
const ARCHIVE_TIMEOUT_MS = 2_500;

// LH_Sold / LH_Complete are eBay's OWN url params. SerpApi does not forward
// them and does not error on them, so passing them returns active asking
// prices while looking like it worked. `show_only` is the supported mechanism
// and its legal values are single words.
const SHOW_ONLY = 'Sold,Complete';

const median = (sorted) => (
  sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
);

/**
 * "Sold  Jul 12, 2026" → epoch ms, and anything else → null.
 *
 * The sold arm returns no rows (see above), so this format is taken from
 * SerpApi's documentation and has never been observed live. That is exactly
 * why an unparseable date degrades to null instead of being guessed at: a
 * wrong window would produce a confident, wrong velocity, and "sells ~4/week"
 * on a shelf-sitter is worse than saying nothing.
 */
export function parseSoldDate(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^\s*sold\b/i, '').trim();
  if (!cleaned) return null;
  const at = Date.parse(cleaned);
  return Number.isFinite(at) ? at : null;
}

function priceOf(row) {
  const p = row?.price ?? {};
  if (Number.isFinite(p.extracted)) return p.extracted;
  // A "$39.99 to $59.99" row is one listing with variants; its midpoint is the
  // honest single number, and dropping it would bias the median toward
  // fixed-price listings.
  if (Number.isFinite(p.from?.extracted) && Number.isFinite(p.to?.extracted)) {
    return (p.from.extracted + p.to.extracted) / 2;
  }
  return null;
}

const MAX_SAMPLES = 5;
const MAX_WINDOW_DAYS = 90;

/**
 * The whole of the math, pure and exported so a test can pin it without a
 * network. Everything it returns is derived; nothing is passed through.
 *
 * @returns {{median, low, high, count, windowDays, velocityPerWeek, samples}}
 *   or `{ unavailable: true }` when there is nothing usable. Zero results is
 *   NOT an error — it is the common, honest answer for thrift inventory.
 */
export function shapeComps(payload) {
  const rows = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
  const usable = rows
    // Promoted listings are paid placement and skew high.
    .filter((r) => !r.sponsored)
    // Ended without selling: this is what the item FAILED to sell at, which is
    // the opposite of a comp.
    .filter((r) => !(r.unsold_date && !r.sold_date))
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : '',
      link: typeof r.link === 'string' ? r.link : null,
      price: priceOf(r),
      soldAt: parseSoldDate(r.sold_date),
    }))
    .filter((r) => Number.isFinite(r.price) && r.price > 0);

  if (!usable.length) return { unavailable: true };

  const prices = usable.map((r) => r.price).sort((a, b) => a - b);
  const stamps = usable.map((r) => r.soldAt).filter(Number.isFinite);

  // Two dated sales are the minimum that can describe a span. Below that the
  // window is unknown, and an unknown window makes velocity unknown too.
  let windowDays = null;
  let velocityPerWeek = null;
  if (stamps.length >= 2) {
    const span = (Math.max(...stamps) - Math.min(...stamps)) / 86_400_000;
    windowDays = Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.round(span)));
    velocityPerWeek = Math.round((usable.length / (windowDays / 7)) * 100) / 100;
  }

  const samples = [...usable]
    // Most recent first; undated rows sort last rather than being dropped —
    // they still priced the item, they just cannot date it.
    .sort((a, b) => (b.soldAt ?? -Infinity) - (a.soldAt ?? -Infinity))
    .slice(0, MAX_SAMPLES)
    .map((r) => ({
      title: r.title,
      price: r.price,
      date: r.soldAt === null ? null : new Date(r.soldAt).toISOString().slice(0, 10),
      link: r.link,
    }));

  return {
    median: median(prices),
    low: prices[0],
    high: prices[prices.length - 1],
    count: usable.length,
    windowDays,
    velocityPerWeek,
    samples,
  };
}

function searchUrl(query, key) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('engine', 'ebay');
  url.searchParams.set('_nkw', query);
  url.searchParams.set('show_only', SHOW_ONLY);
  url.searchParams.set('ebay_domain', 'ebay.com');
  url.searchParams.set('_ipg', '200'); // a credit costs the same at any result count
  url.searchParams.set('api_key', key);
  return url;
}

// Free: retrieving a completed search is a lookup, not a search.
async function fromArchive(id, key) {
  if (!id) return null;
  try {
    const url = new URL(`${ARCHIVE}/${encodeURIComponent(id)}.json`);
    url.searchParams.set('api_key', key);
    const response = await fetch(url, { signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.organic_results?.length ? data : null;
  } catch { return null; }
}

async function fetchSold(query, key) {
  let data;
  try {
    const response = await fetch(searchUrl(query, key), {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    data = await response.json().catch(() => null);
    if (!response.ok) {
      // The error body still names the search that is running server-side. Ask
      // the archive for it rather than paying for the same work twice.
      return await fromArchive(data?.search_metadata?.id, key);
    }
  } catch {
    // A timeout here does not mean the search failed — it means we stopped
    // waiting, and it is billed regardless. There is no id to recover it by.
    return null;
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const key = process.env.SERPAPI_KEY;
  // No key configured is not the item's fault and not an error the client can
  // act on — it is simply no comps, and the ladder falls to the next tier.
  if (!key) return res.status(200).json({ unavailable: true });

  const url = new URL(req.url, 'https://placeholder.invalid');
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) return res.status(400).json({ error: 'missing_query' });

  const payload = await fetchSold(query, key);
  // Every failure path converges here deliberately. A 502 would render in the
  // app as something wrong with the item; `unavailable` is what is true.
  return res.status(200).json(payload ? shapeComps(payload) : { unavailable: true });
}
