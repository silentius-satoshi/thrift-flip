const INDEX_KEY = 'thrift-flip-conversation-index';
const convKey = id => `thrift-flip-conversation-${id}`;

export function getIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) ?? []; } catch { return []; }
}

function saveIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function saveConversation(id, itemName, chatHistory, itemContext) {
  localStorage.setItem(convKey(id), JSON.stringify({ itemId: id, itemName, chatHistory, itemContext, createdAt: id }));
  const index = getIndex();
  if (!index.find(e => e.id === id)) {
    saveIndex([{ id, itemName, createdAt: id, status: null }, ...index]);
  }
}

export function updateChatHistory(id, chatHistory) {
  try {
    const raw = localStorage.getItem(convKey(id));
    if (!raw) return;
    localStorage.setItem(convKey(id), JSON.stringify({ ...JSON.parse(raw), chatHistory }));
  } catch { /* ignore */ }
}

export function markStatus(id, status) {
  saveIndex(getIndex().map(e => e.id === id ? { ...e, status } : e));
}

export function getConversation(id) {
  try { return JSON.parse(localStorage.getItem(convKey(id))); } catch { return null; }
}
