import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The worker is a classic script, so there is nothing to import — the build
// substitutes its placeholders and writes it to dist/. These specs do the same
// substitution and run it against stubbed worker globals, which is the only way
// to exercise the routing rules without a browser. What they pin is the part a
// browser test cannot easily prove absent: that /api/* and cross-origin
// requests never reach the cache at all.

const ORIGIN = 'https://thrift.example';
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sw.js'), 'utf8');

const ASSET = '/assets/index-AAAA1111.js';
const MANIFEST = ['/', '/manifest.webmanifest', '/index.html', ASSET];

// Responses are plain objects, not undici Response instances: a real same-origin
// fetch has type 'basic', which cannot be set on a constructed Response.
const netResponse = (body, extra = {}) => ({
  ok: true, type: 'basic', body, ...extra,
  clone() { return netResponse(body, extra); },
});

class FakeRequest {
  constructor(url, init = {}) {
    this.url = new URL(url, ORIGIN).href;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'no-cors';
    this.cache = init.cache;
  }
}

function harness({ manifest = MANIFEST, existingCaches = [] } = {}) {
  const stores = new Map(existingCaches.map((name) => [name, new Map()]));
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;

  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      addAll: async (requests) => {
        for (const r of requests) {
          addAllSaw.push(r);
          store.set(key(r), netResponse(`precached:${key(r)}`));
        }
      },
      match: async (r) => store.get(key(r)),
      put: async (r, res) => { store.set(key(r), res); },
    };
  };

  const addAllSaw = [];
  const cachesApi = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (r) => {
      for (const store of stores.values()) {
        const hit = store.get(key(r));
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const fetches = [];
  const fetchStub = async (request) => {
    fetches.push(typeof request === 'string' ? request : request.url);
    return netResponse(`network:${key(request)}`);
  };

  const listeners = new Map();
  let claimed = false;
  const selfStub = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    location: new URL(`${ORIGIN}/sw.js`),
    clients: { claim: async () => { claimed = true; } },
  };

  const source = SRC
    .replace('__BUILD_ID__', 'testbuild')
    .replace('__PRECACHE__', JSON.stringify(manifest));
  // Evaluating the shipped worker's own text is the point — a copy of its
  // routing rules in a test file would prove nothing about what ships.
  new Function('self', 'caches', 'fetch', 'Request', source)(selfStub, cachesApi, fetchStub, FakeRequest);

  async function dispatch(type, event) {
    listeners.get(type)(event);
    await Promise.all(event.__waits);
    return event;
  }

  const lifecycle = () => {
    const waits = [];
    return { waitUntil: (p) => waits.push(p), __waits: waits };
  };

  async function request(url, init) {
    const waits = [];
    let responded;
    await dispatch('fetch', {
      request: new FakeRequest(url, init),
      respondWith: (p) => { responded = p; },
      waitUntil: (p) => waits.push(p),
      __waits: waits,
    });
    // Write-back rides waitUntil, so settle it before anyone inspects the cache.
    const response = responded === undefined ? undefined : await responded;
    await Promise.all(waits);
    return { handled: responded !== undefined, response };
  }

  return {
    install: () => dispatch('install', lifecycle()),
    activate: () => dispatch('activate', lifecycle()),
    request,
    cacheNames: () => [...stores.keys()],
    entries: (name) => [...(stores.get(name)?.keys() ?? [])],
    allEntries: () => [...stores.values()].flatMap((s) => [...s.keys()]),
    fetches,
    addAllSaw,
    claimed: () => claimed,
  };
}

describe('service worker — install and activate', () => {
  it('precaches the whole manifest into the build-named cache', async () => {
    const sw = harness();
    await sw.install();
    expect(sw.cacheNames()).toEqual(['thrift-flip-testbuild']);
    expect(sw.entries('thrift-flip-testbuild')).toEqual(
      MANIFEST.map((u) => new URL(u, ORIGIN).href),
    );
  });

  it('precaches with cache:reload so the HTTP cache cannot supply a stale shell', async () => {
    const sw = harness();
    await sw.install();
    expect(sw.addAllSaw).toHaveLength(MANIFEST.length);
    expect(sw.addAllSaw.every((r) => r.cache === 'reload')).toBe(true);
  });

  it('activate deletes every other build and keeps this one', async () => {
    const sw = harness({ existingCaches: ['thrift-flip-oldbuild', 'thrift-flip-older'] });
    await sw.install();
    await sw.activate();
    expect(sw.cacheNames()).toEqual(['thrift-flip-testbuild']);
    expect(sw.claimed()).toBe(true);
  });
});

describe('service worker — what it refuses to touch', () => {
  let sw;
  beforeEach(async () => {
    sw = harness();
    await sw.install();
  });

  it('ignores non-GET entirely', async () => {
    const { handled } = await sw.request(ASSET, { method: 'POST' });
    expect(handled).toBe(false);
    expect(sw.fetches).toEqual([]);
  });

  it('ignores cross-origin requests — Gemini is never cached', async () => {
    const { handled } = await sw.request(
      'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',
    );
    expect(handled).toBe(false);
    expect(sw.allEntries().some((u) => u.includes('googleapis'))).toBe(false);
  });

  it('ignores GET /api/* — E3 reads sold orders through the proxy with GET', async () => {
    // A cache-first rule here would freeze the sold history permanently: the
    // first getOrders answer would be served forever.
    const path = '/api/ebay/proxy?path=sell%2Ffulfillment%2Fv1%2Forder';
    const { handled } = await sw.request(path);
    expect(handled).toBe(false);
    expect(sw.fetches).toEqual([]);
    expect(sw.allEntries().some((u) => u.includes('/api/'))).toBe(false);
  });

  it('ignores an /api/* GET even after one has already gone out', async () => {
    await sw.request('/api/ebay/proxy?path=sell%2Finventory%2Fv1%2Foffer%2F1');
    const { handled } = await sw.request('/api/ebay/proxy?path=sell%2Finventory%2Fv1%2Foffer%2F1');
    expect(handled).toBe(false);
    expect(sw.allEntries().some((u) => u.includes('/api/'))).toBe(false);
  });
});

describe('service worker — what it serves', () => {
  let sw;
  beforeEach(async () => {
    sw = harness();
    await sw.install();
  });

  it('answers any navigation with the precached shell, network untouched', async () => {
    const { response } = await sw.request('/', { mode: 'navigate' });
    expect(response.body).toBe(`precached:${ORIGIN}/index.html`);
    expect(sw.fetches).toEqual([]);
  });

  it('answers the eBay OAuth return with the shell too, so the query survives', async () => {
    // handleCallback reads the code off location, which the worker never rewrites.
    const { response } = await sw.request('/ebay/callback?code=abc&state=xyz', { mode: 'navigate' });
    expect(response.body).toBe(`precached:${ORIGIN}/index.html`);
  });

  it('serves a precached asset without going to the network', async () => {
    const { response } = await sw.request(ASSET);
    expect(response.body).toBe(`precached:${ORIGIN}${ASSET}`);
    expect(sw.fetches).toEqual([]);
  });

  it('fetches an unlisted asset once, then serves it from cache', async () => {
    const late = '/assets/lazy-BBBB2222.js';
    const first = await sw.request(late);
    expect(first.response.body).toBe(`network:${ORIGIN}${late}`);
    expect(sw.fetches).toHaveLength(1);

    const second = await sw.request(late);
    expect(second.response.body).toBe(`network:${ORIGIN}${late}`);
    expect(sw.fetches).toHaveLength(1);
  });
});
