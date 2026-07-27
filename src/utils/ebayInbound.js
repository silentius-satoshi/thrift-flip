// Inbound: sold orders and listing traffic (ebay-connect §7 — step E3).
//
// The first thing this app reads back rather than pushes out, and the fuel for
// vision §4's comps ladder: what Dad actually sold is tier 0, ranked above
// anything the model believes.
//
// NO BACKGROUND JOBS (§7). Every refresh traces to a user action — opening the
// Selling tab, or tapping refresh. There are no timers in this file.
import { authedFetch } from './ebaySell';
import { getHistory, replaceHistory } from './historyStore';
import { getItem, setItem } from './storageService';
import { calcProfit } from './calculations';
import { DEFAULT_SHIPPING } from '../config/gemini';

const MARKETPLACE = 'EBAY_US';
const WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 200;

// eBay caps the traffic report at 200 listing ids and a 90-day range.
const TRAFFIC_ID_CAP = 200;

// §7's "cache verdict-cheap; a manual refresh is always allowed". Opening the
// tab twice in a minute must not cost two round trips; tapping refresh always
// does exactly what it says.
const THROTTLE_MS = 10 * 60 * 1000;

export const SOLD_HISTORY_KEY = 'thrift-flip-sold-history';
const PREFS_KEY = 'thrift-flip-inbound-prefs';

const iso = (ms) => new Date(ms).toISOString();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── The sold-history store ──────────────────────────────────────────────────
// Business data, not a credential: it sits inside the `thrift-flip-` prefix, so
// backup.js's prefix scan exports it by construction. That is correct — this is
// the record Dad would most want back after losing a phone.

export function getSoldHistory() {
  // Direct read — sync required for useState lazy init, same as historyStore
  try { return JSON.parse(localStorage.getItem(SOLD_HISTORY_KEY)) ?? {}; } catch { return {}; }
}

/**
 * Merge sales in, keyed by itemId and **deduped by orderId** so refreshing
 * twice never double-counts. A sale is immutable once seen; a re-fetch of the
 * same order updates nothing.
 */
export function mergeSoldHistory(sales, existing = getSoldHistory()) {
  const next = { ...existing };
  for (const sale of sales) {
    const list = next[sale.itemId] ? [...next[sale.itemId]] : [];
    if (list.some(s => s.orderId === sale.orderId)) continue;
    list.push(sale);
    next[sale.itemId] = list;
  }
  return next;
}

const saveSoldHistory = (map) => setItem(SOLD_HISTORY_KEY, map);

async function getPrefs() { return (await getItem(PREFS_KEY)) ?? {}; }

// ── Orders ──────────────────────────────────────────────────────────────────

/**
 * Turn eBay's order payload into our sale records.
 *
 * Matching is by SKU, which IS the local item id (plan §6.1: one identifier,
 * three lives). SKUs we do not recognise are ignored on purpose — Dad may sell
 * things on this account that never went through the app, and claiming them
 * would corrupt both his earnings and his comps.
 *
 * Exported so a test can pin the shape without a network.
 */
export function extractSales(orders, knownIds) {
  const known = new Set([...knownIds].map(String));
  const sales = [];
  for (const order of orders ?? []) {
    const orderId = order?.orderId;
    const soldAt = Date.parse(order?.creationDate ?? '') || null;
    if (!orderId || !soldAt) continue;

    const lineItems = order?.lineItems ?? [];
    // eBay reports the fee per ORDER, not per line item. Splitting it evenly is
    // the only honest apportionment available when one order holds two of our
    // items — and it is exact in the common case of one.
    const orderFee = num(order?.totalMarketplaceFee?.value);
    const ours = lineItems.filter(li => known.has(String(li?.sku ?? '')));
    if (!ours.length) continue;

    for (const li of ours) {
      sales.push({
        itemId: String(li.sku),
        orderId,
        soldAt,
        soldPrice: num(li?.lineItemCost?.value ?? li?.total?.value),
        // null, not 0, when eBay did not report one — the difference between
        // "no fee" and "we don't know" decides whether Earnings estimates.
        marketplaceFee: orderFee > 0 ? orderFee / ours.length : null,
      });
    }
  }
  return sales;
}

