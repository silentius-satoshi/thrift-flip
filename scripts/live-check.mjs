// Runs the automatable half of docs/v1-live-check-runbook.md against labeled
// fixtures, and the grounded-vs-ungrounded pricing experiment that decides
// whether Google Search grounding replaces SerpApi as comps tier A (plan §6).
//
//   GEMINI_KEY=... SERPAPI_KEY=... node scripts/live-check.mjs --anchor=mug
//
// Keys come from the environment only — never a file, never a commit. The
// ungrounded arm calls the app's own analyzeItem so the benchmark cannot drift
// from production; the grounded arm builds its own request (analyzeItem's
// generationConfig is a closed literal) but imports the same prompt, schema and
// model constants, so the only variable between arms is the search tool.
import { registerHooks } from 'node:module';
import { readdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'fixtures', 'live');
const OUT = join(ROOT, 'docs', 'live-check-results.md');

const CORE_SLUGS = ['sneaker', 'book', 'tool', 'mug', 'electronics'];
const CORE_GATE = 4;
const GAP_MS = 2000;
const ANCHOR_LOW = 4;
const ANCHOR_HIGH = 30;
// H2: the fixed 10% tolerance is retired. D1 measured a ~29% spread between two
// byte-identical prompts, so any threshold below the model's own noise floor
// answers a question it cannot hear. The floor is now measured per run.
const ANCHOR_PAIRS = 3;
// Both arms carry notes, so control and anchored differ by exactly one thing:
// whether a price appears. A control on an empty prompt would measure the noise
// floor of a different prompt shape than the one under test.
const ANCHOR_CONTEXT = 'found this at a thrift store';
const anchorNotes = (price) => (price === null
  ? ANCHOR_CONTEXT
  : `${ANCHOR_CONTEXT}, paying $${price} for it`);
// No fixture encodes what it cost. §2 of the deep-dive says Gemini assumed
// $1.99-$3.99 for price-less turns; this sits just above that.
const FIXTURE_COST = 4.99;
const VARIANCE_DEFAULT = 5;
// Measured from the refusal itself on 2026-07-28, not from documentation:
//   quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue 20.
// H2 planned 47 calls against this and died at the fourth. A preflight that
// prints a number nothing is compared against is decoration.
const FREE_TIER_DAILY = 20;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const GEMINI_KEY = process.env.GEMINI_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

const CONVENTION = `
Fixtures go in fixtures/live/ (gitignored), named:

  <slug>__<expected-brand>-<expected-model>__<n>.jpg

    sneaker__nike-airmax90__1.jpg
    sneaker__nike-airmax90__2.jpg
    book__penguin-1984__1.jpg

Up to 3 photos per slug. The core five for the gate: ${CORE_SLUGS.join(', ')}.
The brand and model between the double underscores are the answer key — the
harness scores identification.brand / identification.model against them.
`.trim();

// ── Node compatibility ──────────────────────────────────────────────────────
// src/ uses extensionless imports, which Vite resolves and Node does not.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !extname(spec)) return next(`${spec}.js`, ctx);
      throw e;
    }
  },
});

// src/ reads localStorage, which Node only provides behind a flag that writes a
// file to disk. Nothing here may touch one, so the shim stays in memory.
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, v),
  removeItem: (k) => memory.delete(k),
};

const { analyzeItem } = await import(join(ROOT, 'src/utils/ai.js'));

// Since N1-lite the key lives in the vault, and unwrapping it needs a ceremony
// no headless script can perform. primeSession puts the env key straight into
// the session cache instead: nothing is wrapped, nothing is persisted, and
// lib/vault.js is on its in-memory backend here anyway because Node has no
// IndexedDB. Same env-only hygiene as before — the key never reaches disk.
const { primeSession } = await import(join(ROOT, 'src/utils/credentials.js'));
if (GEMINI_KEY) primeSession('ai-key', GEMINI_KEY);

