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
const ANCHOR_TOLERANCE = 0.10;
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
  return {
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
    excerpt: (text || raw).slice(0, 200),
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
async function runUngrounded(item, goodwillPrice = 8) {
  wire.last = null;
  try {
    const result = await analyzeItem({
      photoBase64s: item.photos.map((p) => p.base64),
      mimeTypes: item.photos.map((p) => p.mimeType),
      details: '',
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

function buildReport(rows, anchor, stamp) {
  const core = rows.filter((r) => CORE_SLUGS.includes(r.item.slug));
  const coreCorrect = core.filter((r) => r.ungroundedScore === 'correct').length;
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

## Calibration — does stated confidence track accuracy?

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
  say(`\n▸ anchoring on "${item.slug}" — $${ANCHOR_LOW} vs $${ANCHOR_HIGH}`);
  const low = await attempt(() => runUngrounded(item, ANCHOR_LOW), `${item.slug} anchor $${ANCHOR_LOW}`);
  await sleep(GAP_MS);
  const high = await attempt(() => runUngrounded(item, ANCHOR_HIGH), `${item.slug} anchor $${ANCHOR_HIGH}`);
  anchorFailures.push(
    ...[['low', low], ['high', high]]
      .filter(([, r]) => !r.ok)
      .map(([which, r]) => ({ slug: `${item.slug} (anchor ${which})`, arm: 'ungrounded', attempts: r.attempts })),
  );
  if (!low.ok || !high.ok) {
    const code = low.ok ? high.code : low.code;
    say(`  anchoring inconclusive — ${code}`);
    return `_Inconclusive: the run failed with \`${code}\`._`;
  }
  const a = low.result.estSellPrice;
  const b = high.result.estSellPrice;
  const base = Math.max(Math.abs(a), 1e-9);
  const drift = Math.abs(b - a) / base;
  const anchored = drift > ANCHOR_TOLERANCE;
  say(`  $${ANCHOR_LOW} → ${money(a)} | $${ANCHOR_HIGH} → ${money(b)} | drift ${(drift * 100).toFixed(1)}%`);
  if (anchored) {
    say('  ANCHORED — the model is pricing off the purchase price. Fix, in src/utils/ai.js:');
    say('    `Goodwill price: $${Number(goodwillPrice).toFixed(2)}`, // ANCHORING: delete this line');
  }
  return [
    `| Run | Stated Goodwill price | \`pricing.estimate\` |`,
    `|---|---|---|`,
    `| A | $${ANCHOR_LOW.toFixed(2)} | ${money(a)} |`,
    `| B | $${ANCHOR_HIGH.toFixed(2)} | ${money(b)} |`,
    '',
    anchored
      ? `**ANCHORED** — the estimate moved ${(drift * 100).toFixed(1)}% (tolerance ${ANCHOR_TOLERANCE * 100}%). The model is pricing off the purchase price, which makes every verdict circular. Fix: delete the line marked \`// ANCHORING: delete this line\` in \`src/utils/ai.js\`. The price stays client-side in \`calcProfit\`/\`checkRules\`/\`pencilFloor\`, which is all it was ever needed for.`
      : `**Holds** — the estimate moved ${(drift * 100).toFixed(1)}% (tolerance ${ANCHOR_TOLERANCE * 100}%). The model is pricing the market, not the sticker.`,
  ].join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
const anchorSlug = process.argv.find((a) => a.startsWith('--anchor='))?.split('=')[1];
const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
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
} else {
  writeFileSync(OUT, `${scrub(buildReport(rows, anchorReport, stamp))}\n---\n\n${failures}`);
  say(`\nWrote docs/live-check-results.md`);
}
