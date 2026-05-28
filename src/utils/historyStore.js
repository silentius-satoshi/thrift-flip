const KEY = 'thrift-flip-history';

export function getHistory() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}

export function addHistoryEntry(entry) {
  const history = getHistory();
  localStorage.setItem(KEY, JSON.stringify([{ ...entry, id: Date.now() }, ...history]));
}

export function deleteHistoryEntry(id) {
  localStorage.setItem(KEY, JSON.stringify(getHistory().filter(e => e.id !== id)));
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}