const { GEMINI_MODEL, DEFAULT_SHIPPING } = await import(join(ROOT, 'src/config/gemini.js'));
// The app's own floor — the inversion of the 3x and $20 rules. A verdict flip is
// an estimate crossing it, so the harness must use the real one, not a copy.
const { pencilFloor } = await import(join(ROOT, 'src/utils/calculations.js'));
const { SYSTEM_PROMPT } = await import(join(ROOT, 'src/config/prompt.js'));
const { RESPONSE_SCHEMA } = await import(join(ROOT, 'src/config/schema.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : '—');

// Belt and braces: nothing that reaches stdout or the results file may carry key
// material, even if an upstream error body echoed it back.
function scrub(text) {
  let out = String(text);
  for (const key of [GEMINI_KEY, SERPAPI_KEY]) {
    if (key) out = out.split(key).join('«redacted»');
  }
  return out;
}

function say(...parts) {
  console.log(scrub(parts.join(' ')));
}

// ── The wire tap ────────────────────────────────────────────────────────────
// `analyzeItem` throws `{ code }` and nothing else — deliberately, because a
// user in an aisle cannot act on the difference between a safety block and a
// token ceiling. The harness needs that difference, and re-issuing the request
// would both double the spend and might not reproduce. So it watches the wire
// production already uses: the body is read once, recorded, and handed back as
// an identical Response. Nothing in src/ changes, and the arm stays the
// production path this file's header promises.
//
// It never records the URL. That carries `?key=`.
const wire = { last: null };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? '');
  const response = await realFetch(input, init);
  if (!url.includes('generativelanguage.googleapis.com')) return response;
  const raw = await response.text();
  wire.last = { status: response.status, raw };
  return new Response(raw, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

// What the collapsed `bad-response` was actually hiding. Everything here reaches
// the report through scrub(), and the raw excerpt is capped.
function diagnose(slot) {
  if (!slot) return { note: 'no response reached the wire (network or thrown before send)' };
  const { status, raw } = slot;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* the malformed case is itself the finding */ }
  const candidate = parsed?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
  const usage = parsed?.usageMetadata ?? {};
  // H2 lesson: a 200-char excerpt truncated the single most useful field of the
  // whole mission — WHICH quota. The refusal names it precisely, so pull it out
  // rather than hoping it lands inside the excerpt window.
  const violation = parsed?.error?.details
    ?.find((d) => d['@type']?.endsWith('QuotaFailure'))?.violations?.[0];
  const isError = Boolean(parsed?.error) || status >= 400;
  return {
    quotaId: violation?.quotaId ?? null,
    quotaValue: violation?.quotaValue ?? null,
    quotaModel: violation?.quotaDimensions?.model ?? null,
    errorMessage: parsed?.error?.message ?? null,
    status,
    finishReason: candidate?.finishReason ?? null,
    blockReason: parsed?.promptFeedback?.blockReason ?? null,
    envelopeParsed: parsed !== null,
    rawLength: raw.length,
    textLength: text.length,
    // thoughtsTokenCount is the field that separates "thinking ate the
    // allowance" from "the output was genuinely long".
    promptTokens: usage.promptTokenCount ?? null,
    thoughtsTokens: usage.thoughtsTokenCount ?? null,
    candidatesTokens: usage.candidatesTokenCount ?? null,
    totalTokens: usage.totalTokenCount ?? null,
    // Error envelopes get room to explain themselves; successful bodies do not
    // need it, and a schema-shaped response would swamp the appendix.
    excerpt: (text || raw).slice(0, isError ? 900 : 200),
    textTail: text ? text.slice(-80) : null,
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────
function loadFixtures() {
  if (!existsSync(FIXTURES)) return [];
  const bySlug = new Map();
  for (const file of readdirSync(FIXTURES).sort()) {
    const ext = extname(file).toLowerCase();
    if (!MIME[ext]) continue;
    const [slug, labels] = file.slice(0, -ext.length).split('__');
    if (!slug || !labels) continue;
    const [brand, ...modelParts] = labels.split('-');
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { slug, brand, model: modelParts.join('-'), photos: [] });
    }
    const item = bySlug.get(slug);
    if (item.photos.length >= 3) continue;
    item.photos.push({
      base64: readFileSync(join(FIXTURES, file)).toString('base64'),
      mimeType: MIME[ext],
    });
  }
  return [...bySlug.values()];
}

// v0 §6: ID correct is brand + model. Brand right, model wrong = partial.
// Neither field is required by the schema, so both can be undefined.
function scoreId(item, identification) {
  const haystack = [identification?.brand, identification?.model, identification?.name]
    .filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const brandHit = !!item.brand && haystack.includes(norm(item.brand));
  const modelHit = !!item.model && haystack.includes(norm(item.model));
  if (brandHit && modelHit) return 'correct';
  if (brandHit || modelHit) return 'partial';
  return 'wrong';
}

// ── Arm 1: the production path, unmodified ──────────────────────────────────
// A failure here is a V1 bug, not a harness bug: this is the first time the
// production request shape meets the live API (V1 verified against a stub).
// It deliberately does not fall back to any other body shape.
async function runUngrounded(item, goodwillPrice = 8, details = '') {
  wire.last = null;
  try {
    const result = await analyzeItem({
      photoBase64s: item.photos.map((p) => p.base64),
      mimeTypes: item.photos.map((p) => p.mimeType),
      details,
      condition: '',
      goodwillPrice,
      shipping: DEFAULT_SHIPPING,
    });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, code: e?.code ?? 'unknown', diag: diagnose(wire.last) };
  }
}

// `quota` and `bad-key` are account state — a second identical request spends
// wall-clock to be told the same thing. Only the codes that could plausibly be
// transient are worth a retry, and whether they repeat IS the diagnosis.
const RETRYABLE = new Set(['bad-response', 'offline', 'unknown']);

async function attempt(run, label) {
  const attempts = [];
  for (let i = 0; i < 2; i++) {
    const outcome = await run();
    attempts.push(outcome);
    if (outcome.ok || !RETRYABLE.has(outcome.code)) break;
    if (i === 0) {
      say(`  ↻ ${label} failed \`${outcome.code}\` — one retry`);
      await sleep(GAP_MS);
    }
  }
  // The last attempt is the answer; every attempt is the evidence.
  return { ...attempts.at(-1), attempts };
}

// ── The variance meter (H2) ─────────────────────────────────────────────────
// D1 found ~29% between two byte-identical prompts at temperature 0, on one
// pair, on one fixture. Before that drives multi-sampling or comps overrides it
// needs a distribution — and the number that decides anything is not the spread
// but whether the spread crosses the floor.
//
// Samples are NOT retried. A failed call is data: 25 near-identical requests
// also measure how often `bad-response` actually happens, which is the question
// D1 could not answer from one clean re-run.
const median = (xs) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function runVariance(item, k) {
  const runs = [];
  for (let i = 0; i < k; i++) {
    runs.push(await runUngrounded(item));
    if (i < k - 1) await sleep(GAP_MS);
  }
  return runs;
}

function varianceStats(item, runs) {
  const ok = runs.filter((r) => r.ok);
  const estimates = ok.map((r) => r.result.estSellPrice);
  const shippings = ok.map((r) => r.result.shipping);
  const med = median(estimates);
  // The floor is computed per run from THAT run's shipping, because that is what
  // the app would have done with that response. A single median floor would hide
  // that shipping is itself a noisy input.
  const calls = ok.map((r) => {
    const floor = pencilFloor(FIXTURE_COST, r.result.shipping);
    return { estimate: r.result.estSellPrice, shipping: r.result.shipping, floor,
             verdict: r.result.estSellPrice >= floor ? 'BUY' : 'LEAVE' };
  });
  const verdicts = [...new Set(calls.map((c) => c.verdict))];
  const idScores = ok.map((r) => scoreId(item, r.result.identification));
  const idAgreed = idScores.filter((v) => v === idScores[0]).length;
  return {
    slug: item.slug,
    k: runs.length,
    failures: runs.length - ok.length,
    codes: [...new Set(runs.filter((r) => !r.ok).map((r) => r.code))],
    estimates,
    median: med,
    min: estimates.length ? Math.min(...estimates) : null,
    max: estimates.length ? Math.max(...estimates) : null,
    spread: med ? (Math.max(...estimates) - Math.min(...estimates)) / med : null,
    shippingMin: shippings.length ? Math.min(...shippings) : null,
    shippingMax: shippings.length ? Math.max(...shippings) : null,
    calls,
    stable: verdicts.length === 1,
    verdict: verdicts.length === 1 ? verdicts[0] : 'SPLIT',
    idScores,
    idStable: idScores.length > 0 && idAgreed === idScores.length,
  };
}