export async function fetchSoldOrders(knownIds) {
  const since = iso(Date.now() - WINDOW_DAYS * DAY_MS);
  const orders = [];
  let offset = 0;

  // Paginate to completion. A busy 90 days can exceed one page, and a silently
  // truncated first page would look exactly like "nothing else sold".
  for (;;) {
    const filter = encodeURIComponent(`creationdate:[${since}..]`);
    const response = await authedFetch(
      `sell/fulfillment/v1/order?filter=${filter}&limit=${PAGE_LIMIT}&offset=${offset}`);
    if (!response.ok) break;
    const page = await response.json().catch(() => ({}));
    const batch = page?.orders ?? [];
    orders.push(...batch);
    offset += batch.length;
    if (batch.length < PAGE_LIMIT || offset >= num(page?.total)) break;
  }
  return extractSales(orders, knownIds);
}

// ── Offer status: how the app notices Dad published ─────────────────────────

/**
 * E2 deliberately never publishes — it creates an unpublished offer and stops.
 * So the app has no idea an item is live until it asks. A published offer
 * carries `listing.listingId`; seeing one is the signal.
 */
export async function refreshOfferStatus(entries) {
  const updates = new Map();
  for (const entry of entries) {
    if (!entry.offerId || entry.listingId) continue; // already known live
    const response = await authedFetch(`sell/inventory/v1/offer/${encodeURIComponent(entry.offerId)}`);
    if (!response.ok) continue;
    const offer = await response.json().catch(() => ({}));
    const listingId = offer?.listing?.listingId;
    if (!listingId) continue;
    // Stamp the moment we SAW it live. Days-to-sell measures from here, not
    // from sentAt: the days a draft sat unpublished in Seller Hub are not days
    // the item was for sale.
    updates.set(entry.id, { listingId: String(listingId), liveAt: Date.now(), status: 'live' });
  }
  return updates;
}

// ── Traffic ─────────────────────────────────────────────────────────────────

/** eBay returns a table (header + records), not a map. */
export function parseTrafficTable(report) {
  const keys = report?.header?.dimensionKeys ?? [];
  const metrics = (report?.header?.metrics ?? []).map(m => m?.key);
  const listingIdx = keys.findIndex(k => String(k?.key ?? k).toUpperCase().includes('LISTING'));
  const viewsIdx = metrics.findIndex(m => String(m ?? '').toUpperCase().includes('VIEWS'));
  const out = {};
  for (const record of report?.records ?? []) {
    const id = record?.dimensionValues?.[listingIdx < 0 ? 0 : listingIdx]?.value;
    const views = num(record?.metricValues?.[viewsIdx < 0 ? 0 : viewsIdx]?.value);
    if (id) out[String(id)] = { views };
  }
  return out;
}

export async function fetchTraffic(listingIds) {
  // Skip the call entirely when nothing is live — the listing_ids filter is
  // required, and an empty one is an error rather than an empty answer.
  const ids = [...new Set(listingIds.filter(Boolean).map(String))];
  if (!ids.length) return {};

  const end = Date.now();
  const start = end - (WINDOW_DAYS - 1) * DAY_MS; // eBay rejects a range over 90 days
  const day = (ms) => iso(ms).slice(0, 10).replace(/-/g, '');
  const traffic = {};

  for (let i = 0; i < ids.length; i += TRAFFIC_ID_CAP) {
    const chunk = ids.slice(i, i + TRAFFIC_ID_CAP);
    const params = new URLSearchParams({
      dimension: 'LISTING',
      filter: `marketplace_ids:{${MARKETPLACE}},listing_ids:{${chunk.join('|')}},date_range:[${day(start)}..${day(end)}]`,
      metric: 'LISTING_VIEWS_TOTAL',
    });
    const response = await authedFetch(`sell/analytics/v1/traffic_report?${params}`);
    if (!response.ok) continue;
    Object.assign(traffic, parseTrafficTable(await response.json().catch(() => ({}))));
  }
  return traffic;
}

