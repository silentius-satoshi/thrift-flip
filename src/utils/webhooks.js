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

// Real as of V1 — a direct client call to Gemini on the user's own key.
// Two mocks remain below, both V3's: sendChatMessage and regenerateField.
export { analyzeItem } from './ai';

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

// Real as of E2 — inventory item + unpublished offer = a draft in Seller Hub.
export { sendToEbay } from './ebaySell';

export { callWebhook };
