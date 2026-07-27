// JSON backup — the whole backup story, since there is no server.
// A file nothing can read back is not a backup, so import ships with export.

const PREFIX = 'thrift-flip-';
export const BACKUP_VERSION = 1;

// Never leaves the device in a file. A naive dump would write the key in the
// clear into the Files app, which is worse than where it already is.
// TODO(E1): add the eBay refresh token key here when it lands
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