// ── The orchestrator ────────────────────────────────────────────────────────

/**
 * @param {{ manual?: boolean }} options
 * @returns {Promise<{ connected: boolean, skipped?: boolean, sales?: number, live?: number }>}
 *
 * Not connected resolves quietly: Selling renders its local record with no nag,
 * because a man looking at his own sales history has not asked to be sold an
 * integration.
 */
export async function refreshInbound({ manual = false } = {}) {
  const prefs = await getPrefs();
  if (!manual && num(prefs.lastPullAt) > Date.now() - THROTTLE_MS) {
    return { connected: true, skipped: true };
  }

  const history = getHistory();
  if (!history.length) return { connected: true, sales: 0, live: 0 };

  let statusUpdates;
  try {
    statusUpdates = await refreshOfferStatus(history);
  } catch (e) {
    if (e?.code === 'not-connected') return { connected: false };
    throw e;
  }

  let next = history.map(e => (statusUpdates.has(e.id) ? { ...e, ...statusUpdates.get(e.id) } : e));

  const sales = await fetchSoldOrders(next.map(e => e.sku).filter(Boolean));
  if (sales.length) await saveSoldHistory(mergeSoldHistory(sales));

  const traffic = await fetchTraffic(next.map(e => e.listingId));
  if (Object.keys(traffic).length) {
    next = next.map(e => (e.listingId && traffic[e.listingId]
      ? { ...e, views: traffic[e.listingId].views }
      : e));
  }

  replaceHistory(next);
  await setItem(PREFS_KEY, { ...prefs, lastPullAt: Date.now() });
  return { connected: true, sales: sales.length, live: statusUpdates.size };
}

// ── Earnings ────────────────────────────────────────────────────────────────

/**
 * What a sale actually netted.
 *
 * Three of the four inputs are real: the sold price and eBay's own
 * `totalMarketplaceFee` come off the order, and the Goodwill price is what he
 * paid. Shipping is the item's stored figure where E2/E3-era entries have one.
 *
 * The fallback is deliberately NOT calcProfit's bare default: calling
 * `calcProfit(price, cost)` would use its $5.00 shipping assumption, which is
 * the ~$7 optimism V3 removed from the listing editor. An entry with no stored
 * shipping gets the app's own DEFAULT_SHIPPING instead.
 */
export function realizedNet(entry, sale) {
  const soldPrice = num(sale?.soldPrice);
  const goodwill = num(entry?.goodwillPrice);
  const shipping = Number.isFinite(Number(entry?.shipping))
    ? Number(entry.shipping)
    : DEFAULT_SHIPPING;

  if (sale?.marketplaceFee != null) {
    return soldPrice - num(sale.marketplaceFee) - shipping - goodwill;
  }
  // eBay reported no fee — fall back to the house estimate, explicitly with
  // the right shipping.
  return calcProfit(soldPrice, goodwill, shipping).net;
}

/** Days the item was actually for sale: from when we saw it live, else sent. */
export function daysToSell(entry, sale) {
  const soldAt = num(sale?.soldAt);
  if (!soldAt) return null;

  // A liveAt AFTER the sale means we only started watching once it had already
  // sold — the case for anyone who connects eBay with sold items already on the
  // account. That stamp measures nothing, so fall back rather than report "0
  // days", which reads as an instant sale.
  const liveAt = num(entry?.liveAt);
  const usable = liveAt && liveAt <= soldAt;
  const start = usable ? liveAt : num(entry?.sentAt);
  if (!start || start > soldAt) return null;

  return {
    days: Math.round((soldAt - start) / DAY_MS),
    // Without a usable liveAt this counts days the draft sat unpublished in
    // Seller Hub, so the row says so rather than overstating quietly.
    approx: !usable,
  };
}

export { THROTTLE_MS };
