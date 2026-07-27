// Direct client call to Gemini on the user's own key — no middleman, no server.
// Errors thrown from here carry a { code } and nothing else: never the key, never
// the request URL, never the raw response body.
import { GEMINI_MODEL } from '../config/gemini';
import { SYSTEM_PROMPT } from '../config/prompt';
import { RESPONSE_SCHEMA } from '../config/schema';
import { credentialStore } from './credentials';
import { calcProfit } from './calculations';

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
export function buildUserMessage({ details, condition, goodwillPrice }) {
  return [
    `Notes: ${details || '(none)'}`,
    `Condition as I see it: ${condition || '(not stated)'}`,
    `Goodwill price: $${Number(goodwillPrice).toFixed(2)}`, // ANCHORING: delete this line if the test fails
  ].join('\n');
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
function adapt(parsed, { goodwillPrice, shipping }) {
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

  const parts = photoBase64s.map((data, i) => ({
    inline_data: { mime_type: mimeTypes[i] || 'image/jpeg', data },
  }));
  parts.push({ text: buildUserMessage({ details, condition, goodwillPrice }) });

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
  return adapt(readJsonPart(data), { goodwillPrice, shipping });
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
