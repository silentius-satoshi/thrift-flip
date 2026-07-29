// The mobile + PWA harness (M1). Three suites, all against the production build:
//
//   --pwa    offline boot, cache discipline, and the rebuild purge
//   --dev    that the worker cannot outlive a preview and freeze `npm run dev`
//   --camera the live viewfinder, and that a refused camera falls back cleanly
//   --shipping  that the verdict spends the model's estimate, clamped
//   --comps  that the verdict never waits on comps, and that sold data takes
//            the wheel honestly when it arrives — including the flip
//   --sweep  a pass over every screen at 360x800, 375x667, 390x844 and 430x932:
//            overflow, tap targets, fixed chrome. Roughly four times the
//            runtime of one pass; --viewport=360x800 runs a single width.
//
// Browser automation is deliberately NOT a dependency of this app — it would be
// the largest thing in node_modules and nothing ships with it. Install it for
// the run and drop it again:
//
//   npm i --no-save playwright-core
//   npx playwright-core install chromium
//   node scripts/mobile-check.mjs
//
// It builds into dist/ and serves that over a local static server mirroring
// vercel.json's SPA rewrite, so what it measures is what ships — never the dev
// server, whose module graph and asset URLs are a different thing entirely.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 5177);
const APP = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS ?? null;

const args = process.argv.slice(2);
const only = args.filter((a) => ['--pwa', '--sweep', '--dev', '--camera', '--shipping', '--comps'].includes(a));
const runs = (flag) => only.length === 0 || only.includes(flag);

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, userAgent: IOS_UA };

// The narrow end is an SE or a mini; the wide end a Pro Max. `--column` is a
// max-width, so 360 is where anything that assumed 390 gives way, and 430 is
// where a flex row has enough slack to hide a target that is too small at 360.
const VIEWPORTS = [
  { label: '360x800', width: 360, height: 800 },
  { label: '375x667', width: 375, height: 667 },
  { label: '390x844', width: 390, height: 844 },
  { label: '430x932', width: 430, height: 932 },
];
const oneViewport = (args.find((a) => a.startsWith('--viewport=')) ?? '').split('=')[1];
const SWEEP_VIEWPORTS = oneViewport
  ? VIEWPORTS.filter((v) => v.label === oneViewport)
  : VIEWPORTS;
const MIN_TARGET = 44;
const PIN = '135790';
const AI_KEY = 'AIzaSyDUMMY-key-000000000000000000';
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Deliberate exceptions to the 44px rule. Each one has to earn its line.
const TARGET_ALLOWLIST = [
  {
    match: 'ui-photo-remove',
    reason: 'a 44px halo would blanket the 72px thumbnail it deletes, so the thumb\'s own tap '
      + 'would become ambiguous — trading a mis-delete for a missed tap is the wrong way round',
  },
];

const results = [];
const consoleErrors = [];
const ok = (section, name, pass, detail = '') =>
  results.push({ section, name, pass, detail: String(detail).slice(0, 160) });

// ── The static server: vercel.json's rewrite, in thirty lines ───────────────

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, APP);
    const path = normalize(decodeURIComponent(url.pathname));

    // A real 200 on /api/*, so the worker's refusal to cache it is a refusal
    // and not a 404 it would have skipped anyway. no-store because that is what
    // the relays must send — they carry order data and tokens — and because
    // Chromium's own HTTP cache would otherwise answer these while offline,
    // which says nothing about the worker.
    if (path.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, at: path }));
    }

    const file = join(DIST, path === '/' ? 'index.html' : path);
    const target = file.startsWith(DIST) && existsSync(file) && extname(file)
      ? file
      : join(DIST, 'index.html');   // the SPA rewrite

    const headers = { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' };
    // What a real host must do: never let the HTTP cache pin an old worker or
    // an old shell, or the update flow below can never fire.
    if (path === '/sw.js') headers['Cache-Control'] = 'no-store';
    else if (target.endsWith('index.html')) headers['Cache-Control'] = 'no-cache';

    res.writeHead(200, headers);
    res.end(await readFile(target));
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

// ── Browser resolution — never a hardcoded cache path ───────────────────────

async function resolveChromium() {
  let mod;
  try {
    mod = await import('playwright-core');
  } catch {
    console.error('playwright-core is not installed. Run:\n  npm i --no-save playwright-core');
    process.exit(2);
  }
  let exe = process.env.PLAYWRIGHT_CHROMIUM;
  if (!exe) {
    try { exe = mod.chromium.executablePath(); } catch { exe = undefined; }
  }
  if (!exe || !existsSync(exe)) {
    console.error('No Chromium found. Run `npx playwright-core install chromium`, '
      + 'or set PLAYWRIGHT_CHROMIUM to a browser binary.\n'
      + 'Note: the headless *shell* build is not enough — service workers need full Chromium.');
    process.exit(2);
  }
  return { chromium: mod.chromium, exe };
}

const build = () => execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });

const bundleName = async () =>
  (await readdir(join(DIST, 'assets'))).find((f) => f.endsWith('.js'));

// ── Shared page helpers ────────────────────────────────────────────────────

// Noise the offline suite is deliberately provoking. Everything else is fatal.
const EXPECTED_CONSOLE = [
  /ERR_INTERNET_DISCONNECTED/,           // the analyze reaching for a network that is gone
  /runAnalyze failed: offline/,          // ai.js logging the code — and only the code
  /ERR_FAILED/,                          // the chat request the sweep kills on purpose
];
const noteError = (text) => {
  if (!EXPECTED_CONSOLE.some((re) => re.test(text))) consoleErrors.push(text);
};

function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error') noteError(m.text()); });
  page.on('pageerror', (e) => noteError(String(e)));
}

// The vault sheet appears whenever a credential is read without a live session
// key, which every reload produces. Answer it if it is there; never wait long
// for one that is not.
async function ceremony(page, timeout = 1500) {
  const sheet = await page.waitForSelector('.vault-sheet', { timeout }).catch(() => null);
  if (!sheet) return false;
  const alt = await page.$('.vault-alt');
  if (alt && (await alt.textContent()).includes('PIN')) await alt.click();
  for (const input of await page.$$('.vault-sheet .ui-input')) await input.fill(PIN);
  await page.click('.vault-sheet .ui-btn:has-text("Lock it"), .vault-sheet .ui-btn:has-text("Unlock")');
  await page.waitForSelector('.vault-sheet', { state: 'detached', timeout: 10000 });
  return true;
}