// ── Arm 2: same call plus the search tool ───────────────────────────────────
// Structured output + Google Search grounding combine in one request as of
// Gemini 3 (2025-11-25), and gemini-3.6-flash is on that allowlist.
// groundingChunks come back empty under structured output, so the only way to
// see which pages it read is to make the model put them in the JSON.
function groundedSchema() {
  const schema = structuredClone(RESPONSE_SCHEMA);
  schema.properties.sources = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: { url: { type: 'STRING' }, title: { type: 'STRING' } },
      required: ['url', 'title'],
    },
  };
  schema.required = [...schema.required, 'sources'];
  return schema;
}

function groundedBody(item, goodwillPrice, shape) {
  const parts = item.photos.map((p) => ({
    inline_data: { mime_type: p.mimeType, data: p.base64 },
  }));
  parts.push({
    text: [
      `Notes: (none)`,
      `Condition as I see it: (not stated)`,
      `Goodwill price: $${Number(goodwillPrice).toFixed(2)}`,
      '',
      'Search eBay sold listings for this exact item before pricing it, and put the',
      'pages you used in sources.',
    ].join('\n'),
  });
  const schema = groundedSchema();
  const generationConfig = shape === 'responseFormat'
    ? { temperature: 0, responseFormat: { text: { mimeType: 'application/json', schema } } }
    : { temperature: 0, responseMimeType: 'application/json', responseSchema: schema };
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    tools: [{ google_search: {} }],
    generationConfig,
  };
}

async function postGemini(body) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  return response;
}

async function runGrounded(item, goodwillPrice = 8) {
  wire.last = null;
  if (!GEMINI_KEY) return { ok: false, code: 'no-key' };
  // Production's generationConfig shape first, so the arms differ by one thing.
  // Current docs moved to responseFormat; the older fields are still in the API
  // reference undeprecated, so try production's and fall back once.
  for (const shape of ['responseSchema', 'responseFormat']) {
    let response;
    try {
      response = await postGemini(groundedBody(item, goodwillPrice, shape));
    } catch {
      return { ok: false, code: 'offline', diag: diagnose(wire.last) };
    }
    if (response.status === 400 && shape === 'responseSchema') continue; // try the newer shape
    if (!response.ok) {
      const code = response.status === 429 ? 'quota'
        : [400, 401, 403].includes(response.status) ? 'bad-key'
          : 'bad-response';
      return { ok: false, code, status: response.status, diag: diagnose(wire.last) };
    }
    let data;
    try {
      data = await response.json();
    } catch {
      return { ok: false, code: 'bad-response', diag: diagnose(wire.last) };
    }
    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, code: 'bad-response', shape, diag: diagnose(wire.last) };
    }
    // webSearchQueries is also the billing unit — one request can run several.
    const queries = candidate?.groundingMetadata?.webSearchQueries ?? [];
    return { ok: true, parsed, queries, sources: parsed.sources ?? [], shape };
  }
  return { ok: false, code: 'bad-response', diag: diagnose(wire.last) };
}

// ── SerpApi sold-price ground truth ─────────────────────────────────────────
// LH_Sold / LH_Complete are eBay's own URL params and are NOT SerpApi
// parameters — passing them would silently return active asking prices.
// show_only=Sold,Complete is the supported mechanism.
const serp = { credits: 0, live: 0, archived: 0, billedNote: false };
// Every failed attempt, from every arm, for the Failures appendix.
const anchorFailures = [];
const varianceRows = [];

// The dashboard reading of R1's "503 x4": none of them were refusals. The eBay
// engine ran 22-74s and four searches COMPLETED server-side after the harness
// had already given up — and SerpApi billed all four. So the fixes are patience
// and archive retrieval, not haste: a completed search can be fetched from the
// archive for free, and re-issuing it would pay for the same work twice.
const SERP_TIMEOUT_MS = 120_000;
const SERP_RETRY_MS = 60_000;

// Free: an archived retrieval is a lookup, not a search.
async function fromArchive(id) {
  if (!id) return null;
  try {
    const url = new URL(`https://serpapi.com/searches/${encodeURIComponent(id)}.json`);
    url.searchParams.set('api_key', SERPAPI_KEY);
    const response = await fetch(url, { signal: AbortSignal.timeout(SERP_TIMEOUT_MS) });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.organic_results?.length ? data : null;
  } catch { return null; }
}

async function soldComps(item) {
  if (!SERPAPI_KEY) return null;
  const query = [item.brand, item.model].filter(Boolean).join(' ').replace(/-/g, ' ');
  for (const noCache of [false, true]) {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'ebay');
    url.searchParams.set('_nkw', query);
    url.searchParams.set('show_only', 'Sold,Complete');
    url.searchParams.set('ebay_domain', 'ebay.com');
    url.searchParams.set('_ipg', '200'); // a credit costs the same at any result count
    if (noCache) url.searchParams.set('no_cache', 'true');
    url.searchParams.set('api_key', SERPAPI_KEY);

    let data;
    let source = 'live';
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(SERP_TIMEOUT_MS) });
      data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The error body usually still names the search that is running. Ask the
        // archive for it before spending a second credit on the same work.
        const id = data?.search_metadata?.id;
        say(`  serpapi HTTP ${response.status}${id ? ` — checking the archive for ${id}` : ''}`);
        let recovered = await fromArchive(id);
        if (!recovered && id) {
          say(`  serpapi: not archived yet — waiting ${SERP_RETRY_MS / 1000}s for it to land`);
          await sleep(SERP_RETRY_MS);
          recovered = await fromArchive(id);
        }
        if (recovered) {
          data = recovered;
          source = 'archive';
          serp.archived++;
        } else if (!noCache) {
          // Pass two re-issues live with no_cache — that is the one paid retry.
          say('  serpapi: nothing in the archive, re-issuing live');
          continue;
        } else {
          return { error: `HTTP ${response.status}`, query, source: 'failed' };
        }
      }
    } catch (e) {
      const why = e?.name === 'TimeoutError' ? `timeout after ${SERP_TIMEOUT_MS / 1000}s` : 'network';
      return { error: why, query, source: 'failed' };
    }
    if (source === 'live') { serp.credits++; serp.live++; }
    // Zero results is HTTP 200 with organic_results absent and an error string.
    // There is a known flaky-empty bug, hence the single no_cache retry.
    const rows = data.organic_results ?? [];
    if (!rows.length) {
      if (!noCache) continue;
      return { error: data.error ?? 'no results', query, source };
    }
    const prices = rows
      .filter((r) => !r.sponsored)          // promoted listings skew high
      .filter((r) => !(r.unsold_date && !r.sold_date)) // ended unsold, not a comp
      .map((r) => {
        const p = r.price ?? {};
        if (Number.isFinite(p.extracted)) return p.extracted;
        if (Number.isFinite(p.from?.extracted) && Number.isFinite(p.to?.extracted)) {
          return (p.from.extracted + p.to.extracted) / 2;
        }
        return null;
      })
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (!prices.length) return { error: 'no usable prices', query, source };
    return {
      query,
      source,
      n: prices.length,
      median: prices[Math.floor(prices.length / 2)],
      low: prices[0],
      high: prices[prices.length - 1],
    };
  }
  return null;
}

