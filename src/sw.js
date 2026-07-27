// The service worker. Nothing imports this file — it is not part of the React
// bundle. `vite.config.js`'s `thrift-flip-sw` plugin substitutes the two
// placeholders below and writes the result to `dist/sw.js` at build time, so
// the shipped worker knows the exact hashed filenames of the build it belongs
// to. It lives here rather than in `public/` because public files are copied
// verbatim: an unsubstituted `/sw.js` would otherwise be served in dev.
//
// Why it exists: the pencil floor is figured on the phone and is supposed to be
// useful with no signal at all. Without this, the app still needed a network
// round trip to *launch*, which is exactly what a Goodwill basement doesn't
// have.

const BUILD_ID = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;
const CACHE = `thrift-flip-${BUILD_ID}`;

// One cache per build, so HTML and its hashed assets can never come from
// different versions. `activate` deletes every other one.

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // `cache: 'reload'` so the HTTP cache cannot hand the worker a stale shell —
    // addAll() would otherwise happily precache the previous deploy.
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
  })());
  // Deliberately no skipWaiting(). A new worker taking over mid-session would
  // mean a reload while Dad is looking at a verdict in the aisle, and eating a
  // verdict is worse than shipping a fix a launch late. The cost is real and
  // accepted: a deploy reaches him on his *next* launch, not this one.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    // Safe despite the note above: a waiting worker does not activate while an
    // old client is still open, so claiming cannot reload anyone mid-trip.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Every skip below is a bare return, not respondWith(fetch(request)) — that
  // would put the worker in the middle of a request it has no opinion about,
  // and swallow errors the page needs to see.

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // Gemini, eBay, anything else

  // The relays must always hit the network. This is not defensive: E3's inbound
  // refresh reads sold orders with GET /api/ebay/proxy?path=sell/fulfillment/...,
  // so a cache-first rule here would freeze the sold history permanently.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // The shell answers for any path, which is what keeps eBay's OAuth return
    // working: the address bar still reads /ebay/callback?code=…, so
    // isEbayCallback() finds its query exactly as it does online.
    event.respondWith((async () => {
      const cached = await caches.match('/index.html');
      return cached ?? fetch(request);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    // Anything the precache manifest missed — a lazily-loaded chunk, an icon
    // referenced from CSS — earns its place on first use.
    if (response.ok && response.type === 'basic') {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  })());
});
