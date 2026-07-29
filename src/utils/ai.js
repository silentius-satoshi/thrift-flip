// Direct client call to Gemini on the user's own key — no middleman, no server.
// Errors thrown from here carry a { code } and nothing else: never the key, never
// the request URL, never the raw response body.
import { GEMINI_MODEL, DEFAULT_SHIPPING } from '../config/gemini';
import { SYSTEM_PROMPT, CHAT_PROMPT } from '../config/prompt';
import { RESPONSE_SCHEMA } from '../config/schema';
import { credentialStore } from './credentials';
import { calcProfit } from './calculations';
import { htmlToText } from './listingFormat';
import * as photoStore from './photoStore';
import { getComps, buildCompsBlock } from './compsProvider';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// AES-GCM ciphertext in the vault since N1-lite, not plaintext in localStorage.
// The first of these to run in a session triggers one unlock ceremony; a
// profile with no key stored returns null without prompting at all. All three
// were already async, so no call site changed shape.
const AI_KEY = 'ai-key';
export const getAiKey = () => credentialStore.get(AI_KEY);
export const setAiKey = (key) => credentialStore.set(AI_KEY, key);
export const clearAiKey = () => credentialStore.clear(AI_KEY);
export const describeAiKey = () => credentialStore.describe(AI_KEY);