async function waitForWaitingWorker(page, ms = 20000) {
  await page.evaluate(() => navigator.serviceWorker.getRegistration()
    .then((r) => r?.update()).catch(() => {}));
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const has = await page.evaluate(() => navigator.serviceWorker.getRegistration()
      .then((r) => !!r?.waiting));
    if (has) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const wipe = (page) => page.evaluate(async () => {
  localStorage.clear();
  sessionStorage.clear();
  for (const name of ['thrift-flip-vault', 'thrift-flip-photos']) {
    await new Promise((r) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = r;
    });
  }
});

// The production build has no /src/ to import, so the key goes in the way Dad
// puts it in: through the key screen. Callers stub Gemini first — Connect
// validates the key with a real call before it stores anything.
async function enrolKey(page) {
  await page.evaluate(() => {
    localStorage.setItem('thrift-flip-screen', 'settings');
    localStorage.setItem('thrift-flip-settings-view', 'ai-key');
  });
  await page.goto(`${APP}/`, { waitUntil: 'load' });
  await page.fill('.settings-paste .ui-input', AI_KEY);
  await page.click('.ui-btn:has-text("Connect")');
  await ceremony(page, 6000);
  await page.waitForSelector('.settings-keycard', { timeout: 15000 });
}

const GEMINI = '**/generativelanguage.googleapis.com/**';
const ANALYSIS = {
  identification: { name: 'Pendleton blanket', brand: 'Pendleton', confidence: 'high' },
  condition_read: { grade: 'Good', notes: 'light pilling' },
  listing: {
    title: 'Pendleton Beaver State Wool Blanket Southwest Vintage',
    description_html: '<p>Vintage Pendleton wool blanket.</p>',
    item_specifics: { Brand: 'Pendleton', Size: 'Twin', MPN: '' },
    condition_description: 'Light pilling on one corner',
  },
  listing_mercari: { title: 'Pendleton blanket', description: 'd', hashtags: ['#vintage'], suggested_price: 79 },
  pricing: { estimate: 94.5, range_low: 80, range_high: 110, confidence: 'medium', rationale: 'comparable sales' },
  strategy: { note: 'List Sunday evening.' },
};
const stubGemini = (page, pricing = {}) => page.route(GEMINI, (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{
    text: JSON.stringify({ ...ANALYSIS, pricing: { ...ANALYSIS.pricing, ...pricing } }),
  }] } }] }),
}));

// Capture → verdict, from a clean capture screen. Shared by the M2 suites.
async function runVerdict(page, { note = 'wool blanket', price = '8' } = {}) {
  await page.evaluate(() => {
    // A stamped verdict survives a reload by design, so it has to be cleared or
    // the next case restores the previous one instead of capturing afresh.
    localStorage.removeItem('thrift-flip-shopping-verdict');
    localStorage.removeItem('thrift-flip-shopping-form');
    localStorage.setItem('thrift-flip-screen', 'shop');
  });
  await page.goto(`${APP}/`, { waitUntil: 'load' });
  await page.waitForSelector('.buy-cam', { timeout: 10000 });
  await page.setInputFiles('input[type=file]', {
    name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64'),
  });
  await page.fill('.buy-details .ui-input:not([type=number])', note);
  await page.fill('.buy-money-row .ui-input', price);
  await page.click('.buy-details .ui-btn:has-text("Get the verdict")');
  await page.waitForSelector('.buy-barred', { timeout: 15000 });
  await ceremony(page);
  // Not the advisor card — that only renders on a BUY, and a $100 shipping
  // clamp is deliberately a SKIP. The Earnings breakdown is on both.
  await page.waitForFunction(() => [...document.querySelectorAll('.ui-panel-row-label')]
    .some((l) => l.textContent.startsWith('Selling costs')), null, { timeout: 20000 });
}

// The Earnings panel, read back as {label: value} so a row can be asserted by
// what it says as well as what it shows.
const earnings = (page) => page.evaluate(() =>
  Object.fromEntries([...document.querySelectorAll('.ui-panel-row')].map((row) => [
    row.querySelector('.ui-panel-row-label')?.textContent ?? '',
    row.querySelector('.ui-panel-row-value')?.textContent ?? '',
  ]).concat([['TOTAL', document.querySelector('.ui-panel-total-value')?.textContent ?? '']])));

// ── PWA suite ──────────────────────────────────────────────────────────────