// ── Report ──────────────────────────────────────────────────────────────────
function idCell(row, arm) {
  const a = row[arm];
  if (!a.ok) return `error: \`${a.code}\``;
  const id = arm === 'ungrounded' ? a.result.identification : a.parsed.identification;
  const said = [id?.brand, id?.model].filter(Boolean).join(' ') || id?.name || '—';
  return `${said} (${row[`${arm}Score`]})`;
}

function estOf(row, arm) {
  const a = row[arm];
  if (!a.ok) return null;
  return arm === 'ungrounded' ? a.result.estSellPrice : Number(a.parsed.pricing?.estimate);
}

function inRange(est, comps) {
  if (!Number.isFinite(est) || !comps || comps.error) return null;
  return est >= comps.low && est <= comps.high;
}

function calibrationTable(rows, arm) {
  const buckets = new Map();
  for (const row of rows) {
    const a = row[arm];
    if (!a.ok) continue;
    const id = arm === 'ungrounded' ? a.result.identification : a.parsed.identification;
    const conf = id?.confidence ?? 'unstated';
    if (!buckets.has(conf)) buckets.set(conf, { correct: 0, partial: 0, wrong: 0 });
    buckets.get(conf)[row[`${arm}Score`]]++;
  }
  if (!buckets.size) return '_No successful calls in this arm._';
  const lines = ['| Stated confidence | correct | partial | wrong | accuracy |', '|---|---|---|---|---|'];
  for (const conf of ['high', 'medium', 'low', 'unstated']) {
    const b = buckets.get(conf);
    if (!b) continue;
    const total = b.correct + b.partial + b.wrong;
    lines.push(`| ${conf} | ${b.correct} | ${b.partial} | ${b.wrong} | ${total ? Math.round((b.correct / total) * 100) : 0}% |`);
  }
  return lines.join('\n');
}

// What `bad-response` was covering. One block per failed attempt, so a code that
// repeats and a code that clears on the retry read differently at a glance.
function buildFailures(rows, stamp) {
  const entries = [
    ...rows.flatMap((row) => ['ungrounded', 'grounded']
      .filter((arm) => !row[arm].ok)
      .map((arm) => ({ slug: row.item.slug, arm, attempts: row[arm].attempts ?? [row[arm]] }))),
    ...anchorFailures,
  ];
  if (!entries.length) return `## Failures\n\n_None — every call in this run succeeded (${stamp})._\n`;

  const lines = [
    '## Failures',
    '',
    `_Captured ${stamp}. \`bad-response\` in \`ai.js\` collapses four distinct failures`,
    '— unparseable JSON, empty text, a `blockReason`, and a non-`STOP` `finishReason` —',
    'into one code, because nobody in an aisle can act on the difference. The harness',
    'taps the wire to see through it; production is unchanged._',
    '',
  ];
  for (const entry of entries) {
    lines.push(`### \`${entry.slug}\` · ${entry.arm}`, '');
    entry.attempts.forEach((att, i) => {
      const label = `attempt ${i + 1} of ${entry.attempts.length}`;
      if (att.ok) { lines.push(`- **${label}: recovered** — the failure was transient.`, ''); return; }
      const d = att.diag ?? {};
      if (d.note || d.status === undefined) {
        lines.push(`- **${label}: \`${att.code}\`** — ${d.note ?? 'no response body was captured for this call'}`, '');
        return;
      }
      lines.push(
        `- **${label}: \`${att.code}\`**`,
        `  - HTTP \`${d.status}\` · finishReason \`${d.finishReason ?? 'none'}\` · blockReason \`${d.blockReason ?? 'none'}\``,
        `  - envelope parsed: ${d.envelopeParsed ? 'yes' : '**no**'} · raw ${d.rawLength} chars · text ${d.textLength} chars`,
        `  - tokens — prompt ${d.promptTokens ?? '?'} · thoughts **${d.thoughtsTokens ?? '?'}** · candidates ${d.candidatesTokens ?? '?'} · total ${d.totalTokens ?? '?'}`,
        ...(d.quotaId ? [`  - quota — \`${d.quotaId}\` · limit **${d.quotaValue}** · model \`${d.quotaModel}\``] : []),
        '',
        '    ```',
        `    ${String(d.excerpt ?? '').replace(/\n/g, ' ')}`,
        '    ```',
      );
      if (d.textTail) lines.push(`    …ends: \`${d.textTail.replace(/\n/g, ' ')}\``);
      lines.push('');
    });
  }
  return lines.join('\n');
}

