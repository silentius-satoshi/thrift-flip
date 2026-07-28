import { DEFAULT_SHIPPING } from '../config/gemini';

// Note: this 5.00 default predates the shipping input and is still relied on by
// the listing/draft paths. The Buy flow always passes shipping explicitly.
export function calcProfit(sellPrice, goodwillPrice, shipping = 5.00) {
  const ebayFee = parseFloat((sellPrice * 0.1325 + 0.30).toFixed(2));
  const net = parseFloat((sellPrice - ebayFee - shipping - goodwillPrice).toFixed(2));
  return { ebayFee, net };
}

export function checkRules(sellPrice, goodwillPrice, profit) {
  const rule1 = sellPrice >= goodwillPrice * 3;
  const rule2 = profit >= 20;
  return { rule1, rule2, verdict: rule1 && rule2 ? 'buy' : 'skip' };
}

/**
 * Is this a cost basis the rules above can actually be applied to?
 *
 * Against `goodwillPrice = 0`, `checkRules`' 3× test reads `sellPrice >= 0` —
 * true for a **$1** item, so a missing price does not fail the rule, it
 * *silences* it, and the verdict comes back confident and meaningless. Every
 * door into an analysis has to ask this first.
 *
 * A predicate rather than an inline `parseFloat` because `Number('')` and
 * `Number(null)` are both `0` — finite, non-negative, and wrong. That coercion
 * has already cost this codebase one shipping bug.
 */
export function usablePrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

// The inversion of the two rules: the smallest sell price that satisfies both at
// once (plan §6.1). Rounded up to the nearest $0.50 so the pencil tag reads like
// a price. Canonical case: pencilFloor(8, 12) === 46.50.
export function pencilFloor(goodwillPrice, shipping = DEFAULT_SHIPPING) {
  const gp = Number(goodwillPrice) || 0;
  // A cleared shipping field is "unset", not "free" — Number('') is 0, and
  // treating that as zero shipping would quietly understate the floor.
  const ship = shipping === '' || shipping === null || shipping === undefined
    ? DEFAULT_SHIPPING
    : Number(shipping);
  const shipCost = Number.isFinite(ship) ? ship : DEFAULT_SHIPPING;
  const threeTimes = gp * 3;
  const twentyNet = (20 + 0.30 + shipCost + gp) / (1 - 0.1325);
  return Math.ceil(Math.max(threeTimes, twentyNet) * 2) / 2;
}