async function pwaSuite(chromium, exe) {
  const S = 'pwa';
  const profile = mkdtempSync(join(tmpdir(), 'thrift-flip-pwa-'));
  let context = await chromium.launchPersistentContext(profile, { executablePath: exe, args: ['--no-sandbox'], ...PHONE });
  let page = context.pages()[0] ?? await context.newPage();
  watch(page);

  try {
    // ── First load, online: the worker installs and precaches ──────────────
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    ok(S, 'the worker installs and takes control on the first load', true);

    // A cacheable /api/ GET goes out while online, so the cache assertions below
    // are about refusal rather than about it never having had the chance.
    await page.evaluate(() => fetch('/api/ebay/proxy?path=sell%2Ffulfillment%2Fv1%2Forder').then((r) => r.json()));

    // A key has to be in the vault before the network goes, or the analyze
    // below would fail with 'no-key' and never reach the offline path at all.
    await wipe(page);
    await stubGemini(page);
    await enrolKey(page);
    // Unrouted deliberately: a route handler still answers while the context is
    // offline, and a stubbed Gemini would prove nothing about no signal.
    await page.unroute(GEMINI);

    const firstBundle = await bundleName();

    // ── Kill the network and reload ────────────────────────────────────────
    await page.evaluate(() => localStorage.setItem('thrift-flip-screen', 'shop'));
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    const booted = await page.waitForSelector('.ui-nav, .buy-cam', { timeout: 15000 }).then(() => true, () => false);
    ok(S, 'offline hard reload: the app boots at all', booted);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-offline-boot.png`, fullPage: true });

    // ── The pencil flow, entirely offline ──────────────────────────────────
    await page.setInputFiles('input[type=file]', {
      name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64'),
    });
    await page.fill('.buy-details .ui-input:not([type=number])', 'wool blanket');
    await page.fill('.buy-money-row .ui-input >> nth=0', '8');
    await page.click('.buy-details .ui-btn:has-text("Get the verdict")');
    await page.waitForSelector('.buy-barred', { timeout: 15000 });
    await ceremony(page);

    const pencil = await page.textContent('.buy-barred');
    ok(S, 'offline: the pencil floor is figured on the phone', pencil.includes('or more'),
      pencil.match(/\$[\d.]+ or more/)?.[0] ?? pencil.slice(0, 60));
    const signal = await page.waitForSelector('.buy-sig', { timeout: 15000 }).catch(() => null);
    const signalText = signal ? await signal.textContent() : '';
    ok(S, 'offline: the analyze fails to the offline copy, not a crash',
      signalText.includes('No signal'), signalText);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-offline-pencil.png`, fullPage: true });

    // Cart and drafts, still offline. Adding resets the capture screen, which
    // hides the nav — so the cart is reached the way a refresh would reach it,
    // which doubles as a second offline boot.
    await page.click('.ui-actionbar .ui-btn:has-text("Add to cart")');
    await page.waitForTimeout(400);
    await page.evaluate(() => localStorage.setItem('thrift-flip-screen', 'cart'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.cart-item', { timeout: 10000 });
    ok(S, 'offline: the item is in the cart',
      (await page.textContent('.cart-item')).includes('wool blanket'),
      await page.textContent('.cart-item-name'));

    await page.evaluate(() => {
      localStorage.setItem('thrift-flip-drafts', JSON.stringify([{
        id: 1, title: 'Offline draft', condition: 'Good', price: '40', description: 'd',
        photos: [], goodwillPrice: 8, estProfit: 20, savedAt: 1750000000000, source: 'manual',
      }]));
      localStorage.setItem('thrift-flip-screen', 'drafts');
    });
    await page.reload({ waitUntil: 'load' });
    await ceremony(page);
    ok(S, 'offline: drafts still open and list their work',
      (await page.textContent('body')).includes('Offline draft'));

    // ── Cache discipline ───────────────────────────────────────────────────
    const entries = await page.evaluate(async () => {
      const out = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) out.push(request.url);
      }
      return out;
    });
    ok(S, 'nothing under /api/ is ever cached', !entries.some((u) => new URL(u).pathname.startsWith('/api/')),
      entries.filter((u) => u.includes('/api/')).join(', '));
    ok(S, 'nothing cross-origin is ever cached', entries.every((u) => new URL(u).origin === APP),
      entries.filter((u) => new URL(u).origin !== APP).join(', '));

    const apiOffline = await page.evaluate(() =>
      fetch('/api/ebay/proxy?path=sell%2Ffulfillment%2Fv1%2Forder')
        .then((r) => `resolved ${r.status}`, (e) => `rejected: ${e.name}`));
    ok(S, 'an offline /api/ GET rejects rather than serving a stale answer',
      apiOffline.startsWith('rejected'), apiOffline);

    const cacheNames = await page.evaluate(() => caches.keys());
    ok(S, 'exactly one cache exists, named for the build', cacheNames.length === 1
      && /^thrift-flip-[0-9a-f]{8}$/.test(cacheNames[0]), cacheNames.join(', '));

    await context.setOffline(false);
    await context.close();

    // ── A new deploy: the purge ────────────────────────────────────────────
    // Moving the JS bundle hash takes a real change to a JS source — editing
    // CSS moves only the stylesheet's name, which would let the assertion below
    // pass while comparing a filename that never changed.
    const probePath = join(ROOT, 'src', 'main.jsx');
    const original = await readFile(probePath, 'utf8');
    let secondBundle;
    try {
      console.log('  · appending a temporary marker to src/main.jsx to move the bundle hash');
      // A global write, not a comment: comments are minified away and the
      // emitted chunk would hash to exactly the same filename.
      await writeFile(probePath, `${original}\nwindow.__m1RebuildProbe = 'probe'\n`);
      build();
      secondBundle = await bundleName();
    } finally {
      await writeFile(probePath, original);
    }
    ok(S, 'the rebuild really did produce a different bundle', firstBundle !== secondBundle,
      `${firstBundle} -> ${secondBundle}`);

    const relaunch = async () => {
      // Same profile, so the registration and its caches are still there. A new
      // context is a new launch: closing the old one is what lets a waiting
      // worker take over, which is the whole mechanism under test.
      context = await chromium.launchPersistentContext(profile, { executablePath: exe, args: ['--no-sandbox'], ...PHONE });
      page = context.pages()[0] ?? await context.newPage();
      watch(page);
      await page.goto(`${APP}/`, { waitUntil: 'load' });
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      return {
        bundle: await page.evaluate(() => [...document.querySelectorAll('script[src]')]
          .map((s) => s.getAttribute('src')).join(',')),
        caches: await page.evaluate(() => caches.keys()),
      };
    };

    // ── Launch two: the new worker installs, and deliberately waits ────────
    const second = await relaunch();
    // Chrome does check /sw.js on navigation, but on its own schedule, and
    // closing the context mid-check cancels it. Asking directly makes the run
    // deterministic — what is under test is the worker's own behaviour once a
    // new one exists, not Chrome's update heuristics.
    const waiting = await waitForWaitingWorker(page);
    ok(S, 'the new worker installs, then waits its turn', waiting);
    ok(S, 'a deploy costs one launch: the old build is still what serves',
      second.bundle.includes(firstBundle), `serving ${second.bundle}`);
    const bothCaches = await page.evaluate(() => caches.keys());
    ok(S, 'the new build is precached beside the old one, not instead of it',
      bothCaches.length === 2, bothCaches.join(', '));
    await context.close();

    // ── Launch three: it takes over, and the old build goes ───────────────
    const third = await relaunch();
    ok(S, 'the next launch is running the new bundle', third.bundle.includes(secondBundle),
      `serving ${third.bundle}, expected ${secondBundle}`);
    ok(S, 'the previous build\'s cache is purged, not merely joined',
      third.caches.length === 1 && !third.caches.includes(second.caches[0]),
      `${second.caches.join(',')} -> ${third.caches.join(',')}`);

    const finalEntries = await page.evaluate(async () => {
      const cache = await caches.open((await caches.keys())[0]);
      return (await cache.keys()).map((r) => new URL(r.url).pathname);
    });
    ok(S, 'the surviving cache holds the new bundle and not the old',
      finalEntries.some((p) => p.includes(secondBundle)) && !finalEntries.some((p) => p.includes(firstBundle)),
      finalEntries.join(' '));
  } finally {
    await context.close().catch(() => {});
  }
}

