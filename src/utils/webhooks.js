const BASE = import.meta.env.VITE_N8N_BASE_URL;

async function callWebhook(path, data) {
  const response = await fetch(`${BASE}/webhook/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Webhook ${path} failed: ${response.status}`);
  return response.json();
}

function calcProfitLocal(sellPrice, goodwillPrice, shipping = 5.00) {
  const ebayFee = parseFloat((sellPrice * 0.1325 + 0.30).toFixed(2));
  const net = parseFloat((sellPrice - ebayFee - shipping - goodwillPrice).toFixed(2));
  return { ebayFee, net };
}

function generateRecentSales(estSellPrice) {
  return Array.from({ length: 5 }, (_, i) => ({
    price: parseFloat((estSellPrice * (0.82 + Math.random() * 0.36)).toFixed(2)),
    daysAgo: Math.floor(i * 2.5 + Math.random() * 4 + 1),
  })).sort((a, b) => a.daysAgo - b.daysAgo);
}

// TODO: replace with real webhook when n8n is ready
export async function analyzeItem({ photoBase64, details, condition, goodwillPrice }) {
  await new Promise(r => setTimeout(r, 2400));
  const multiplier = 3.2 + Math.random() * 2.4;
  const estSellPrice = parseFloat((goodwillPrice * multiplier).toFixed(2));
  const { ebayFee, net } = calcProfitLocal(estSellPrice, goodwillPrice);
  const demandScore = Math.floor(Math.random() * 45) + 45;
  const avgDaysToSell = Math.floor(Math.random() * 12) + 2;
  return {
    estSellPrice,
    fees: ebayFee,
    shipping: 5.00,
    netProfit: net,
    soldCount: Math.floor(Math.random() * 70) + 20,
    sellThroughRate: Math.floor(Math.random() * 40) + 45,
    avgDaysToSell,
    activeListings: Math.floor(Math.random() * 35) + 5,
    recentSales: generateRecentSales(estSellPrice),
    demandScore,
    strategyNote: 'List on weekday mornings for best visibility. Clear photos with neutral backgrounds convert 23% better. Price at the lower end of the range to sell within 7 days.',
    tipText: `Price at $${(estSellPrice * 0.92).toFixed(0)}–$${estSellPrice.toFixed(0)} for fastest sale. ${avgDaysToSell <= 5 ? 'Fast-moving category — list ASAP.' : 'Consider a 7-day auction to test demand.'}`,
    chatHistory: [{
      role: 'ai',
      text: `I checked eBay sold listings for this item. At an estimated sell price of $${estSellPrice.toFixed(2)}, you'd pocket $${net.toFixed(2)} after fees and shipping — that's a ${multiplier.toFixed(1)}× flip. ${net >= 20 ? "I'd grab it." : 'Margins are thin — only worth it if you can negotiate down.'} What else do you want to know?`,
    }],
  };
}

// TODO: replace with real webhook when n8n is ready
export async function sendChatMessage({ message, chatHistory, itemContext }) {
  await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
  const responses = [
    `Based on the sell velocity data, this category moves best in the first week. I'd price at the lower end and run a 7-day listing.`,
    `Good question. Vintage items like this tend to get more bids when listed Thursday evening — buyers are browsing before the weekend.`,
    `The ${Math.floor(Math.random() * 40) + 50}% sell-through rate means about half of similar listings actually sell. Photos and title keywords make the biggest difference.`,
    `If it doesn't sell at that price in 7 days, drop 10% and relist. Most items sell within 2 price adjustments.`,
    `Adding measurements to the description usually reduces returns and increases buyer confidence. Worth 2 minutes.`,
    `Free shipping can boost views by 30% in this category. Consider absorbing $5 and building it into your ask price.`,
  ];
  return { text: responses[Math.floor(Math.random() * responses.length)] };
}

// TODO: replace with real webhook when n8n is ready
export async function generateListing(item) {
  await new Promise(r => setTimeout(r, 1600));
  const name = item.name || 'Vintage Thrift Find';
  return {
    title: `${name.slice(0, 55)} - ${item.condition || 'Good'} Condition`,
    description: `${item.condition || 'Good'} condition — carefully inspected and accurately described. Ships fast in protective packaging.\n\nAll items come from a clean, smoke-free home. Photos show actual item. Feel free to ask any questions before purchasing!`,
    category: 'Clothing, Shoes & Accessories',
    condition: item.condition || 'Good',
    price: item.estSellPrice,
    specifics: {
      Brand: 'See description',
      Model: '',
      Size: 'See photos',
      Color: 'As pictured',
      Material: 'See label',
      MPN: 'Does Not Apply',
    },
  };
}

// TODO: replace with real webhook when n8n is ready
export async function regenerateField({ field, currentValue, context }) {
  await new Promise(r => setTimeout(r, 900));
  if (field === 'title') {
    const base = (context || '').slice(0, 45).trim();
    return { value: `${base || 'Vintage Find'} - Excellent Pre-Owned Condition` };
  }
  if (field === 'description-rewrite') {
    return { value: 'Excellent pre-owned item, exactly as described. Carefully packaged and ships within 1 business day. Photos show actual item — no filters. Questions welcome!' };
  }
  if (field === 'description-shorter') {
    const first = (currentValue || '').split('\n')[0];
    return { value: `${first}\n\nShips fast. Questions welcome!` };
  }
  if (field === 'description-longer') {
    return { value: `${currentValue || ''}\n\nThis item comes from a smoke-free, pet-free home. All measurements and condition details are accurately represented. Returns accepted within 30 days — buyer covers return shipping. Please review all photos before purchasing.` };
  }
  return { value: currentValue };
}

// TODO: replace with real webhook when n8n is ready
export async function sendToEbay(listingData) {
  await new Promise(r => setTimeout(r, 1400));
  return { success: true, draftId: `DRAFT-${Date.now()}`, message: 'Sent! Check eBay Seller Hub → Drafts' };
}

export { callWebhook };
