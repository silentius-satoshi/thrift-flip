const KEY = 'thrift-flip-drafts';

export function getDrafts() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!Array.isArray(raw)) return [];
    // Healed on read as well as on write: the drafts already sitting on the
    // phone from before this fix are precisely the ones that were crashing the
    // screen, and a write-side fix alone would never reach them.
    return raw.map(d => (typeof d?.price === 'number' ? d : { ...d, price: Number(d?.price) || 0 }));
  } catch { return []; }
}

export function saveDraft(draft) {
  // Two of the three callers spread the editor's persisted edits straight in,
  // and there `price` is a controlled input's value — a string. DraftsMode
  // renders it with toFixed, so an auto-saved draft used to take the whole
  // screen down. Normalised here, at the one boundary every caller crosses,
  // rather than defensively at each render.
  const shaped = { ...draft, price: Number(draft.price) || 0 };
  const drafts = getDrafts();
  const existing = drafts.findIndex(d => d.id === draft.id);
  if (existing >= 0) {
    drafts[existing] = { ...shaped, savedAt: Date.now() };
  } else {
    drafts.unshift({ ...shaped, id: draft.id ?? Date.now(), savedAt: Date.now() });
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
