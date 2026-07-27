import { historyService } from './storageService';

const KEY = 'thrift-flip-history';

export function getHistory() {
  // Direct read — sync required for useState lazy init
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}

export function addHistoryEntry(entry) {
  const history = getHistory();
  historyService.set([{ ...entry, id: Date.now() }, ...history]);
}

/**
 * Wholesale replace, for the inbound refresh (E3): it recomputes listingId,
 * liveAt, status and views across the whole list in one pass, and writing them
 * back one entry at a time would interleave with a concurrent delete.
 */
export function replaceHistory(entries) {
  historyService.set(entries);
}

export function deleteHistoryEntry(id) {
  historyService.set(getHistory().filter(e => e.id !== id));
}

export function clearHistory() {
  historyService.clear();
}