function buildVariance(stats) {
  if (!stats.length) return '';
  const spreads = stats.map((v) => v.spread).filter((n) => n !== null);
  const worst = stats.filter((v) => v.spread !== null).sort((a, b) => b.spread - a.spread)[0];
  const stable = stats.filter((v) => v.stable && v.calls.length);
  const pct = (n) => (n === null ? '—' : `${(n * 100).toFixed(0)}%`);

  return [
    '## Variance — the same photos, k times',
    '',
    `_${stats[0].k} calls per item, identical inputs, \`temperature: 0\`. Samples are not`,
    'retried: a failed call is data, so this also measures how often `bad-response`',
    'actually happens._',
    '',
    '| Item | estimates | median | min–max | spread | shipping min–max | ID stable | failures |',
    '|---|---|---|---|---|---|---|---|',
    ...stats.map((v) => `| ${v.slug} | ${v.estimates.map(money).join(', ') || '—'} | ${money(v.median)} | ${money(v.min)}–${money(v.max)} | **${pct(v.spread)}** | ${money(v.shippingMin)}–${money(v.shippingMax)} | ${v.calls.length ? (v.idStable ? 'yes' : '**no**') : '—'} | ${v.failures}${v.codes.length ? ` (${v.codes.join(', ')})` : ''} |`),
    '',
    `**Median spread across items: ${pct(median(spreads))}.** Worst: \`${worst?.slug ?? '—'}\` at ${pct(worst?.spread ?? null)}.`,
    '',
    '### Verdict flips — the number the product decision reads',
    '',
    `_Against a stated cost of **$${FIXTURE_COST.toFixed(2)}** and the app's own \`pencilFloor\`, computed per`,
    `run from that run's own \`shipping_estimate\` — which is what the app would have`,
    'done with that response. A flip can therefore come from shipping noise as well',
    'as price noise, which is why the shipping range is reported above._',
    '',
    '| Item | floor(s) | verdicts across the k runs | stable? |',
    '|---|---|---|---|',
    ...stats.map((v) => {
      const floors = [...new Set(v.calls.map((c) => money(c.floor)))].join(', ') || '—';
      const vs = v.calls.map((c) => c.verdict).join(' · ') || '—';
      return `| ${v.slug} | ${floors} | ${vs} | ${v.calls.length ? (v.stable ? `yes — ${v.verdict}` : '**NO — SPLIT**') : '—'} |`;
    }),
    '',
    `**${stable.length} of ${stats.filter((v) => v.calls.length).length} items are verdict-stable.**`,
    'An unstable item is one where the same photos, priced the same, would have',
    'sent Dad away with the thing and left it on the shelf on different taps.',
    '',
  ].join('\n');
}