// ── Dev suite: the worker must not outlive a preview ───────────────────────

// Serving dist/ on the port `npm run dev` later uses leaves a worker behind
// that answers navigations from its cached shell — so the dev server's HTML
// never loads and the unregister in main.jsx never runs. The dev-only kill
// switch at /sw.js is what breaks that, and this is the only thing that proves
// it still does.
async function devSuite(chromium, exe) {
  const S = 'dev';
  const devPort = PORT + 1;
  const devUrl = `http://localhost:${devPort}`;
  const profile = mkdtempSync(join(tmpdir(), 'thrift-flip-dev-'));
  const opts = { executablePath: exe, args: ['--no-sandbox'], ...PHONE };

  // The same dist/, on the port the dev server is about to take over.
  const preview = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, devUrl).pathname));
    const file = join(DIST, path === '/' ? 'index.html' : path);
    const target = file.startsWith(DIST) && existsSync(file) && extname(file) ? file : join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(target));
  });
  await new Promise((resolve) => preview.listen(devPort, () => resolve()));

  let context = await chromium.launchPersistentContext(profile, opts);
  let page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${devUrl}/`, { waitUntil: 'load' });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  ok(S, 'a preview of dist/ registers a worker on that port',
    (await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 1);
  await context.close();
  preview.close();

  const dev = spawn('npm', ['run', 'dev', '--', '--port', String(devPort)], { cwd: ROOT, stdio: 'ignore' });
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const up = await fetch(`${devUrl}/`).then(() => true, () => false);
      if (up) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    context = await chromium.launchPersistentContext(profile, opts);
    page = context.pages()[0] ?? await context.newPage();
    watch(page);
    await page.goto(`${devUrl}/`, { waitUntil: 'load' });

    let cleared = false;
    let live = false;
    const until = Date.now() + 15000;
    while (Date.now() < until && !(cleared && live)) {
      await page.waitForTimeout(500);
      cleared = (await page.evaluate(() => navigator.serviceWorker.getRegistrations()
        .then((r) => r.length)).catch(() => 1)) === 0;
      live = await page.content().then((html) => html.includes('/src/main.jsx')).catch(() => false);
    }
    ok(S, 'the dev kill switch unregisters the leftover worker', cleared);
    ok(S, 'the dev server\'s own HTML is what loads, not a cached shell', live);
    ok(S, 'and every cache it left behind is gone',
      (await page.evaluate(() => caches.keys())).length === 0);
    await context.close();
  } finally {
    dev.kill('SIGTERM');
  }
}

// ── The shipping estimate (M2) ─────────────────────────────────────────────

// M2 took the Ship field off the capture screen — nobody can weigh a lamp in an
// aisle — so the model's number is what the buy decision is now made on. These
// assertions are the difference between "the model said something" and "the
// verdict spent what the model said".
async function shippingSuite(chromium, exe) {
  const S = 'shipping';
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  watch(page);

  // estimate 94.50, cost 8.00, fee 13.25% + $0.30 = 12.82.
  const netFor = (ship) => (94.5 - 12.82 - ship - 8).toFixed(2);

  try {
    await stubGemini(page);
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await wipe(page);
    await enrolKey(page);

    for (const [label, pricing, ship, note] of [
      ['the model\'s figure is what gets spent', { shipping_estimate: 9 }, 9, 'AI estimate'],
      ['a response with no estimate falls back to the house figure', {}, 12, 'plain'],
      ['a nonsense low estimate is clamped up, not trusted', { shipping_estimate: 0.5 }, 4, 'AI estimate'],
      ['a nonsense high estimate is clamped down', { shipping_estimate: 250 }, 100, 'AI estimate'],
    ]) {
      await page.unroute(GEMINI);
      await stubGemini(page, pricing);
      await runVerdict(page);
      const rows = await earnings(page);
      const shippingRow = Object.entries(rows).find(([k]) => k.startsWith('Shipping label'));
      ok(S, `${label} — the line reads $${ship}`,
        shippingRow?.[1] === `−$${ship.toFixed(2)}`, `${shippingRow?.[0]} = ${shippingRow?.[1]}`);
      ok(S, `${label} — "You'd keep" agrees`,
        rows.TOTAL === `$${netFor(ship)}`, `${rows.TOTAL}, expected $${netFor(ship)}`);
      // The label has to say whose number it is, or a $4 clamp reads as measured.
      ok(S, `${label} — the row is labelled "${note}"`,
        note === 'AI estimate'
          ? shippingRow?.[0].includes('AI estimate')
          : !shippingRow?.[0].includes('AI estimate'),
        shippingRow?.[0]);
    }

    // The pencil screen never saw a model response, and says so.
    await page.unroute(GEMINI);
    await page.route(GEMINI, (route) => route.abort());
    await page.evaluate(() => {
      localStorage.removeItem('thrift-flip-shopping-verdict');
      localStorage.removeItem('thrift-flip-shopping-form');
      localStorage.setItem('thrift-flip-screen', 'shop');
    });
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await page.waitForSelector('.buy-cam', { timeout: 10000 });
    await page.setInputFiles('input[type=file]', {
      name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64'),
    });
    await page.fill('.buy-money-row .ui-input', '8');
    await page.click('.buy-details .ui-btn:has-text("Get the verdict")');
    await page.waitForSelector('.buy-barred', { timeout: 15000 });
    await ceremony(page);
    const pencil = await page.textContent('.buy-barred');
    ok(S, 'the pencil floor names its shipping as an estimate', pencil.includes('Fees + shipping (est. $12)'),
      pencil.match(/Fees \+ shipping[^−]*/)?.[0] ?? '');
    ok(S, 'and still lands on the $46.50 floor for an $8 item', pencil.includes('46.50'));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m2-pencil.png`, fullPage: true });
  } finally {
    await browser.close();
  }
}

// ── Comps tier A (V2) ──────────────────────────────────────────────────────
//
// The load-bearing claim this suite exists to prove is a NEGATIVE one: the
// verdict does not wait on comps. Everything else here is about honesty once
// they land.

