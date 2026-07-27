// The comps ladder's tier 0 (vision §4) — and, at E3, all of it.
//
// Tier 0 is Dad's OWN completed sales, and it outranks everything else on the
// ladder for one reason: it is the only tier that is ground truth about this
// seller, in this condition, at his photography and his shipping speed. Tiers A
// (SerpApi sold comps) and B (Browse actives) are V2's; this file is the
// interface they will slot into, not a placeholder for them.
import { getHistory } from './historyStore';
import { getSoldHistory, realizedNet, daysToSell } from './ebayInbound';

// Words that appear in half of all thrift listings and match nothing useful.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'a', 'an', 'of', 'in', 'on', 'to',
  'vintage', 'used', 'new', 'size', 'mens', 'womens', 'unisex', 'lot',
  'rare', 'euc', 'nwt', 'nwot', 'style', 'color', 'colour', 'item',
]);

// Deliberately high. A miss costs nothing — the verdict simply falls back to
// the model's own read, which is where it has been since V1. A FALSE match
// tells him a $12 lamp is worth $95 because he once sold a different lamp, and
// he buys it with real money. Misses beat false matches, every time.
const MIN_OVERLAP = 2;
const MIN_RATIO = 0.5;

export function tokenize(text) {
  return [...new Set(
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)),
  )];
}

/** @returns {{ overlap: number, ratio: number, matched: boolean }} */
export function scoreMatch(queryTokens, candidateTitle) {
  const candidate = new Set(tokenize(candidateTitle));
  if (!queryTokens.length || !candidate.size) return { overlap: 0, ratio: 0, matched: false };
  const overlap = queryTokens.filter(t => candidate.has(t)).length;
  const ratio = overlap / Math.min(queryTokens.length, candidate.size);
  return { overlap, ratio, matched: overlap >= MIN_OVERLAP && ratio >= MIN_RATIO };
}

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * @param {{ brand?: string, name?: string }} identification the analyze's own read
 * @returns {{ source: 'own-sales', samples: Array, median: number } | null}
 *
 * Null means "nothing comparable", which is the honest and common answer. It is
 * never an empty result dressed as a finding.
 */
export function getComps(identification) {
  const queryTokens = tokenize(`${identification?.brand ?? ''} ${identification?.name ?? ''}`);
  if (queryTokens.length < MIN_OVERLAP) return null;

  const sold = getSoldHistory();
  if (!Object.keys(sold).length) return null;
  const byId = new Map(getHistory().map(e => [String(e.sku ?? e.id), e]));

  const samples = [];
  for (const [itemId, sales] of Object.entries(sold)) {
    const entry = byId.get(String(itemId));
    if (!entry?.title) continue;
    if (!scoreMatch(queryTokens, entry.title).matched) continue;

    for (const sale of sales) {
      const span = daysToSell(entry, sale);
      samples.push({
        title: entry.title,
        price: Number(sale.soldPrice) || 0,
        net: realizedNet(entry, sale),
        daysToSell: span?.days ?? null,
        approxDays: span?.approx ?? true,
        soldAt: sale.soldAt,
      });
    }
  }
  if (!samples.length) return null;

  samples.sort((a, b) => b.soldAt - a.soldAt); // most recent first — the prototype's order
  return { source: 'own-sales', samples, median: median(samples.map(s => s.price)) };
}

/**
 * The block injected into the analyze's USER message (vision §5: "injected by
 * the client, not asked of the model"). Sold data is exactly what §5 says to
 * weight — it is not the purchase price the anchoring test guards against.
 * @returns {string|null}
 */
export function buildCompsBlock(comps) {
  if (!comps?.samples?.length) return null;
  const lines = comps.samples.slice(0, 3).map(s => {
    const span = s.daysToSell === null ? '' : ` in ${s.daysToSell} day${s.daysToSell === 1 ? '' : 's'}`;
    return `- "${s.title}" sold for $${s.price.toFixed(2)}${span}`;
  });
  return [
    'The seller previously sold similar items:',
    ...lines,
    'Weigh these heavily; they are the seller\'s own results.',
  ].join('\n');
}
