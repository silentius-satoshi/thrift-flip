// Sell/Taxonomy API relay (ebay-connect §3 — step E2).
//
// eBay's REST APIs serve no CORS headers, so a browser cannot call them at all.
// This forwards a fixed set of paths and nothing else. Stateless: no database,
// no KV, and NOT ONE console statement that receives a body, a token, or a
// secret — a relay that logs a token has failed its only invariant.
//
// The user's own access token rides through in the Authorization header; this
// relay never mints, stores or inspects it.
import { authorized, ebayApiHost } from '../_lib/relayAuth.js';

// An allowlist, not an open proxy. Anything outside these four families is
// refused before a byte leaves the machine, so a leaked RELAY_SECRET buys
// reach into eBay's listing surface only — not the whole API.
const ALLOWED = [
  /^sell\/inventory\/v1\/inventory_item\/[^/]+$/,   // createOrReplaceInventoryItem
  // create (POST offer) / update (PUT offer/{id}) / list (GET offer?sku=).
  // Deliberately no sub-path, which means `offer/{id}/publish` is refused:
  // E2 never publishes, and the relay should not be able to either.
  /^sell\/inventory\/v1\/offer(\/[^/]+)?$/,
  /^sell\/account\/v1\/[a-z_]*policy[a-z_]*$/,      // fulfillment / payment / return policies
  /^commerce\/taxonomy\/v1\/.+$/,                   // category tree + suggestions
  // E3, inbound. Read-only by nature: getOrders reports sales, the traffic
  // report reports views. Neither can change anything on the account.
  /^sell\/fulfillment\/v1\/order(\/[^/]+)?$/,       // getOrders / getOrder
  /^sell\/analytics\/v1\/traffic_report$/,          // getTrafficReport
];

/**
 * @param {string} target path relative to the API host, query string included
 * @returns {boolean}
 *
 * Pure and exported so a test can pin it. Rejects traversal and absolute URLs
 * outright rather than relying on the patterns above to be airtight.
 */
export function isAllowedPath(target) {
  if (typeof target !== 'string' || !target) return false;
  if (target.startsWith('/') || target.includes('://')) return false;
  const path = target.split('?')[0];
  // Traversal is checked on the PATH only. eBay's own date-range filter syntax
  // is `creationdate:[2026-04-28T00:00:00.000Z..]` — a literal `..` in the
  // query string — so rejecting it everywhere would 403 every getOrders call
  // while looking like an allowlist miss.
  if (path.includes('..')) return false;
  return ALLOWED.some(rule => rule.test(path));
}

const FORWARD_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

export default async function handler(req, res) {
  if (!FORWARD_METHODS.has(req.method)) {
    res.setHeader('Allow', [...FORWARD_METHODS].join(', '));
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const url = new URL(req.url, 'https://placeholder.invalid');
  const target = url.searchParams.get('path');
  if (!isAllowedPath(target)) return res.status(403).json({ error: 'path_not_allowed' });

  // Two credentials travel on one request and must not collide: `Authorization`
  // is the relay's own bearer gate (checked above), so the user's eBay token
  // rides in its own header and is copied into Authorization only here, on the
  // way out. It is never read, logged or stored.
  const ebayToken = req.headers['x-ebay-authorization'];
  if (!ebayToken) return res.status(400).json({ error: 'missing_ebay_token' });

  const headers = {
    Authorization: ebayToken,
    Accept: 'application/json',
  };
  // NOT optional, and the reason this relay forwards more than the token:
  // createOrReplaceInventoryItem rejects a request without Content-Language,
  // with a message that says nothing about a relay having dropped it.
  if (req.headers['content-language']) headers['Content-Language'] = req.headers['content-language'];

  let body;
  if (req.method !== 'GET' && req.body !== undefined && req.body !== null) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    headers['Content-Type'] = 'application/json';
  }

  let upstream;
  try {
    upstream = await fetch(`${ebayApiHost(process.env.EBAY_ENV)}/${target}`, {
      method: req.method,
      headers,
      body,
    });
  } catch {
    // No cause, no message — an upstream error string can echo request content.
    return res.status(502).json({ error: 'upstream_unreachable' });
  }

  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', 'application/json');
  // eBay's own body, verbatim, including its errors[] array — ebaySell.js maps
  // those onto editor fields, so swallowing or rewording them here would blind
  // the only thing that can explain a validation failure to a human.
  return res.send(text || '{}');
}