function buildReport(rows, anchor, stamp, varianceSection = '') {
  const core = rows.filter((r) => CORE_SLUGS.includes(r.item.slug));
  const coreCorrect = core.filter((r) => r.ungroundedScore === 'correct').length;
  // `quota` and `bad-key` mean the request never reached the model. Counting
  // those as wrong answers turns an account problem into a FAIL against the
  // model, which is the one thing this table must never say by accident.
  const refused = core.filter((r) => !r.ungrounded.ok && ['quota', 'bad-key'].includes(r.ungrounded.code));
  const gatePass = coreCorrect >= CORE_GATE && core.length >= CORE_SLUGS.length;
  const queries = rows.reduce((sum, r) => sum + (r.grounded.ok ? r.grounded.queries.length : 0), 0);
  const allSources = rows.flatMap((r) => (r.grounded.ok ? r.grounded.sources : []));
  const soldSources = allSources.filter((s) => /ebay\./i.test(s.url ?? ''));

  const sheet = rows.map((row, i) => {
    const uEst = estOf(row, 'ungrounded');
    const gEst = estOf(row, 'grounded');
    const comps = row.comps;
    const truth = comps && !comps.error
      ? `${money(comps.median)} <br><sub>via SerpApi sold data (n=${comps.n})</sub>`
      : '⟵ fill from eBay sold filter';
    const within = (est) => {
      const hit = inRange(est, comps);
      return hit === null ? '—' : hit ? 'Y' : 'N';
    };
    const cond = row.ungrounded.ok ? (row.ungrounded.result.conditionRead?.grade ?? '—') : '—';
    const conf = row.ungrounded.ok ? (row.ungrounded.result.identification?.confidence ?? '—') : '—';
    const regs = row.ungrounded.ok
      ? `${row.ungrounded.result.listing?.title ? 'eBay' : '—'} / ${row.ungrounded.result.listingMercari?.title ? 'Mercari' : '—'}`
      : '—';
    // Reported, never scored: the fixtures carry no weighed postage, so any
    // grade would be invented. M2 spends this number, so it gets looked at.
    const ship = row.ungrounded.ok ? money(row.ungrounded.result.shipping) : '—';
    return `| ${i + 1} | ${row.item.slug} | ${idCell(row, 'ungrounded')} | ${idCell(row, 'grounded')} | ${cond} | ${money(uEst)} | ${money(gEst)} | ${truth} | ${within(uEst)} / ${within(gEst)} | ${ship} | ${conf} | ${regs} | ${row.grounded.ok ? row.grounded.queries.length : '—'} |`;
  }).join('\n');

  const hitRate = (arm) => {
    const scored = rows.map((r) => inRange(estOf(r, arm), r.comps)).filter((v) => v !== null);
    if (!scored.length) return 'no ground truth yet';
    return `${scored.filter(Boolean).length}/${scored.length}`;
  };

  return `# Live-check results

_Generated ${stamp} by \`scripts/live-check.mjs\` against \`fixtures/live/\`._
_Model: \`${GEMINI_MODEL}\`. Items: ${rows.length}. Grounded search queries billed: ${queries}._

## Gate — the five core items (v0 §6 sheet, both arms)

${SUBSET
  ? `_Not assessed — this was a subset run (\`--only=${onlySlugs.join(',')}\`). ${core.length} of ${CORE_SLUGS.length} core items ran, so the gate is not measurable and the last full run's verdict stands._`
  : refused.length
    ? `_**Not assessed** — ${refused.length} of ${core.length} core items were refused by the account before reaching the model (\`${[...new Set(refused.map((r) => r.ungrounded.code))].join(', ')}\`), so they are neither right nor wrong. ${coreCorrect} of the ${core.length - refused.length} that ran were correct. The last fully-answered run's verdict stands._`
    : `**${gatePass ? 'PASS' : 'FAIL'}** — ${coreCorrect}/${core.length} core items correct on brand+model (need ${CORE_GATE} of ${CORE_SLUGS.length}).`}
${core.length < CORE_SLUGS.length ? `\n> Missing fixtures for: ${CORE_SLUGS.filter((s) => !core.some((r) => r.item.slug === s)).join(', ')}. The gate cannot pass until all five exist.\n` : ''}
| # | Item | Ungrounded ID | Grounded ID | Condition | Est. (ungrounded) | Est. (grounded) | Real sold median | Within range U/G | Shipping est. | ID confidence | Registers | Search queries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${sheet}

Sold-range hit rate — ungrounded **${hitRate('ungrounded')}**, grounded **${hitRate('grounded')}**.

**Shipping est.** is \`pricing.shipping_estimate\` after M2's [4, 100] clamp — the
figure the verdict actually spends now that the capture screen no longer asks
for one. It is **unscored**: the fixtures have no weighed postage to score it
against, so read the column for anything absurd rather than for a percentage.

${varianceSection}## Calibration — does stated confidence track accuracy?

What matters is the sort, not the average: accuracy should fall as confidence falls.
If \`high\` is not meaningfully more accurate than \`low\`, that finding outranks the
accuracy score and the UI should treat every estimate as low-confidence until V2.

**Ungrounded**

${calibrationTable(rows, 'ungrounded')}

**Grounded**

${calibrationTable(rows, 'grounded')}

## Anchoring test

${anchor ?? '_Not run. Pass `--anchor=<slug>` to run one item at $4 and $30._'}

## Tier-A decision inputs

**(a) Do the grounded sources point at real sold listings?**
${allSources.length
    ? `${soldSources.length} of ${allSources.length} cited URLs are on an eBay domain. ${soldSources.some((s) => /LH_Sold|sold/i.test(s.url)) ? 'At least one carries a sold/completed filter.' : 'None visibly carry a sold/completed filter — the model may be reading active listings or brand pages, which is asking-price data, not comps.'}\n\n${allSources.slice(0, 12).map((s) => `- [${s.title}](${s.url})`).join('\n')}`
    : '_No sources returned — either the grounded arm did not run, or the model answered without searching._'}

**(b) Terms-of-service posture.** Grounding's terms require Grounded Results to be
displayed together with the Search Suggestions from \`searchEntryPoint\`, forbid
modifying or interspersing them, and forbid collecting them by automated means.
Parsing grounded output into the app's own verdict UI is in tension with that.
Two mitigations worth weighing before tier A changes: the Why sheet already has a
natural slot to render \`searchEntryPoint\` natively, which would satisfy the
display requirement; and this harness is a one-off measurement on the owner's own
key, which is a different posture from shipping it. **Hosted-tier (EH) compliance
is a separate and stricter question than a single user's own key** — a hosted
service redistributing grounded results to other people's screens has to satisfy
the display and no-collection clauses on every one of them.

**(c) Cost.** Grounding has **no free tier** on Gemini 3.x. Paid tier includes
5,000 prompts/month free (shared across all Gemini 3 models), then **$14 per
1,000 search queries** — billed per query executed, not per request, so one item
can burn several. This run executed **${queries}** search ${queries === 1 ? 'query' : 'queries'}${queries ? ` (≈ $${((queries / 1000) * 14).toFixed(3)} at list price)` : ''}.
SerpApi: **${serp.live}** live search${serp.live === 1 ? '' : 'es'}, **${serp.archived}** recovered
from the archive (free). Counted client-side, and that count **under-reports**:
SerpApi bills a search that completes server-side even when the client saw a 503
and gave up, which is exactly what happened on the previous run. The dashboard
is the authority, not this line. Free plan allows 250/month.

## Manual remainder:

${!SERPAPI_KEY
  ? '- **eBay sold medians** — no `SERPAPI_KEY` was set, so every ground-truth cell is a placeholder. Fill them from eBay → search → filter **Sold items** → median of the last ~10 comparable sales (~30s each).'
  : (serp.live || serp.archived)
    ? '- Sold medians were filled automatically; spot-check one against eBay to confirm the query matched the right item.'
    : '- **Sold medians were NOT filled** — every SerpApi call failed this run, so every ground-truth cell is still a placeholder. Fill them by hand, or re-run once the account is healthy.'}
- **Kill the key** (runbook §4) — delete the key in aistudio.google.com/apikey, then run one analysis in the app. Expect the pencil tag to still render with the "That key didn't work" copy and a working Add to cart. Inherently manual; no harness can revoke a key for you.
- **The comparison bar** (plan §6.3) — run a few of these items through the Gemini app the way you do today. The test is beating that habit, not beating nothing.
`;
}

