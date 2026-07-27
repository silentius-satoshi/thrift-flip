// Direct client call to Gemini on the user's own key — no middleman, no server.
// Errors thrown from here carry a { code } and nothing else: never the key, never
// the request URL, never the raw response body.
import { GEMINI_MODEL } from '../config/gemini';
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

// The V0 doc's message shape (§5). The purchase-price line is isolated so the
// anchoring test (plan §6.2) can remove it by deleting one line: if the estimate
// moves between a $4 and a $30 stated price, the model is pricing off what the
// user pays and every verdict is circular.
export function buildUserMessage({ details, condition, goodwillPrice, compsBlock }) {
  return [
    `Notes: ${details || '(none)'}`,
    `Condition as I see it: ${condition || '(not stated)'}`,
    `Goodwill price: $${Number(goodwillPrice).toFixed(2)}`, // ANCHORING: delete this line if the test fails
    // Tier 0 comps, injected by the client rather than asked of the model
    // (vision §5). This is SOLD data — the thing §5 says to weight — and is not
    // what the anchoring rule above guards against, which is the purchase price.
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
  if (!response.ok) throw err(codeForStatus(response.status));
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

// Maps the model's schema onto the shape the verdict screen already consumes,
// so ShoppingMode stays composition. Sold-comps fields are null/empty at V1 —
// comps are model-only until V2's ladder.
function adapt(parsed, { goodwillPrice, shipping, comps }) {
  const pricing = parsed.pricing ?? {};
  const estSellPrice = Number(pricing.estimate);
  if (!Number.isFinite(estSellPrice)) throw err('bad-response');
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
    // No sold data at V1 — the Why sheet says so and links out to eBay's sold filter
    soldCount: null,
    sellThroughRate: null,
    avgDaysToSell: null,
    activeListings: null,
    recentSales: [],
    chatHistory: [{ role: 'ai', text: teaser }],
  };
}

export async function analyzeItem({ photoBase64s = [], mimeTypes = [], details, condition, goodwillPrice, shipping }) {
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

function contextLine({ details, condition, goodwillPrice } = {}) {
  return [
    'Here is the item we are talking about.',
    details ? `My notes: ${details}` : null,
    condition ? `Condition as I called it: ${condition}` : null,
    Number.isFinite(Number(goodwillPrice)) && Number(goodwillPrice) > 0
      ? `I can buy it for $${Number(goodwillPrice).toFixed(2)}.` : null,
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
