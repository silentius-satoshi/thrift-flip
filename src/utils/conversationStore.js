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
    saveIndex([{ id, itemName, createdAt: id, status: null, lastMessage: chatHistory.at(-1)?.text ?? null }, ...index]);
  }
}

export function updateChatHistory(id, chatHistory) {
  try {
    const raw = localStorage.getItem(convKey(id));
    if (!raw) return;
    localStorage.setItem(convKey(id), JSON.stringify({ ...JSON.parse(raw), chatHistory }));
    const lastMsg = chatHistory.at(-1);
    if (lastMsg) saveIndex(getIndex().map(e => e.id === id ? { ...e, lastMessage: lastMsg.text } : e));
  } catch { /* ignore */ }
}

export function markStatus(id, status) {
  saveIndex(getIndex().map(e => e.id === id ? { ...e, status } : e));
}

export function getConversation(id) {
  try { return JSON.parse(localStorage.getItem(convKey(id))); } catch { return null; }
}

export function deleteConversation(id) {
  localStorage.removeItem(convKey(id));
  saveIndex(getIndex().filter(e => e.id !== id));
}

export function archiveConversation(id) {
  saveIndex(getIndex().map(e => e.id === id ? { ...e, archived: true } : e));
}

export function pinConversation(id, pinned) {
  saveIndex(getIndex().map(e => e.id === id ? { ...e, pinned } : e));
}

export function unarchiveConversation(id) {
  saveIndex(getIndex().map(e => e.id === id ? { ...e, archived: false } : e));
}
