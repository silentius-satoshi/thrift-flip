import { describe, it, expect } from 'vitest';
import { calcProfit, checkRules, pencilFloor, usablePrice } from './calculations';

describe('calcProfit', () => {
  it('takes 13.25% + $0.30 in fees', () => {
    // 100 * 0.1325 + 0.30 = 13.55
    expect(calcProfit(100, 8, 12).ebayFee).toBe(13.55);
  });

  it('nets sell price minus fees, shipping and cost', () => {
    // 100 - 13.55 - 12 - 8 = 66.45
    expect(calcProfit(100, 8, 12).net).toBe(66.45);
  });

  it('rounds the fee to cents rather than carrying float dust', () => {
    // 94.50 * 0.1325 + 0.30 = 12.82125 -> 12.82
    const { ebayFee, net } = calcProfit(94.5, 8, 12);
    expect(ebayFee).toBe(12.82);
    expect(net).toBe(61.68); // the canonical earnings-panel example
  });

  it('defaults shipping to 5.00 for the listing/draft paths', () => {
    expect(calcProfit(100, 8).net).toBe(calcProfit(100, 8, 5).net);
  });

  it('can go negative on a bad flip', () => {
    expect(calcProfit(10, 9, 12).net).toBeLessThan(0);
  });
});

describe('checkRules', () => {
  it('passes both rules on a clean buy', () => {
    expect(checkRules(94.5, 8, 61.68)).toEqual({ rule1: true, rule2: true, verdict: 'buy' });
  });

  it('treats exactly 3x as passing rule1', () => {
    expect(checkRules(24, 8, 25).rule1).toBe(true);
  });

  it('fails rule1 just under 3x', () => {
    const { rule1, verdict } = checkRules(23.99, 8, 25);
    expect(rule1).toBe(false);
    expect(verdict).toBe('skip');
  });

  it('treats exactly $20 net as passing rule2', () => {
    expect(checkRules(100, 8, 20).rule2).toBe(true);
  });

  it('fails rule2 just under $20 net', () => {
    const { rule2, verdict } = checkRules(100, 8, 19.99);
    expect(rule2).toBe(false);
    expect(verdict).toBe('skip');
  });

  it('needs both rules for a buy', () => {
    expect(checkRules(100, 40, 25).verdict).toBe('skip'); // 2.5x, good net
    expect(checkRules(30, 8, 5).verdict).toBe('skip');    // 3.75x, thin net
  });
});

describe('pencilFloor', () => {
  it('hits the canonical $46.50 at gp=8, shipping=12', () => {
    // (20 + 0.30 + 12 + 8) / 0.8675 = 46.455... -> 46.50
    expect(pencilFloor(8, 12)).toBe(46.5);
  });

  it('lets the 3x rule dominate on expensive items', () => {
    // 3 * 60 = 180 beats (20.30 + 12 + 60) / 0.8675 = 106.4
    expect(pencilFloor(60, 12)).toBe(180);
  });

  it('lets the $20-net rule dominate on cheap items', () => {
    // 3 * 2 = 6 loses to (20.30 + 12 + 2) / 0.8675 = 39.54 -> 39.50 rounds up to 40
    expect(pencilFloor(2, 12)).toBe(40);
  });

  it('always rounds up, never down', () => {
    for (const gp of [1, 3.5, 7, 12.25, 33]) {
      const floor = pencilFloor(gp, 12);
      const exact = Math.max(gp * 3, (20.3 + 12 + gp) / 0.8675);
      expect(floor).toBeGreaterThanOrEqual(exact);
      expect(floor - exact).toBeLessThan(0.5);
    }
  });

  it('lands on a half-dollar boundary', () => {
    for (const gp of [1, 8, 19.99, 47.5]) {
      expect((pencilFloor(gp, 12) * 100) % 50).toBe(0);
    }
  });

  it('moves with shipping', () => {
    expect(pencilFloor(8, 25)).toBeGreaterThan(pencilFloor(8, 12));
  });

  it('defaults shipping to 12 — the figure the docs are written against', () => {
    expect(pencilFloor(8)).toBe(46.5);
  });

  it('survives blank input from the form', () => {
    expect(pencilFloor('', 12)).toBe(pencilFloor(0, 12));
    expect(pencilFloor(8, '')).toBe(pencilFloor(8, 12));
    expect(Number.isFinite(pencilFloor(undefined, undefined))).toBe(true);
  });

  it('clears both house rules at the floor price', () => {
    for (const gp of [2, 8, 15, 60]) {
      const floor = pencilFloor(gp, 12);
      const { net } = calcProfit(floor, gp, 12);
      const { rule1, rule2 } = checkRules(floor, gp, net);
      expect(rule1).toBe(true);
      expect(rule2).toBe(true);
    }
  });
});

describe('usablePrice — the guard on the 3x rule', () => {
  // W1: he sometimes photographs a thing without reading the tag. This is why
  // that cannot reach an analysis — not a style preference about empty fields.
  it('records the hazard it exists to prevent', () => {
    // Against a cost basis of zero the 3x test reads `sellPrice >= 0`, so it
    // does not fail — it stops meaning anything, and a $1 item passes.
    expect(checkRules(1, 0, 64).rule1).toBe(true);
    expect(checkRules(0.01, 0, 64).rule1).toBe(true);
    // With a real cost basis the same call discriminates, as it should.
    expect(checkRules(1, 8, 64).rule1).toBe(false);
  });

  it('accepts a price the rules can be applied to', () => {
    expect(usablePrice('8')).toBe(true);
    expect(usablePrice(8)).toBe(true);
    expect(usablePrice('0.5')).toBe(true);
    expect(usablePrice(' 12 ')).toBe(true);
  });

  // Number('') and Number(null) are both 0 — finite, non-negative and wrong.
  // The same coercion that turned a missing shipping estimate into $4 at M2.
  it.each([
    ['an untouched field', ''],
    ['a whitespace-only field', '   '],
    ['an explicit zero', '0'],
    ['a numeric zero', 0],
    ['a negative', -5],
    ['null', null],
    ['undefined', undefined],
    ['prose', 'about eight dollars'],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('refuses %s', (_label, value) => {
    expect(usablePrice(value)).toBe(false);
  });
});
