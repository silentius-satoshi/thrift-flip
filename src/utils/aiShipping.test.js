import { describe, it, expect } from 'vitest';
import { resolveShipping, SHIPPING_MIN, SHIPPING_MAX } from './ai';
import { DEFAULT_SHIPPING } from '../config/gemini';

// M2 took the Ship field off the capture screen — Dad cannot know postage while
// holding an unweighed object in an aisle — and gave the number to the model.
// That makes this function the thing standing between a hallucination and a buy
// decision, so it is pinned harder than its four lines suggest.
describe('resolveShipping', () => {
  it('uses the model\'s figure when it is a sane one', () => {
    expect(resolveShipping({ shipping_estimate: 9 })).toBe(9);
    expect(resolveShipping({ shipping_estimate: 4 })).toBe(4);
    expect(resolveShipping({ shipping_estimate: 100 })).toBe(100);
  });

  // A hallucinated 0 makes every item look profitable; a hallucinated 900 makes
  // every item a skip. Both are worse than the house default.
  it('clamps at both bounds rather than trusting the number', () => {
    expect(resolveShipping({ shipping_estimate: 0 })).toBe(SHIPPING_MIN);
    expect(resolveShipping({ shipping_estimate: 0.5 })).toBe(SHIPPING_MIN);
    expect(resolveShipping({ shipping_estimate: -20 })).toBe(SHIPPING_MIN);
    expect(resolveShipping({ shipping_estimate: 250 })).toBe(SHIPPING_MAX);
    expect(resolveShipping({ shipping_estimate: 1e9 })).toBe(SHIPPING_MAX);
  });

  // Anything from before the M2 schema, and anything the model fumbles.
  it.each([
    ['the field is absent', {}],
    ['pricing is absent', undefined],
    ['pricing is null', null],
    ['it came back null', { shipping_estimate: null }],
    ['it came back as prose', { shipping_estimate: 'about twelve dollars' }],
    ['it came back NaN', { shipping_estimate: NaN }],
    ['it came back Infinity', { shipping_estimate: Infinity }],
  ])('falls back to the house figure when %s', (_label, pricing) => {
    expect(resolveShipping(pricing)).toBe(DEFAULT_SHIPPING);
  });

  it('takes a caller-supplied fallback over the house one', () => {
    expect(resolveShipping({}, 7)).toBe(7);
  });

  // A numeric string is what a model that ignores the NUMBER type returns; it
  // is unambiguous, so it is honoured rather than thrown away.
  it('accepts a numeric string, and still clamps it', () => {
    expect(resolveShipping({ shipping_estimate: '9.5' })).toBe(9.5);
    expect(resolveShipping({ shipping_estimate: '999' })).toBe(SHIPPING_MAX);
  });

  it('leaves the empty string as a fallback, not a zero', () => {
    // Number('') is 0, which would clamp to the floor and silently look real.
    expect(resolveShipping({ shipping_estimate: '' })).toBe(DEFAULT_SHIPPING);
  });
});