function err(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

function codeForStatus(status) {
  if (status === 429) return 'quota';
  if (status === 400 || status === 401 || status === 403) return 'bad-key';
  return 'bad-response';
}

/**
 * Two different 429s wear the same status code, and telling a user to "try
 * again in a minute" when the real answer is "tomorrow" is the kind of wrong
 * diagnosis ERROR_COPY exists to prevent.
 *
 * H2 measured the daily one: free-tier keys stop at
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, **limit 20 a day**,
 * against a Saturday of ~35 items. The per-minute cap does clear on its own;
 * the daily one does not.
 *
 * Best-effort by design — the body may be HTML from a proxy, or empty. An
 * unrecognisable body keeps the generic code, because a wrong "come back
 * tomorrow" is worse than a vague "out of calls".
 *
 * Exported for the test; it never sees a key — the key rides in the URL, and
 * this only ever reads a response body.
 */
export function isDailyQuota(rawBody) {
  if (typeof rawBody !== 'string' || !rawBody) return false;
  // Match the quota id rather than the prose: Google's message text is not a
  // contract, but the quota id is the thing their docs name.
  return /PerDay/i.test(rawBody) && /quota/i.test(rawBody);
}

// The V0 doc's message shape (§5), minus the purchase price.
//
// The anchoring test ran on 2026-07-28 and FAILED: on the same photos, a stated
// $4 produced a $35.00 estimate and a stated $30 produced $55.00 — 57.1% drift
// against a 10% tolerance. The model was pricing off what the user was about to
// pay, which made every verdict circular: it would price any item at roughly 3x
// its own sticker and then congratulate you for clearing 3x. The line the test
// was written to delete is deleted.
//
// The price is still used everywhere it decides anything — calcProfit,
// checkRules, pencilFloor and usablePrice are all client-side and never see the
// model. Nothing about the verdict arithmetic changed; only what the model is
// told.
export function buildUserMessage({ details, condition, compsBlock }) {
  return [
    `Notes: ${details || '(none)'}`,
    `Condition as I see it: ${condition || '(not stated)'}`,
    // Tier 0 comps, injected by the client rather than asked of the model
    // (vision §5). This is SOLD data — what §5 says to weight — and is the one
    // price the model should see. What it must never see is what Dad is paying.
    compsBlock ? `\n${compsBlock}` : null,
  ].filter(Boolean).join('\n');
}

async function callGemini(key, body) {
  let response;
  try {
    response = await fetch(`${ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch only rejects on network failure — everything else is an HTTP status
    throw err('offline');
  }
  if (!response.ok) {
    const code = codeForStatus(response.status);
    if (code === 'quota') {
      // Read the body ONLY to tell the two 429s apart, and only on a path that
      // is already failing. It carries no key — the key travels in the URL.
      const raw = await response.text().catch(() => '');
      if (isDailyQuota(raw)) throw err('quota-daily');
    }
    throw err(code);
  }
  return response;
}

function readJsonPart(data) {
  if (data?.promptFeedback?.blockReason) throw err('bad-response');
  const candidate = data?.candidates?.[0];
  if (!candidate) throw err('bad-response');
  // MAX_TOKENS truncates mid-JSON — parseable-looking but never complete
  if (candidate.finishReason && candidate.finishReason !== 'STOP') throw err('bad-response');
  const text = candidate.content?.parts?.map(p => p.text).filter(Boolean).join('') ?? '';
  if (!text.trim()) throw err('bad-response');
  try {
    return JSON.parse(text);
  } catch {
    throw err('bad-response');
  }
}

// A shipping cost the model estimated, made safe to spend money against.
//
// M2 moved this number off the capture screen — standing in an aisle holding an
// unweighed object, Dad cannot know it, and a wrong guess there moves the buy
// decision. The clamp is the whole guard: a hallucinated 0 would make every
// item look profitable, and a hallucinated 900 would make every item a skip.
// Outside [4, 100] the model is not estimating postage, so its number is
// discarded rather than trusted at the boundary.
export const SHIPPING_MIN = 4;
export const SHIPPING_MAX = 100;

export function resolveShipping(pricing, fallback = DEFAULT_SHIPPING) {
  const raw = pricing?.shipping_estimate;
  // Number(null) and Number('') are both 0 — which would clamp to the floor and
  // read on screen as a real $4 estimate, the cheapest possible, flattering
  // every verdict. An absent figure has to stay absent, so the shape is checked
  // before the value is coerced.
  if (typeof raw !== 'number' && (typeof raw !== 'string' || raw.trim() === '')) return fallback;
  const estimate = Number(raw);
  if (!Number.isFinite(estimate)) return fallback;
  return Math.min(SHIPPING_MAX, Math.max(SHIPPING_MIN, estimate));
}

// Maps the model's schema onto the shape the verdict screen already consumes,
// so ShoppingMode stays composition. Sold-comps fields are null/empty at V1 —
// comps are model-only until V2's ladder.
function adapt(parsed, { goodwillPrice, shipping, comps }) {
  const pricing = parsed.pricing ?? {};
  const estSellPrice = Number(pricing.estimate);
  if (!Number.isFinite(estSellPrice)) throw err('bad-response');
  // Whose number this is has to travel with it. adapt() always produces a
  // shipping figure, so its presence proves nothing — and a house default shown
  // as "AI estimate" is the exact dishonesty the label exists to prevent.
  const modelShipping = resolveShipping(pricing, null);
  shipping = modelShipping ?? shipping;
  const { ebayFee, net } = calcProfit(estSellPrice, goodwillPrice, shipping);
  const confidence = pricing.confidence ?? 'low';
  const rationale = pricing.rationale ?? '';
  const identification = parsed.identification ?? {};
  const teaser = rationale
    || identification.name
    || 'Estimate is in — open the chat for the reasoning.';

  return {
    estSellPrice,
    fees: ebayFee,
    shipping,
    // False for anything analyzed before M2's schema, so those keep the plain label.
    shippingFromModel: modelShipping !== null,
    netProfit: net,
    priceRange: [Number(pricing.range_low), Number(pricing.range_high)],
    confidence,
    rationale,
    identification,
    conditionRead: parsed.condition_read ?? null,
    listing: parsed.listing ?? null,       // the eBay register — seeds the editor at V1.5
    listingMercari: parsed.listing_mercari ?? null, // the Mercari register — copy-assist lane
    strategy: parsed.strategy ?? null,
    source: 'model',
    // Only set when tier 0 actually informed the request, so the verdict can
    // say "via your own sales" exactly when that is true (vision §4).
    compsSource: comps ? comps.source : null,
    comps: comps ?? null,
    // Tier A lands after this returns — the verdict never waits on it (V2).
    // Declared here so the persisted shape is the same before and after, and
    // `modelEstimate` survives a repricing as the thing to compare against.
    soldComps: null,
    modelEstimate: estSellPrice,
    // No sold data at V1 — the Why sheet says so and links out to eBay's sold filter
    soldCount: null,
    sellThroughRate: null,
    avgDaysToSell: null,
    activeListings: null,
    recentSales: [],
    chatHistory: [{ role: 'ai', text: teaser }],
  };
}

export async function analyzeItem({
  photoBase64s = [], mimeTypes = [], details, condition, goodwillPrice,
  // Only reached when the model returns no usable shipping_estimate — since M2
  // there is no field on the capture screen for a caller to pass instead.
  shipping = DEFAULT_SHIPPING,
}) {
  const key = await getAiKey();
  if (!key) throw err('no-key');

  // Matched on the user's OWN note, not on `identification` — the model's read
  // does not exist until this request comes back, and a two-pass analyze to get
  // it would double the cost of every verdict. The note is what Dad typed, and
  // it is the best identification available at request time.
  let comps;
  try { comps = getComps({ name: details }); } catch { comps = null; }

  const parts = photoBase64s.map((data, i) => ({
    inline_data: { mime_type: mimeTypes[i] || 'image/jpeg', data },
  }));
  parts.push({ text: buildUserMessage({ details, condition, goodwillPrice, compsBlock: buildCompsBlock(comps) }) });

  const response = await callGemini(key, {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw err('bad-response');
  }
  return adapt(readJsonPart(data), { goodwillPrice, shipping, comps });
}

// Minimal live round-trip for the Settings paste flow. Any HTTP 200 means the
// key works — the 5-token cap can legitimately return no text, and failing on
// that would report a good key as bad.
export async function verifyKey(key) {
  if (!key) return { ok: false, code: 'no-key' };
  try {
    const response = await fetch(`${ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
    });
    if (response.ok) return { ok: true };
    return { ok: false, code: codeForStatus(response.status) };
  } catch {
    return { ok: false, code: 'offline' };
  }
}

// ── Chat (V3) ───────────────────────────────────────────────────────────────

const PHOTO_PART = (p) => ({ inline_data: { mime_type: p.mimeType || 'image/jpeg', data: p.base64 } });

function contextLine({ details, condition, goodwillPrice, soldComps } = {}) {
  return [
    'Here is the item we are talking about.',
    details ? `My notes: ${details}` : null,
    condition ? `Condition as I called it: ${condition}` : null,
    Number.isFinite(Number(goodwillPrice)) && Number(goodwillPrice) > 0
      ? `I can buy it for $${Number(goodwillPrice).toFixed(2)}.` : null,
    // V2: the sold data that repriced the item, so Flip can defend the number
    // on screen instead of re-estimating it and contradicting the verdict.
    // Real sales only — the analyze path still never learns the purchase price.
    Number.isFinite(soldComps?.median) && soldComps?.count
      ? `Recent eBay sold prices for this: median $${soldComps.median.toFixed(2)} `
        + `across ${soldComps.count} sale${soldComps.count === 1 ? '' : 's'}`
        + `${soldComps.windowDays ? ` in the last ${soldComps.windowDays} days` : ''}. `
        + 'That is where the app\'s price came from.'
      : null,
  ].filter(Boolean).join('\n');
}

/**
 * Gemini has no server-side session, so "keeps the images in context across the
 * conversation" (vision §2) means re-sending them. They ride the FIRST turn,
 * which by construction is a synthetic user turn carrying the item context —
 * the stored history opens with the model's teaser, and `contents` may not
 * start with a model turn.
 *
 * Exported so a test can pin the ordering without a network.
 */
export function buildChatContents({ photos = [], chatHistory = [], message, itemContext }) {
  const opening = [...photos.map(PHOTO_PART), { text: contextLine(itemContext) }];

  // With no history there is nothing to interleave, so the question joins the
  // opening turn rather than making two user turns in a row.
  if (!chatHistory.length) {
    return [{ role: 'user', parts: [...opening, { text: message }] }];
  }

  return [
    { role: 'user', parts: opening },
    ...chatHistory
      .filter(m => m?.text)
      .map(m => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
}

async function callText(key, { contents, system, maxOutputTokens, temperature }) {
  const response = await callGemini(key, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature, maxOutputTokens },
  });
  let data;
  try { data = await response.json(); } catch { throw err('bad-response'); }
  if (data?.promptFeedback?.blockReason) throw err('bad-response');
  const candidate = data?.candidates?.[0];
  if (!candidate) throw err('bad-response');
  const text = candidate.content?.parts?.map(p => p.text).filter(Boolean).join('') ?? '';
  if (!text.trim()) throw err('bad-response');
  return text.trim();
}

/**
 * The advisor turn. Photos come from the item's own store; a conversation from
 * before V3 has none, and degrades to text-only rather than failing — it is
 * still a better answer than the mock's random paragraph.
 */
export async function sendChatMessage({ itemId, message, chatHistory = [], itemContext }) {
  const key = await getAiKey();
  if (!key) throw err('no-key');

  let photos;
  try { photos = await photoStore.get(itemId); } catch { photos = []; }

  const text = await callText(key, {
    contents: buildChatContents({ photos, chatHistory, message, itemContext }),
    system: CHAT_PROMPT,
    temperature: 0.4,
    maxOutputTokens: 500,
  });
  return { text };
}

// ── Listing generation for a pencil item (V3) ───────────────────────────────

/**
 * A pencil item was never analyzed — it has a floor, not a price. This runs the
 * real analysis and seeds the editor from it.
 *
 * The price is the MODEL's estimate, not `item.estSellPrice`, which for a
 * pencil item is the floor: the minimum clearing 3× and $20, never a market
 * value. The floor governed the buy; the market governs the listing. It rides
 * back as `pencilFloor` so the editor can show it, and is deliberately NOT a
 * clamp — an estimate below the floor means the buy did not work out, and the
 * editor's rule checks are where that shows.
 */
export async function generateListing(item) {
  let stored;
  try { stored = await photoStore.get(item?.id); } catch { stored = []; }

  const result = await analyzeItem({
    photoBase64s: stored.map(p => p.base64),
    mimeTypes: stored.map(p => p.mimeType),
    details: item?.name ?? '',
    condition: item?.condition ?? '',
    goodwillPrice: item?.goodwillPrice ?? 0,
    shipping: item?.shipping,
  });

  const listing = result.listing ?? {};
  return {
    title: listing.title || item?.name || '',
    description: htmlToText(listing.description_html || ''),
    condition: item?.condition || 'Good',
    price: result.estSellPrice,
    specifics: listing.item_specifics ?? {},
    conditionDescription: listing.condition_description || '',
    // What Dad reasoned to at the shelf, for the editor's sub-line.
    pencilFloor: item?.estSellPrice ?? null,
    listingMercari: result.listingMercari ?? null,
  };
}

// ── Field regeneration (V3) ─────────────────────────────────────────────────

const REGEN_OPS = {
  'title': 'Rewrite the eBay title. 80 characters or fewer, brand first, keyword-dense, no filler like "Rare" or "L@@K". Reply with the title alone — no quotes, no explanation.',
  'description-rewrite': 'Rewrite this eBay description. Keep every fact, change the wording. Plain text, no HTML. Reply with the description alone.',
  'description-shorter': 'Shorten this eBay description. Keep every fact that affects what a buyer receives; cut the padding. Plain text. Reply with the description alone.',
  'description-longer': 'Expand this eBay description with detail a buyer would actually want — measurements, materials, condition specifics — but invent nothing that is not in the photos or the text. Plain text. Reply with the description alone.',
};

export async function regenerateField({ field, currentValue, context }) {
  const instruction = REGEN_OPS[field];
  if (!instruction) throw err('bad-request');

  const key = await getAiKey();
  if (!key) throw err('no-key');

  const text = await callText(key, {
    contents: [{
      role: 'user',
      parts: [{
        text: [
          instruction,
          context ? `\nThe item: ${context}` : '',
          `\nCurrent text:\n${currentValue || '(empty)'}`,
        ].join('\n'),
      }],
    }],
    system: CHAT_PROMPT,
    temperature: 0.7,
    maxOutputTokens: 300,
  });
  return { value: text };
}

export const __regenOps = REGEN_OPS;
