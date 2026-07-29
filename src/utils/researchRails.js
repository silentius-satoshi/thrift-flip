// The manual sold rails (B1-lite).
//
// V2 built the comps ladder and found nothing to put through it: eBay gates
// sold search, SerpApi's scraper does not get through, Marketplace Insights is
// gated, the Buy APIs are EPN-gated in production and Finding/Shopping are
// retired. There is no compliant automated marketplace pricing data available
// to an individual seller.
//
// The data itself is not the problem — eBay's Product Research gives every
// seller three years of solds including accepted Best-Offer prices, free. Only
// the DELIVERY is closed: on mobile it lives in the native app, with no
// published deep link. So this file stops trying to fetch sold data and instead
// shortens the walk to it — the query, ready to paste, and the two URLs that do
// work in a browser.
import { compsQuery } from './soldComps';

/**
 * The one string behind every rail, on both screens.
 *
 * `compsQuery` already strips the thrift filler that matches everything and
 * keeps hyphenated model numbers, which are the most identifying part of any
 * search. The fallback matters: for a pencil item or a thin identification it
 * returns null, and Dad's own typed note is then the best description of the
 * item that exists.
 *
 * Deliberately shared with the sold-filter link, which used to send the whole
 * generated listing title. A 60-character title is a narrow search on eBay's
 * sold filter, and two adjacent buttons must never disagree about what the item
 * is.
 *
 * @returns {string} may be empty — every caller here treats that as "no rail"
 */
export function researchQuery({ identification, listingTitle, note } = {}) {
  const normalized = compsQuery({ identification, listingTitle });
  if (normalized) return normalized;
  return String(listingTitle || note || '').trim();
}

/**
 * eBay's sold + completed filter. Works in any browser, signed in or not, which
 * is why it stays the always-there floor under everything else here.
 */
export function soldSearchUrl(query) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`
    + '&LH_Sold=1&LH_Complete=1';
}

/**
 * Product Research (ex-Terapeak) on the web.
 *
 * Measured 2026-07-29 with an iPhone user agent: this 302s to eBay sign-in and
 * preserves the keywords intact in the return URL, so it does not dead-end —
 * but the destination is a desktop surface and the label has to say so. A
 * sign-in wall that was expected reads as a sign-in wall; an unexpected one
 * reads as broken software.
 */
export function productResearchUrl(query) {
  return `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}`;
}

// The four steps, in the order his thumb performs them. Exported so the test
// and both screens quote the same string rather than drifting apart.
export const RESEARCH_STEPS = 'Copied — eBay app → Selling → Product Research → paste.';

/**
 * Put text on the clipboard, or report honestly that it could not.
 *
 * Two reasons this is not a one-liner. `navigator.clipboard` is undefined
 * outside a secure context — which includes a phone reaching a dev server over
 * plain http on the LAN, exactly how this gets demoed. And Safari rejects the
 * write outright if the promise does not settle inside the user gesture, which
 * is why every caller must `await` this BEFORE any `window.open`.
 *
 * @returns {Promise<boolean>} never throws — a failed copy is a message, not a
 *   crash, and the fallback is always "long-press and copy it yourself".
 */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through: a rejected promise here is usually a permissions policy or
    // a lost gesture, and execCommand sometimes still works when it happens.
  }

  // Deprecated, and the only thing that works on http:// or older WebKit.
  try {
    const el = document.createElement('textarea');
    el.value = value;
    // Off-screen rather than hidden — a display:none element cannot be selected,
    // and readOnly stops the keyboard opening for the instant it is focused.
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(el);
    return Boolean(copied);
  } catch {
    return false;
  }
}