const COMPS = '**/api/serpapi/comps**';

// A relay answer good enough to take the wheel: 6 sales, median $45, which
// against an $8 cost still clears both house rules.
const SOLD = {
  median: 45, low: 30, high: 62, count: 6, windowDays: 28, velocityPerWeek: 1.5,
  samples: [
    { title: 'Pendleton Wool Blanket Twin', price: 45, date: '2026-07-24', link: 'https://www.ebay.com/itm/111' },
    { title: 'Pendleton Beaver State Blanket', price: 52, date: '2026-07-18', link: 'https://www.ebay.com/itm/222' },
  ],
};

const stubComps = (page, body = SOLD, { delayMs = 0 } = {}) => page.route(COMPS, async (route) => {
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

const banner = (page) => page.evaluate(() => ({
  label: document.querySelector('.ui-verdict-label')?.textContent ?? '',
  detail: document.querySelector('.ui-verdict-detail')?.textContent ?? '',
}));

// Every case below analyses the SAME stubbed item, so the 7-day cache would
// answer case 2 with case 1's comps and never call the relay again — which is
// exactly what it is built to do on a real trip, and exactly what makes it
// useless here. Cleared between cases so each one measures its own stub.
const clearComps = (page) => page.evaluate(() => localStorage.removeItem('thrift-flip-comps'));

async function compsSuite(chromium, exe) {
  const S = 'comps';
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  watch(page);

  try {
    await stubGemini(page, { shipping_estimate: 9 });
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await wipe(page);
    await enrolKey(page);

    // ── 1. The verdict does not wait ────────────────────────────────────────
    // The relay is held for two seconds. If the verdict were awaiting it, the
    // Earnings panel would not exist yet — runVerdict would time out, or the
    // price would already be the sold one.
    await stubComps(page, SOLD, { delayMs: 2000 });
    await runVerdict(page);
    const atFirst = await earnings(page);
    ok(S, 'the verdict renders on the model price while comps are still in flight',
      atFirst['Item price'] === '$94.50', `Item price = ${atFirst['Item price']}`);
    ok(S, 'and the banner names the model, not sold data',
      (await banner(page)).detail.includes('model estimate'), (await banner(page)).detail);

    // ── 2. Comps land and take the wheel, in place ──────────────────────────
    await page.waitForFunction(() => [...document.querySelectorAll('.ui-panel-row-label')]
      .some((l) => l.textContent.includes('sold')), null, { timeout: 15000 });
    const after = await earnings(page);
    const priceRow = Object.entries(after).find(([k]) => k.startsWith('Item price'));
    ok(S, 'the sold median replaces the model price in place',
      priceRow?.[1] === '$45.00', `${priceRow?.[0]} = ${priceRow?.[1]}`);
    ok(S, 'the price row carries its provenance',
      priceRow?.[0] === 'Item price · 6 sold, last 28d', priceRow?.[0]);
    // 45 − (45*.1325+.30) − 9 − 8 = 21.74, and the panel must agree with itself.
    ok(S, '"You\'d keep" recomputed off the sold median',
      after.TOTAL === '$21.74', `${after.TOTAL}, expected $21.74`);
    const b = await banner(page);
    ok(S, 'the banner drops the confidence word once data replaced it',
      b.detail.includes('priced from 6 sold') && !b.detail.includes('confidence'), b.detail);
    ok(S, 'and it is still a BUY at $45', b.label === 'BUY IT', b.label);

    // ── 3. The Why sheet is a receipt ───────────────────────────────────────
    await page.click('.ui-panel-tap');
    await page.waitForSelector('.ui-sheet', { timeout: 5000 });
    const why = await page.textContent('.ui-sheet');
    ok(S, 'the receipt shows median, range and count', why.includes('Median $45.00')
      && why.includes('$30.00–$62.00') && why.includes('6 sold'), why.slice(0, 160));
    ok(S, 'it keeps the model\'s own estimate alongside for comparison',
      why.includes('It estimated $94.50'), why.slice(0, 200));
    ok(S, 'it answers "do they sell often?" without being asked',
      why.includes('Sells ~2/week'), why.match(/Sells[^.]*\./)?.[0] ?? 'no velocity line');
    const links = await page.$$eval('.ui-sheet a[href^="https://www.ebay.com/itm/"]', (a) => a.length);
    ok(S, 'and every sample is a real listing he can open', links === 2, `${links} links`);
    ok(S, 'the always-there eBay link survives', why.includes('See sold listings on eBay'));
    await page.keyboard.press('Escape');

    // ── 4. Thin data does NOT take the wheel ────────────────────────────────
    await page.unroute(COMPS);
    await clearComps(page);
    await stubComps(page, { ...SOLD, count: 2 });
    await runVerdict(page);
    await page.waitForTimeout(1200);
    const thin = await earnings(page);
    ok(S, 'two sales leave the model\'s price alone',
      thin['Item price'] === '$94.50', `Item price = ${thin['Item price']}`);
    await page.click('.ui-panel-tap');
    await page.waitForSelector('.ui-sheet', { timeout: 5000 });
    const thinWhy = await page.textContent('.ui-sheet');
    ok(S, 'and the sheet says so in as many words',
      thinWhy.includes('thin data'), thinWhy.match(/Only[^.]*\./)?.[0] ?? '');
    await page.keyboard.press('Escape');

    // ── 5. A flip is shown, not smoothed over ───────────────────────────────
    await page.unroute(COMPS);
    await clearComps(page);
    await stubComps(page, { ...SOLD, median: 20, low: 14, high: 26, count: 8 });
    await runVerdict(page);
    await page.waitForFunction(() => document.querySelector('.ui-verdict-label')?.textContent === 'LEAVE IT',
      null, { timeout: 15000 });
    const flipped = await banner(page);
    ok(S, 'sold data is allowed to reverse the verdict', flipped.label === 'LEAVE IT', flipped.label);
    ok(S, 'and the reversal is announced rather than swapped in silently',
      await page.isVisible('.toast'), 'no toast');

    // ── 6. Kill the relay: exactly today's app ──────────────────────────────
    await page.unroute(COMPS);
    await clearComps(page);
    await page.route(COMPS, (route) => route.abort());
    await runVerdict(page);
    await page.waitForTimeout(1200);
    const dark = await earnings(page);
    ok(S, 'a dead relay leaves the model price standing',
      dark['Item price'] === '$94.50', `Item price = ${dark['Item price']}`);
    ok(S, 'no row claims sold data',
      !Object.keys(dark).some((k) => k.includes('sold')), Object.keys(dark).join(' | '));
    // The measured reality today: eBay gates sold search and SerpApi does not
    // get through, so `unavailable` is the answer every real query returns.
    // That path is the DEFAULT one, and it has to be indistinguishable from V1.
    await page.unroute(COMPS);
    await clearComps(page);
    await stubComps(page, { unavailable: true });
    await runVerdict(page);
    await page.waitForTimeout(1200);
    const unavailable = await earnings(page);
    ok(S, 'an "unavailable" relay is indistinguishable from V1',
      unavailable['Item price'] === '$94.50' && unavailable.TOTAL === dark.TOTAL,
      `${unavailable['Item price']} / ${unavailable.TOTAL}`);
    const bannerDark = await banner(page);
    ok(S, 'and the banner falls back to naming the model at every confidence level',
      bannerDark.detail.includes('model estimate · medium confidence'), bannerDark.detail);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/v2-model-only.png`, fullPage: true });
  } finally {
    await browser.close();
  }
}

// ── The live viewfinder (M2) ───────────────────────────────────────────────

async function cameraSuite(chromium, exe) {
  const S = 'camera';

  // A fake device plus a fake permission UI: the stream Chrome hands back is a
  // rolling test pattern, which is all the frame grab needs.
  const live = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const context = await live.newContext({ ...PHONE, permissions: ['camera'] });
    const page = await context.newPage();
    watch(page);
    await stubGemini(page, { shipping_estimate: 9 });
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await wipe(page);
    await enrolKey(page);
    await page.evaluate(() => localStorage.setItem('thrift-flip-screen', 'shop'));
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await page.waitForSelector('.buy-cam', { timeout: 10000 });

    const streaming = await page.waitForFunction(() => {
      const v = document.querySelector('.buy-vf-video');
      return Boolean(v && v.videoWidth > 0 && v.videoHeight > 0);
    }, null, { timeout: 15000 }).then(() => true, () => false);
    ok(S, 'the viewfinder streams', streaming);
    ok(S, 'and the fallback brackets stay out of the way', (await page.$$('.buy-bk')).length === 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m2-viewfinder-live.png`, fullPage: true });

    await page.click('.ui-shutter');
    const shot = await page.waitForSelector('.buy-cam-ctl .ui-camside img', { timeout: 10000 })
      .then(() => true, () => false);
    ok(S, 'one tap on the shutter keeps a frame', shot);

    // The captured frame has to be a real photo — same downscale, same store,
    // same request — not a preview that only looks like one.
    const bytes = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('thrift-flip-photos');
        req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
      });
      const store = db.transaction('photos').objectStore('photos');
      const all = await new Promise((res) => { const r = store.getAll(); r.onsuccess = () => res(r.result); });
      const rows = all.flatMap((row) => row.photos ?? []);
      return rows.map((p) => ({ mimeType: p.mimeType, length: p.base64?.length ?? 0 }));
    }).catch(() => []);
    ok(S, 'the frame reached the photo store as jpeg bytes',
      bytes.some((b) => b.mimeType === 'image/jpeg' && b.length > 100), JSON.stringify(bytes));

    await page.fill('.buy-details .ui-input:not([type=number])', 'wool blanket');
    await page.fill('.buy-money-row .ui-input', '8');
    await page.click('.buy-details .ui-btn:has-text("Get the verdict")');
    await page.waitForSelector('.buy-barred', { timeout: 15000 });
    await ceremony(page);
    const reached = await page.waitForSelector('.buy-advisor-chat', { timeout: 20000 })
      .then(() => true, () => false);
    ok(S, 'a viewfinder photo analyzes end to end', reached);
    await context.close();
  } finally {
    await live.close();
  }

  // No fake UI this time: the permission is refused, which is the state the
  // fallback exists for. Nothing should nag, and the old path should be intact.
  const denied = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--deny-permission-prompts'],
  });
  try {
    const context = await denied.newContext({ ...PHONE, permissions: [] });
    const page = await context.newPage();
    watch(page);
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await wipe(page);
    await page.evaluate(() => localStorage.setItem('thrift-flip-screen', 'shop'));
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await page.waitForSelector('.buy-cam', { timeout: 10000 });

    const fellBack = await page.waitForSelector('.buy-bk', { timeout: 15000 }).then(() => true, () => false);
    ok(S, 'a refused camera falls back to the brackets', fellBack);
    ok(S, 'and no video element is left behind', (await page.$$('.buy-vf-video')).length === 0);
    ok(S, 'no permission nag appears', !(await page.textContent('body')).toLowerCase().includes('permission'));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m2-viewfinder-fallback.png`, fullPage: true });

    // The shutter must still open the native camera — i.e. click the file input.
    await page.evaluate(() => {
      window.__fileClicked = false;
      document.querySelector('input[type=file]').addEventListener('click', (e) => {
        e.preventDefault();            // no native picker in a headless run
        window.__fileClicked = true;
      });
    });
    await page.click('.ui-shutter');
    ok(S, 'the shutter still opens the native camera', await page.evaluate(() => window.__fileClicked));
    await context.close();
  } finally {
    await denied.close();
  }
}

// ── Viewport sweep ─────────────────────────────────────────────────────────

const TARGET_SEL = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

// Runs in the page. Reports the raw border box AND the effective one, so a
// pseudo-element halo can widen a target without ever hiding its real size.
function auditTargets(sel, min) {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.disabled) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.opacity === '0') continue;
    if (el.closest('[aria-hidden="true"]')) continue;

    let ew = rect.width;
    let eh = rect.height;
    const after = getComputedStyle(el, '::after');
    if (after.content !== 'none' && after.position === 'absolute') {
      ew = Math.max(ew, parseFloat(after.width) || 0);
      eh = Math.max(eh, parseFloat(after.height) || 0);
    }
    if (Math.max(ew, eh) >= min) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className?.baseVal ?? String(el.className ?? ''),
      label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30),
      raw: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      eff: `${Math.round(ew)}x${Math.round(eh)}`,
    });
  }
  return out;
}

async function auditView(page, id, S = 'sweep') {
  // Against the actual viewport, not a constant: the whole point of sweeping
  // four widths is that the number is different at each one.
  const { width, inner } = await page.evaluate(() => ({
    width: document.scrollingElement.scrollWidth, inner: window.innerWidth,
  }));
  ok(S, `${id}: no horizontal overflow`, width <= inner, `scrollWidth ${width} > innerWidth ${inner}`);

  const violations = await page.evaluate(
    ([sel, min]) => window.__audit(sel, min), [TARGET_SEL, MIN_TARGET],
  );
  const real = violations.filter((v) => !TARGET_ALLOWLIST.some((a) => v.cls.includes(a.match)));
  ok(S, `${id}: every target reaches ${MIN_TARGET}px`, real.length === 0,
    real.map((v) => `${v.tag}.${v.cls || '—'} "${v.label}" raw ${v.raw} eff ${v.eff}`).join(' | '));
  return real;
}

async function sweepSuite(chromium, exe, viewport = VIEWPORTS[2]) {
  const S = `sweep ${viewport.label}`;
  const auditAt = (page, id) => auditView(page, id, S);
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    ...PHONE, viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  watch(page);
  await page.addInitScript(`window.__audit = ${auditTargets.toString()}`);

  await stubGemini(page);

  try {
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await wipe(page);
    await enrolKey(page);

    const seen = [];

    // ── The live flow: capture → pencil → verdict → cart → listing → preview
    await page.evaluate(() => localStorage.setItem('thrift-flip-screen', 'shop'));
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await page.waitForSelector('.buy-cam', { timeout: 8000 });
    seen.push(...await auditAt(page, 'shop · capture'));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-sweep-${viewport.label}-capture.png`, fullPage: true });

    await page.setInputFiles('input[type=file]', {
      name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64'),
    });
    await page.waitForSelector('.buy-cam-ctl .ui-camside img', { timeout: 8000 });
    seen.push(...await auditAt(page, 'shop · capture with a photo'));

    // The sheet slides up over 300ms from translateY(100%), so for that whole
    // window the grabber is somewhere other than where it was just measured —
    // a touch aimed at it lands on the sheet body, which has no handler. Wait
    // for the box to stop moving, not merely for it to enter the viewport.
    const openSheet = async () => {
      await page.click('.ui-camside[aria-label="Manage photos"]');
      await page.waitForSelector('.ui-sheet', { timeout: 8000 });
      await page.evaluate(async () => {
        const el = document.querySelector('.ui-sheet');
        // One frame first, so the CSS animation is registered — querying before
        // it starts finds nothing to wait for and returns while the sheet is
        // still 100% below the fold.
        await new Promise(requestAnimationFrame);
        await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
      });
    };

    await openSheet();
    seen.push(...await auditAt(page, 'shop · photo sheet'));

    const gone = () => page.waitForSelector('.ui-sheet', { state: 'detached', timeout: 4000 })
      .then(() => true, () => false);

    await page.keyboard.press('Escape');
    ok(S, 'sheet: Escape dismisses it', await gone());

    // The swipe is a real touch gesture, not a click: the handler reads
    // touches[0].clientY on start and changedTouches[0].clientY on end, so a tap
    // with no delta between them would leave the gesture untested. CDP requires
    // touchPoints to be empty on touchEnd — the released point keeps whatever
    // position the last touchMove gave it, which is the whole delta.
    await openSheet();
    const cdp = await context.newCDPSession(page);
    const grab = await (await page.$('.ui-sheet-grab')).boundingBox();
    const x = grab.x + grab.width / 2;
    const y = grab.y + grab.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 140, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const swiped = await gone();
    ok(S, 'sheet: a downward swipe on the grabber dismisses it', swiped);
    if (!swiped) { await page.keyboard.press('Escape'); await gone(); }

    await page.fill('.buy-details .ui-input:not([type=number])', 'wool blanket');
    await page.fill('.buy-money-row .ui-input >> nth=0', '8');
    await page.click('.buy-details .ui-btn:has-text("Get the verdict")');
    await page.waitForSelector('.buy-barred', { timeout: 15000 });
    await ceremony(page);
    await page.waitForSelector('.buy-advisor-chat', { timeout: 20000 });
    seen.push(...await auditAt(page, 'shop · verdict'));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-sweep-${viewport.label}-verdict.png`, fullPage: true });

    // ── Fixed chrome, measured where it actually sits ──────────────────────
    const chrome = await page.evaluate(() => {
      const q = (s) => document.querySelector(s)?.getBoundingClientRect() ?? null;
      const nav = q('.ui-nav');
      const bar = q('.ui-actionbar');
      const cs = getComputedStyle(document.querySelector('.ui-nav'));
      return {
        navBottom: nav?.bottom, navTop: nav?.top, navHeight: nav?.height,
        barBottom: bar?.bottom, inner: window.innerHeight,
        navPad: cs.paddingBottom, barBottomStyle: getComputedStyle(document.querySelector('.ui-actionbar')).bottom,
        screenPad: getComputedStyle(document.querySelector('.screen')).paddingBottom,
      };
    });
    ok(S, 'NavBar sits on the bottom edge of the viewport', chrome.navBottom === chrome.inner,
      `${chrome.navBottom} vs ${chrome.inner}`);
    ok(S, 'ActionBar sits directly on top of the NavBar', chrome.barBottom === chrome.navTop,
      `${chrome.barBottom} vs ${chrome.navTop}`);
    ok(S, 'the screen clears the nav it scrolls under',
      parseFloat(chrome.screenPad) >= chrome.navHeight, `${chrome.screenPad} vs ${chrome.navHeight}px`);
    // Emulators resolve every safe-area inset to 0, so what is provable here is
    // that the calc() chains collapse cleanly to the zero case. Real insets are
    // runbook §11's job.
    ok(S, 'safe-area chains degrade to the 0 case: nav is 56px with no extra pad',
      chrome.navHeight === 56 && chrome.navPad === '0px', `${chrome.navHeight}px / pad ${chrome.navPad}`);
    ok(S, 'safe-area chains degrade to the 0 case: the action bar sits at 56px',
      chrome.barBottomStyle === '56px', chrome.barBottomStyle);

    await page.click('.ui-actionbar .ui-btn:has-text("Add to cart"), .ui-actionbar .ui-btn:has-text("Cart anyway")');
    await page.waitForTimeout(500);
    await page.evaluate(() => localStorage.setItem('thrift-flip-screen', 'cart'));
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await page.waitForSelector('.cart-item', { timeout: 8000 });
    await ceremony(page);
    seen.push(...await auditAt(page, 'cart'));

    await page.click('.cart-item-actions .ui-btn:has-text("Ready to list")');
    await ceremony(page, 4000);
    await page.waitForSelector('.distribution-row', { timeout: 20000 });
    seen.push(...await auditAt(page, 'listing'));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-sweep-${viewport.label}-listing.png`, fullPage: true });

    await page.click('.ui-btn:has-text("Preview")');
    await page.waitForSelector('.preview-back-btn', { timeout: 8000 });
    seen.push(...await auditAt(page, 'preview'));
    await page.click('.preview-back-btn');
    await page.waitForSelector('.listing-screen', { timeout: 8000 });

    // ── The remaining screens, reached by their persisted ids ──────────────
    const seeded = [
      ['flip', '.flip-screen'],
      ['history', '.screen'],
      ['drafts', '.screen'],
      ['uikit', '.uikitchen'],
    ];
    for (const [screen, wait] of seeded) {
      await page.evaluate((s) => localStorage.setItem('thrift-flip-screen', s), screen);
      await page.goto(`${APP}/`, { waitUntil: 'load' });
      await page.waitForSelector(wait, { timeout: 10000 });
      await ceremony(page);
      seen.push(...await auditAt(page, screen));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-sweep-${viewport.label}-${screen}.png`, fullPage: true });
    }

    // The Flip thread, which only a click reaches.
    await page.evaluate(() => localStorage.setItem('thrift-flip-screen', 'flip'));
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await page.waitForSelector('.flip-screen', { timeout: 10000 });
    const conv = await page.$('.conv-row, .ui-row');
    if (conv) {
      await conv.click();
      await page.waitForTimeout(600);
      await ceremony(page);
      seen.push(...await auditAt(page, 'flip · thread'));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-sweep-${viewport.label}-flip-thread.png`, fullPage: true });

      // The failed-message state carries a Retry link that no other route
      // reaches, so it gets measured rather than assumed. Killing the request
      // is the only way in.
      await page.unroute(GEMINI);
      await page.route(GEMINI, (route) => route.abort());
      await page.fill('.chat-input-row .ui-textarea', 'Is this worth listing?');
      await page.click('.chat-input-row .ui-iconbtn');
      await ceremony(page);
      const failed = await page.waitForSelector('.chat-failed', { timeout: 20000 }).catch(() => null);
      ok(S, 'flip · thread: a killed request offers Retry rather than silence', Boolean(failed));
      if (failed) seen.push(...await auditAt(page, 'flip · thread, message failed'));
      await page.unroute(GEMINI);
      await stubGemini(page);
    }

    for (const view of ['main', 'ai-key', 'ebay']) {
      await page.evaluate((v) => {
        localStorage.setItem('thrift-flip-screen', 'settings');
        localStorage.setItem('thrift-flip-settings-view', v);
      }, view);
      await page.goto(`${APP}/`, { waitUntil: 'load' });
      await page.waitForSelector('.settings', { timeout: 10000 });
      await ceremony(page);
      seen.push(...await auditAt(page, `settings · ${view}`));
    }

    // ── Landscape: not optimised for, but it must not break ────────────────
    const before = consoleErrors.length;
    const landscape = { width: viewport.height, height: viewport.width };
    await page.setViewportSize(landscape);
    await page.evaluate(() => localStorage.setItem('thrift-flip-screen', 'history'));
    await page.goto(`${APP}/`, { waitUntil: 'load' });
    await page.waitForSelector('.screen', { timeout: 10000 });
    await ceremony(page);
    const land = await page.evaluate(() => ({
      width: document.scrollingElement.scrollWidth,
      left: document.getElementById('root').getBoundingClientRect().left,
    }));
    ok(S, 'landscape: no horizontal overflow', land.width <= landscape.width, `scrollWidth ${land.width}`);
    // Narrower than the column means it fills the width; wider means centred.
    const expectedLeft = Math.max(0, (landscape.width - 390) / 2);
    ok(S, 'landscape: the column stays centred', Math.abs(land.left - expectedLeft) < 2, `left ${land.left}`);
    ok(S, 'landscape: nothing threw', consoleErrors.length === before,
      consoleErrors.slice(before).join(' | '));

    if (seen.length) {
      console.log('\nTarget-size violations still standing:');
      for (const v of seen) console.log(`  ${v.tag}.${v.cls} "${v.label}" raw ${v.raw} eff ${v.eff}`);
    }
  } catch (e) {
    // A timeout says which selector, never which screen. The shot says both.
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-sweep-${viewport.label}-stopped.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
}

