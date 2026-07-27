// JSON backup — the whole backup story, since there is no server.
// A file nothing can read back is not a backup, so import ships with export.

const PREFIX = 'thrift-flip-';
export const BACKUP_VERSION = 1;

// Defense in depth. Since N1-lite the AI key lives as ciphertext in IndexedDB,
// which this file never scans — so the export excludes it by construction and
// there is no deny-list to forget to update. This entry stays anyway: a backup
// written before the vault, or hand-edited afterwards, can still carry the
// plaintext field, and restoring it would resurrect exactly what N1-lite
// deleted.
const CREDENTIAL_KEYS = ['thrift-flip-ai-key'];

function appKeys() {
  // Prefix scan rather than a fixed list: conversations are one key per item
  // (thrift-flip-conversation-<id>) and would be missed by an enumeration.
  return Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX) && !CREDENTIAL_KEYS.includes(k));
}

export function buildBackup(now = Date.now()) {
  const data = {};
  for (const key of appKeys()) {
    const raw = localStorage.getItem(key);
    if (raw !== null) data[key] = raw;
  }
  return { version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), data };
}

export function downloadBackup() {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'thrift-flip-backup.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That file isn't a Thrift Flip backup" };
  }
  if (!parsed || typeof parsed.data !== 'object' || parsed.data === null) {
    return { ok: false, reason: "That file isn't a Thrift Flip backup" };
  }
  if (parsed.version !== BACKUP_VERSION) {
    return { ok: false, reason: `That backup is version ${parsed.version ?? '?'}; this app reads version ${BACKUP_VERSION}` };
  }
  const keys = Object.keys(parsed.data).filter(k => k.startsWith(PREFIX) && !CREDENTIAL_KEYS.includes(k));
  return { ok: true, keys, data: parsed.data, exportedAt: parsed.exportedAt };
}

// Replaces app data wholesale — the caller confirms first. Credential keys are
// skipped even if a hand-edited file contains them.
export function restoreBackup(data) {
  for (const key of appKeys()) localStorage.removeItem(key);
  let restored = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(PREFIX) || CREDENTIAL_KEYS.includes(key)) continue;
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    restored++;
  }
  return restored;
}
