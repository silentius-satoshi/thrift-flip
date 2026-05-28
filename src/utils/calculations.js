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