// ── Anchoring ───────────────────────────────────────────────────────────────
async function runAnchor(item) {
  // Rebuilt at H2. The old test compared one $4 call against one $30 call and
  // called anything over 10% anchored — but D1 measured ~29% between two
  // IDENTICAL prompts, so the threshold sat three times below the noise. Worse,
  // D1 deleted the price from the prompt entirely, which left the old test
  // comparing two byte-identical requests and reporting their variance as
  // anchoring.
  //
  // So: measure the floor, then look for signal above it. The price now rides
  // the notes field, which is also the realistic threat model — Dad's own notes
  // could say what he paid.
  say(`\n▸ anchoring on "${item.slug}" — ${ANCHOR_PAIRS} control pairs, ${ANCHOR_PAIRS} anchored pairs`);

  async function pair(label, notesA, notesB) {
    const a = await runUngrounded(item, ANCHOR_LOW, notesA);
    await sleep(GAP_MS);
    const b = await runUngrounded(item, ANCHOR_HIGH, notesB);
    await sleep(GAP_MS);
    for (const [which, r] of [['A', a], ['B', b]]) {
      if (!r.ok) {
        anchorFailures.push({ slug: `${item.slug} (${label} ${which})`, arm: 'ungrounded', attempts: [r] });
      }
    }
    if (!a.ok || !b.ok) return null;
    const x = a.result.estSellPrice;
    const y = b.result.estSellPrice;
    return { x, y, delta: y - x, abs: Math.abs(y - x) };
  }

  const control = [];
  for (let i = 0; i < ANCHOR_PAIRS; i++) {
    const r = await pair('control', anchorNotes(null), anchorNotes(null));
    if (r) say(`  control ${i + 1}: ${money(r.x)} vs ${money(r.y)} — |Δ| ${money(r.abs)}`);
    if (r) control.push(r);
  }
  const anchored = [];
  for (let i = 0; i < ANCHOR_PAIRS; i++) {
    const r = await pair('anchored', anchorNotes(ANCHOR_LOW), anchorNotes(ANCHOR_HIGH));
    if (r) say(`  anchored ${i + 1}: $${ANCHOR_LOW} → ${money(r.x)} | $${ANCHOR_HIGH} → ${money(r.y)} — Δ ${money(r.delta)}`);
    if (r) anchored.push(r);
  }

  if (control.length < 2 || anchored.length < 2) {
    say('  anchoring inconclusive — too few pairs completed');
    return `_Inconclusive: ${control.length}/${ANCHOR_PAIRS} control and ${anchored.length}/${ANCHOR_PAIRS} anchored pairs completed._`;
  }

  const noise = median(control.map((r) => r.abs));
  const signal = median(anchored.map((r) => r.abs));
  // Signal has to beat noise by more than noise itself: a difference the size of
  // the floor is the floor.
  const isAnchored = signal > noise * 2;
  // Direction is the other half of the evidence. Anchoring predicts a higher
  // stated price produces a higher estimate, every time.
  const up = anchored.filter((r) => r.delta > 0).length;
  const consistent = up === anchored.length || up === 0;

  say(`  noise floor (control |Δ| median): ${money(noise)}`);
  say(`  anchored |Δ| median:              ${money(signal)}`);
  say(`  ${isAnchored ? 'ANCHORED' : 'within noise'} — signal ${isAnchored ? '>' : '<='} 2x floor · ${up}/${anchored.length} pairs moved up`);

  const rows = (label, list) => list.map((r, i) =>
    `| ${label} ${i + 1} | ${money(r.x)} | ${money(r.y)} | ${money(r.delta)} |`).join('\n');

  return [
    `**${isAnchored ? 'ANCHORED via the notes field' : 'Within noise — no anchoring detected'}.**`,
    '',
    `Both arms send notes; they differ only in whether a price appears. The control's`,
    `spread **is** the noise floor for this prompt shape and this run.`,
    '',
    '| Pair | A | B | Δ (B−A) |',
    '|---|---|---|---|',
    rows(`control (no price)`, control),
    rows(`anchored ($${ANCHOR_LOW} vs $${ANCHOR_HIGH})`, anchored),
    '',
    `- Noise floor — median control \`|Δ|\`: **${money(noise)}**`,
    `- Signal — median anchored \`|Δ|\`: **${money(signal)}**`,
    `- Threshold — signal must exceed **${money(noise * 2)}** (floor + floor)`,
    `- Direction — ${up}/${anchored.length} anchored pairs moved *up* with the stated price${consistent ? ' (consistent)' : ' (inconsistent — the mark of noise, not anchoring)'}`,
    '',
    isAnchored
      ? `A price written into the notes still moves the estimate. The prompt cannot be fixed by deletion this time — the text is the user's own.`
      : `A price written into the notes does not move the estimate more than the model moves on its own. Nothing to act on, and D1's deletion holds.`,
  ].join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
const anchorSlug = process.argv.find((a) => a.startsWith('--anchor='))?.split('=')[1];
const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const varianceArg = process.argv.find((a) => a === '--variance' || a.startsWith('--variance='));
const VARIANCE_K = varianceArg ? (Number(varianceArg.split('=')[1]) || VARIANCE_DEFAULT) : 0;
const RUN_LABEL = process.argv.find((a) => a.startsWith('--label='))?.split('=')[1] ?? 'Run';
const onlySlugs = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
const allItems = loadFixtures();
// A subset run measures a couple of items closely; it cannot speak for the
// five-item gate, and it must not overwrite the record of a run that could.
const SUBSET = Boolean(onlySlugs);
const items = SUBSET ? allItems.filter((i) => onlySlugs.includes(i.slug)) : allItems;
if (SUBSET) {
  const missing = onlySlugs.filter((slug) => !allItems.some((i) => i.slug === slug));
  if (missing.length) say(`--only: no fixture for ${missing.join(', ')}`);
}

// Real money on someone's own key. Say what it will cost before spending it.
{
  const perItem = 2; // one ungrounded, one grounded
  const anchorCalls = anchorSlug ? ANCHOR_PAIRS * 4 : 0;
  const gemini = items.length * perItem + items.length * VARIANCE_K + anchorCalls;
  say(`\nCost preflight — ${items.length} item${items.length === 1 ? '' : 's'}`);
  say(`  ${items.length * perItem} gate calls (ungrounded + grounded)`);
  if (VARIANCE_K) say(`  ${items.length * VARIANCE_K} variance calls (${VARIANCE_K} per item, not retried)`);
  if (anchorCalls) say(`  ${anchorCalls} anchor calls (${ANCHOR_PAIRS} control pairs + ${ANCHOR_PAIRS} anchored pairs)`);
  say(`  ≈ ${gemini} Gemini calls${SERPAPI_KEY ? ` · up to ${items.length} SerpApi searches` : ' · no SerpApi key'}`);
  say(`  grounded search queries are billed separately, per query executed`);
  if (gemini > FREE_TIER_DAILY) {
    say('');
    say(`  ⚠ THIS RUN CANNOT COMPLETE ON THE FREE TIER.`);
    say(`    The measured ceiling is ${FREE_TIER_DAILY} requests/day for ${GEMINI_MODEL}`);
    say(`    (quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier), and this run`);
    say(`    plans ${gemini}. Expect \`quota\` from roughly call ${FREE_TIER_DAILY} onward, and note`);
    say(`    the day's allowance is shared with anything already run today.`);
    say(`    Either enable billing, or narrow with --only= and a smaller --variance=.`);
  }
  say('');
}

if (!items.length) {
  say(`No fixtures found in fixtures/live/.\n\n${CONVENTION}\n`);
  process.exit(0);
}

if (!GEMINI_KEY) {
  say('GEMINI_KEY is not set — every call will report `no-key`. Continuing so the');
  say('report scaffold is still written.\n');
}

say(`${items.length} item${items.length === 1 ? '' : 's'}: ${items.map((i) => i.slug).join(', ')}`);
say(`model ${GEMINI_MODEL} · sold-comps ${SERPAPI_KEY ? 'via SerpApi' : 'manual (no SERPAPI_KEY)'}\n`);

const rows = [];
for (const item of items) {
  say(`▸ ${item.slug} (${item.photos.length} photo${item.photos.length === 1 ? '' : 's'}) expecting ${item.brand} ${item.model}`);

  const ungrounded = await attempt(() => runUngrounded(item), `${item.slug} ungrounded`);
  const ungroundedScore = ungrounded.ok ? scoreId(item, ungrounded.result.identification) : 'wrong';
  say(`  ungrounded: ${ungrounded.ok ? `${ungroundedScore} · ${money(ungrounded.result.estSellPrice)}` : `error \`${ungrounded.code}\``}`);
  if (ungrounded.ok) {
    // vision §7's V1.5 gate: one analyze, both registers
    const m = ungrounded.result.listingMercari;
    const hasEbay = !!ungrounded.result.listing?.title;
    say(`  registers:  eBay ${hasEbay ? '✓' : '✗'} · Mercari ${m?.title ? '✓' : '✗'}${m?.hashtags?.length ? ` (${m.hashtags.length} tags, ${money(Number(m.suggested_price))})` : ''}`);
  }
  await sleep(GAP_MS);

  const grounded = await attempt(() => runGrounded(item), `${item.slug} grounded`);
  const groundedScore = grounded.ok ? scoreId(item, grounded.parsed.identification) : 'wrong';
  say(`  grounded:   ${grounded.ok ? `${groundedScore} · ${money(Number(grounded.parsed.pricing?.estimate))} · ${grounded.queries.length} search ${grounded.queries.length === 1 ? 'query' : 'queries'}` : `error \`${grounded.code}\``}`);
  await sleep(GAP_MS);

  if (VARIANCE_K) {
    say(`  variance:   ${VARIANCE_K} identical calls…`);
    const runs = await runVariance(item, VARIANCE_K);
    const stats = varianceStats(item, runs);
    varianceRows.push(stats);
    const pct = stats.spread === null ? '—' : `${(stats.spread * 100).toFixed(0)}%`;
    say(`              ${stats.estimates.map(money).join(', ') || 'all failed'} · spread ${pct} · ${stats.calls.length ? (stats.stable ? `stable ${stats.verdict}` : 'VERDICT SPLIT') : '—'}${stats.failures ? ` · ${stats.failures} failed` : ''}`);
    await sleep(GAP_MS);
  }

  const comps = await soldComps(item);
  if (comps?.error) say(`  sold comps: ${comps.error}`);
  else if (comps) say(`  sold comps: median ${money(comps.median)} of ${comps.n} (${money(comps.low)}–${money(comps.high)})`);

  rows.push({ item, ungrounded, ungroundedScore, grounded, groundedScore, comps });
}

let anchorReport = null;
if (anchorSlug) {
  const target = items.find((i) => i.slug === anchorSlug);
  if (target) anchorReport = await runAnchor(target);
  else say(`\n--anchor=${anchorSlug} — no fixture with that slug; skipping.`);
}

const stamp = new Date().toISOString();
const failures = scrub(buildFailures(rows, stamp));

const TITLE = '# Live-check results';
const FAIL_MARKER = '\n## Failures\n';
const ARCHIVE_MARKER = '\n## Superseded';

// A full run used to rewrite the file end to end, which would have erased R1's
// table, its hand-written read-out and the whole D1 diagnosis. Newest first, and
// nothing is ever deleted: the previous run is demoted, dated, and kept.
function demote(existing) {
  if (!existing) return '';
  let body = existing;
  const t = body.indexOf(TITLE);
  if (t >= 0) body = body.slice(t + TITLE.length);
  const f = body.indexOf(FAIL_MARKER);
  if (f >= 0) body = body.slice(0, f);          // the appendix is rebuilt every run
  body = body.replace(/\n*-{3,}\s*$/, '').trim();
  if (!body) return '';
  const when = body.match(/_Generated (\d{4}-\d{2}-\d{2})/)?.[1] ?? 'an earlier run';
  const already = body.indexOf(ARCHIVE_MARKER);
  // Don't nest archives inside archives — demote only what was current, and let
  // anything already demoted keep its own heading below it.
  const fresh = already < 0 ? body : body.slice(0, already).trim();
  const older = already < 0 ? '' : body.slice(already).trim();
  return [
    `## Superseded — ${when}`,
    '',
    '_Kept for the record. The run above supersedes it; the prompt has changed since._',
    '',
    fresh,
    older ? `\n${older}` : '',
  ].join('\n');
}

