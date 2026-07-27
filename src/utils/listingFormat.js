// Shaping listing data for humans: the model returns eBay's description as HTML,
// but the editor is a plain textarea and the clipboard packages are plain text.

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

// Deliberately not DOMParser: this runs in the browser and in Node (tests), and
// the input is our own model's HTML, not untrusted markup.
export function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const section = (label, body) => (body ? `${label}\n${body}` : null);

// Labeled sections, because eBay's Sell flow and Mercari's form both have
// separate inputs — on a phone you need something to orient by while pulling
// one field at a time out of the paste.
export function buildEbayPackage({ title, price, condition, specifics, description }) {
  const specLines = Object.entries(specifics ?? {})
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return [
    section('TITLE', title),
    section('PRICE', price ? `$${Number(price).toFixed(2)}` : ''),
    section('CONDITION', condition),
    section('ITEM SPECIFICS', specLines),
    section('DESCRIPTION', description),
  ].filter(Boolean).join('\n\n');
}

export function buildMercariPackage(mercari) {
  if (!mercari) return '';
  const hashtags = Array.isArray(mercari.hashtags) ? mercari.hashtags.join(' ') : '';
  return [
    section('TITLE', mercari.title),
    section('PRICE', Number.isFinite(Number(mercari.suggested_price))
      ? `$${Number(mercari.suggested_price).toFixed(2)}`
      : ''),
    section('DESCRIPTION', mercari.description),
    section('HASHTAGS', hashtags),
  ].filter(Boolean).join('\n\n');
}
