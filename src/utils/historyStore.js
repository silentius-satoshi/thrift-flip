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

export function deleteHistoryEntry(id) {
  historyService.set(getHistory().filter(e => e.id !== id));
}

export function clearHistory() {
  historyService.clear();
}