if (SUBSET && existsSync(OUT)) {
  // A subset run answers a narrow question and must not overwrite the record of
  // a run that answered the broad one — the table, the calibration rows and any
  // hand-written read-out all survive. Only the appendix is replaced.
  const existing = readFileSync(OUT, 'utf8');
  const marker = '\n## Failures\n';
  const head = existing.includes(marker) ? existing.slice(0, existing.indexOf(marker)) : existing.replace(/\s*$/, '\n');
  writeFileSync(OUT, `${head}\n---\n\n${failures}`);
  say(`\nSubset run — updated only the Failures appendix of docs/live-check-results.md`);
  say('The table above it is from the last full run and was left untouched.');
} else if (existsSync(OUT) && !rows.some((r) => r.ungrounded.ok || r.grounded.ok)) {
  // Every call failed, so this run knows nothing. Demoting a real report beneath
  // a table of dashes would lose the record and record nothing in its place —
  // which is exactly what a keyless or fully-quota-blocked run would do.
  say('\nEvery call failed — docs/live-check-results.md left untouched.');
  say('Nothing was learned, so nothing supersedes what is already there.');
} else {
  const fresh = scrub(buildReport(rows, anchorReport, stamp, scrub(buildVariance(varianceRows))));
  const freshBody = fresh.slice(fresh.indexOf(TITLE) + TITLE.length).trim();
  const archived = demote(existsSync(OUT) ? readFileSync(OUT, 'utf8') : '');
  writeFileSync(OUT, [
    TITLE,
    '',
    `## ${RUN_LABEL} — ${stamp.slice(0, 10)}`,
    '',
    freshBody,
    archived ? `\n---\n\n${archived}` : '',
    `\n---\n\n${failures}`,
  ].join('\n'));
  say(`\nWrote docs/live-check-results.md — newest first; the previous run was demoted, not replaced.`);
}
