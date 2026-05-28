const KEY = 'thrift-flip-drafts';

export function getDrafts() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}

export function saveDraft(draft) {
  const drafts = getDrafts();
  const existing = drafts.findIndex(d => d.id === draft.id);
  if (existing >= 0) {
    drafts[existing] = { ...draft, savedAt: Date.now() };
  } else {
    drafts.unshift({ ...draft, id: draft.id ?? Date.now(), savedAt: Date.now() });
  }
  localStorage.setItem(KEY, JSON.stringify(drafts));
}

export function deleteDraft(id) {
  localStorage.setItem(KEY, JSON.stringify(getDrafts().filter(d => d.id !== id)));
}

export function clearDrafts() {
  localStorage.removeItem(KEY);
}

export function getDraft(id) {
  return getDrafts().find(d => d.id === id) ?? null;
}
