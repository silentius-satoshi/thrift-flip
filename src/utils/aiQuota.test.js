// The two 429s.
//
// H2 hit the daily one on a real key: analysis died at call four, and the cap
// turned out to be `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit
// **20 a day**, against a Saturday of ~35 items. The per-minute cap clears on
// its own; the daily one does not, and telling him to "try again in a minute"
// when the honest answer is "tomorrow" is the exact misdiagnosis ERROR_COPY
// exists to prevent.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { isDailyQuota, analyzeItem } = await import('./ai');
const { primeSession, __testSeam } = await import('./credentials');

// The body H2 actually captured, trimmed to the fields that matter.
const DAILY_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{
        quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
        quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        quotaValue: '20',
      }],
    }],
  },
});

const PER_MINUTE_BODY = JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '15' }],
    }],
  },
});

beforeEach(async () => {
  store.clear();
  vi.unstubAllEnvs();
  await __testSeam.resetAll();
});

describe('isDailyQuota', () => {
  it('recognises the daily cap from the quota id H2 measured', () => {
    expect(isDailyQuota(DAILY_BODY)).toBe(true);
  });

  it('does not mistake the per-minute cap for it', () => {
    expect(isDailyQuota(PER_MINUTE_BODY)).toBe(false);
  });

  // Best-effort by design. A body that cannot be read keeps the generic copy,
  // because a wrong "come back tomorrow" is worse than a vague "out of calls" —
  // it would send him home on a Saturday that still had calls left.
  it.each([
    ['an empty body', ''],
    ['undefined', undefined],
    ['null', null],
    ['an HTML error page from a proxy', '<html><body>429 Too Many Requests</body></html>'],
    ['a body with no quota information', JSON.stringify({ error: { code: 429 } })],
    ['a non-string', { error: 'PerDay' }],
  ])('falls back to the generic code for %s', (_label, body) => {
    expect(isDailyQuota(body)).toBe(false);
  });
});

describe('analyzeItem, on a 429', () => {
  const respond = (body) => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => body,
      json: async () => JSON.parse(body),
    });
  };

  it('throws quota-daily when the cap is the daily one', async () => {
    primeSession('ai-key', 'AIzaSyDUMMY');
    respond(DAILY_BODY);
    await expect(analyzeItem({ details: 'mug', goodwillPrice: 4 }))
      .rejects.toMatchObject({ code: 'quota-daily' });
  });

  it('throws plain quota when the cap is per-minute', async () => {
    primeSession('ai-key', 'AIzaSyDUMMY');
    respond(PER_MINUTE_BODY);
    await expect(analyzeItem({ details: 'mug', goodwillPrice: 4 }))
      .rejects.toMatchObject({ code: 'quota' });
  });

  it('throws plain quota when the body cannot be read at all', async () => {
    primeSession('ai-key', 'AIzaSyDUMMY');
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => { throw new Error('stream already consumed'); },
    });
    await expect(analyzeItem({ details: 'mug', goodwillPrice: 4 }))
      .rejects.toMatchObject({ code: 'quota' });
  });

  // Reading the body is new behaviour on a failing path, so this pins that it
  // did not disturb the other statuses — a 403 must still be a bad key.
  it.each([
    [403, 'bad-key'],
    [400, 'bad-key'],
    [500, 'bad-response'],
  ])('still maps %i to %s', async (status, code) => {
    primeSession('ai-key', 'AIzaSyDUMMY');
    globalThis.fetch = async () => ({ ok: false, status, text: async () => DAILY_BODY });
    await expect(analyzeItem({ details: 'mug', goodwillPrice: 4 }))
      .rejects.toMatchObject({ code });
  });

  // The error carries a code and nothing else — never the body it just read,
  // and never the URL, which is where the key travels.
  it('carries no key material out with the new code', async () => {
    primeSession('ai-key', 'AIzaSyDUMMY');
    respond(DAILY_BODY);
    const e = await analyzeItem({ details: 'mug', goodwillPrice: 4 }).catch(x => x);
    expect(e.code).toBe('quota-daily');
    expect(JSON.stringify({ m: e.message, s: e.stack ?? '' })).not.toContain('AIzaSyDUMMY');
  });
});
