import { setItem, removeItem } from './storageService';
import * as photoStore from './photoStore';

const INDEX_KEY = 'thrift-flip-conversation-index';
const convKey = id => `thrift-flip-conversation-${id}`;

export function getIndex() {
  // Direct read — sync required for useState lazy init
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) ?? []; } catch { return []; }
}

function saveIndex(index) {
  // Fire-and-forget — storageService.setItem has no internal awaits so localStorage
  // is written synchronously before control returns to the caller
  setItem(INDEX_KEY, index);
}

export function saveConversation(id, itemName, chatHistory, itemContext) {
  setItem(convKey(id), { itemId: id, itemName, chatHistory, itemContext, createdAt: id });
  const index = getIndex();
  if (!index.find(e => e.id === id)) {
    saveIndex([{ id, itemName, createdAt: id, status: null, lastMessage: chatHistory.at(-1)?.text ?? null }, ...index]);
  }
}

export function updateChatHistory(id, chatHistory) {
  try {
    // Direct read — sync required for immediate read-modify-write
    const raw = localStorage.getItem(convKey(id));
    if (!raw) return;
    setItem(convKey(id), { ...JSON.parse(raw), chatHistory });
    const lastMsg = chatHistory.at(-1);
    if (lastMsg) saveIndex(getIndex().map(e => e.id === id ? { ...e, lastMessage: lastMsg.text } : e));
  } catch { /* ignore */ }
}

/**
 * Update only what the item is, leaving what was said about it alone.
 *
 * `saveConversation` writes the whole record, `chatHistory` included — which is
 * right when an analysis creates a conversation and wrong when one *revises* it.
 * A re-check carries new notes and a new condition, and running it through
 * saveConversation would replace a real Flip thread with the fresh one-line
 * teaser. The mirror of `updateChatHistory`, in the other direction.
 */
export function updateItemContext(id, itemContext) {
  try {
    // Direct read — sync required for immediate read-modify-write
    const raw = localStorage.getItem(convKey(id));
    if (!raw) return;
    const record = JSON.parse(raw);
    setItem(convKey(id), { ...record, itemContext: { ...record.itemContext, ...itemContext } });
  } catch { /* ignore */ }
}

export function markStatus(id, status) {
  saveIndex(getIndex().map(e => e.id === id ? { ...e, status } : e));
}

export function getConversation(id) {
  // Direct read — sync required for useState lazy init
  try { return JSON.parse(localStorage.getItem(convKey(id))); } catch { return null; }
}

export function deleteConversation(id) {
  removeItem(convKey(id));
  saveIndex(getIndex().filter(e => e.id !== id));
  // The conversation owns the item's photos (V3): the chat is the only thing
  // that reads them, so it is the thing whose deletion should free them.
  photoStore.remove(id).catch(() => { /* nothing the user can act on */ });
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