// ── Run ────────────────────────────────────────────────────────────────────

const { chromium, exe } = await resolveChromium();
console.log('building…');
build();
const server = await serveDist();
console.log(`serving dist/ at ${APP}`);

try {
  if (runs('--pwa')) await pwaSuite(chromium, exe);
  if (runs('--dev')) await devSuite(chromium, exe);
  if (runs('--camera')) await cameraSuite(chromium, exe);
  if (runs('--shipping')) await shippingSuite(chromium, exe);
  if (runs('--comps')) await compsSuite(chromium, exe);
  if (runs('--sweep')) {
    for (const viewport of SWEEP_VIEWPORTS) {
      console.log(`sweeping ${viewport.label}…`);
      await sweepSuite(chromium, exe, viewport);
    }
  }
} catch (e) {
  ok('run', 'the harness completed', false, String(e).split('\n')[0]);
} finally {
  server.close();
}

let failed = 0;
let section = null;
for (const r of results) {
  if (r.section !== section) { section = r.section; console.log(`\n── ${section} ──`); }
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail && !r.pass ? `  -- ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log('CONSOLE_ERRORS:', consoleErrors.length ? JSON.stringify(consoleErrors, null, 1) : 'none');
for (const entry of TARGET_ALLOWLIST) console.log(`allowlisted: .${entry.match} — ${entry.reason}`);
process.exit(failed || consoleErrors.length ? 1 : 0);
