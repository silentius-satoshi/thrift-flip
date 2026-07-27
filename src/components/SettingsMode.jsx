import { useState, useRef, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import { getAiKey, setAiKey, clearAiKey, verifyKey, describeAiKey } from '../utils/ai';
import { credentialStore } from '../utils/credentials';
import { biometricLabel } from '../lib/biometricLabel';
import { downloadBackup, parseBackup, restoreBackup } from '../utils/backup';
import Button from './ui/Button';
import Card from './ui/Card';
import Row from './ui/Row';
import Sheet from './ui/Sheet';
import StatusTag from './ui/StatusTag';
import { Field, Input } from './ui/Field';
import './SettingsMode.css';

const KEY_PAGE = 'https://aistudio.google.com/apikey';

// "API key" never appears in the UI — it is "your AI key" everywhere.
const VERIFY_COPY = {
  'bad-key': "That key didn't work — check the paste caught the whole thing",
  quota: 'Key works but Google says it’s out of free calls today',
  offline: "No signal — I'll verify when you're back online",
  'bad-response': 'Odd reply from Google — try again',
  'no-key': 'Paste the key first',
};

// Vault failures are separate from Google failures — telling someone their key
// is bad when the real problem was a cancelled Face ID sheet sends them to
// re-paste a key that was fine.
const VAULT_COPY = {
  locked: 'Cancelled — the key stays locked on this phone',
  'vault-unavailable': "This browser won't let Thrift Flip store your key safely — try a normal tab, not Private Browsing",
  'crypto-unavailable': 'Thrift Flip needs a secure (https) connection to lock your key',
  'vault-rate-limited': 'Too many tries — wait a moment and try again',
  default: "Couldn't unlock the key on this phone",
};

// No lazy-init read of the key any more: since N1-lite it is ciphertext in
// IndexedDB, so presence arrives asynchronously. `present` therefore starts
// `undefined` — "not known yet", distinct from `false` for "no key stored" —
// and the row renders a neutral title until it resolves rather than flashing
// the wrong state for a frame.

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5l7.5 3v6c0 4.5-3.1 8.6-7.5 10-4.4-1.4-7.5-5.5-7.5-10v-6z" />
      <path d="M8.6 12.1l2.3 2.3 4.5-4.5" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3L21 2m-4 4l3 3m-6-6l3 3" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}

export default function SettingsMode({ onBack }) {
  const { showToast } = useToast();
  const [view, setView] = useState(() => {
    // Direct read — sync required for useState lazy init
    return localStorage.getItem('thrift-flip-settings-view') === 'ai-key' ? 'ai-key' : 'main';
  });
  // undefined = not read yet, distinct from false/null for "no key stored"
  const [present, setPresent] = useState(undefined);
  const [last4, setLast4] = useState(null);
  const [scheme, setScheme] = useState(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, text }
  const [replacing, setReplacing] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const importRef = useRef(null);
  const label = biometricLabel();

  useEffect(() => {
    localStorage.setItem('thrift-flip-settings-view', view);
  }, [view]);

  // Metadata only — never unwraps, so opening Settings costs no ceremony.
  useEffect(() => {
    let live = true;
    describeAiKey()
      .then(d => { if (live) { setPresent(d.present); setLast4(d.last4); setScheme(d.scheme); } })
      .catch(() => { if (live) setPresent(false); });
    return () => { live = false; };
  }, [view]);

  async function handleVerifyAndSave() {
    const key = paste.trim();
    if (!key) { setStatus({ ok: false, text: VERIFY_COPY['no-key'] }); return; }
    setBusy(true);
    setStatus(null);
    const result = await verifyKey(key);
    setBusy(false);
    if (!result.ok) {
      setStatus({ ok: false, text: VERIFY_COPY[result.code] ?? VERIFY_COPY['bad-response'] });
      return;
    }
    // The first save on a fresh phone runs enrollment, which can be declined.
    try {
      await setAiKey(key);
    } catch (e) {
      setStatus({ ok: false, text: VAULT_COPY[e?.code] ?? VAULT_COPY.default });
      return;
    }
    const described = await describeAiKey();
    setPresent(described.present);
    setLast4(described.last4);
    setScheme(described.scheme);
    setPaste('');
    setReplacing(false);
    setStatus({ ok: true, text: 'Connected — verdicts are live' });
  }

  async function handleTestKey() {
    setBusy(true);
    setStatus(null);
    let key;
    try {
      key = await getAiKey();
    } catch (e) {
      setBusy(false);
      setStatus({ ok: false, text: VAULT_COPY[e?.code] ?? VAULT_COPY.default });
      return;
    }
    const result = await verifyKey(key);
    setBusy(false);
    setStatus(result.ok
      ? { ok: true, text: 'Still working — verdicts are live' }
      : { ok: false, text: VERIFY_COPY[result.code] ?? VERIFY_COPY['bad-response'] });
  }

  async function handleRemoveKey() {
    // Clears the credential, not the enrollment: the unlock method protects the
    // phone, so adding a key back costs no second ceremony.
    await clearAiKey();
    setPresent(false);
    setLast4(null);
    setPaste('');
    setReplacing(false);
    setStatus(null);
    showToast('Key removed from this phone');
  }

  // The only way out of a forgotten PIN or a deleted passkey. There is no
  // recovery by design — a second, weaker wrap would become the effective
  // security floor — and a Gemini key costs nothing to replace.
  async function handleReset() {
    await credentialStore.reset();
    setResetOpen(false);
    setPresent(false);
    setLast4(null);
    setScheme(null);
    setPaste('');
    setReplacing(false);
    setStatus(null);
    showToast('Starting over — paste a new key');
  }

  function handleExport() {
    downloadBackup();
    showToast('Backup downloaded');
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const result = parseBackup(await file.text());
    if (!result.ok) { showToast(result.reason, 'error'); return; }
    const when = result.exportedAt ? new Date(result.exportedAt).toLocaleString() : 'an unknown date';
    const ok = window.confirm(
      `Restore this backup from ${when}?\n\nIt has ${result.keys.length} saved items and replaces everything on this phone. Your AI key is not touched.`
    );
    if (!ok) return;
    restoreBackup(result.data);
    window.location.reload();
  }

  if (view === 'ai-key') {
    // `undefined` is "still reading the vault" — showing the paste form during
    // that beat would flash "add a key" at someone who already has one.
    const loading = present === undefined;
    const showPaste = !loading && (!present || replacing);
    return (
      <div className="screen settings">
        <div className="settings-header">
          <button className="settings-back" onClick={() => { setView('main'); setStatus(null); }} aria-label="Back to settings">←</button>
          <span className="settings-title">Verdicts</span>
          <span className="settings-header-spacer" />
        </div>

        {present && !replacing && (
          <Card className="settings-keycard">
            <div className="settings-keyline">
              <b className="money">Gemini · ••••{last4}</b>
              <StatusTag tone="green">CONNECTED</StatusTag>
            </div>
            <p>Verdicts run on your key, straight from this phone, no middleman.</p>
          </Card>
        )}

        {showPaste && (
          <>
            <p className="settings-lead">Sign in with your normal Gmail, tap Create API key, tap Copy, then come back here.</p>
            <Button variant="outline" full onClick={() => window.open(KEY_PAGE, '_blank', 'noopener')}>
              Open Google's key page
            </Button>
            <Field label="Your AI key">
              <div className="settings-paste">
                <Input
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  placeholder="Paste it here"
                  value={paste}
                  onChange={e => setPaste(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try { setPaste((await navigator.clipboard.readText()).trim()); }
                    catch { showToast('Paste it with a long-press instead', 'error'); }
                  }}
                >
                  Paste
                </Button>
              </div>
            </Field>
            <Button full disabled={busy} onClick={handleVerifyAndSave}>
              {busy ? 'Checking…' : 'Connect'}
            </Button>
          </>
        )}

        {status && (
          <StatusTag tone={status.ok ? 'green' : 'red'} className="settings-status">{status.text}</StatusTag>
        )}

        {present && !replacing && (
          <div className="settings-keyactions">
            <Button variant="outline" disabled={busy} onClick={handleTestKey}>{busy ? 'Testing…' : 'Test key'}</Button>
            <Button variant="outline" onClick={() => { setReplacing(true); setStatus(null); }}>Replace key</Button>
            <Button variant="danger" onClick={handleRemoveKey}>Remove key</Button>
          </div>
        )}
        {replacing && present && (
          <Button variant="outline" full onClick={() => { setReplacing(false); setPaste(''); setStatus(null); }}>Cancel</Button>
        )}

        {/* The interim plaintext risk note lived here and said it would be
            deleted when the key moved into a vault. N1-lite is that commit. */}
        {present && (
          <Card className="settings-protection">
            <Row
              thumb={<span className="settings-ic"><ShieldIcon /></span>}
              title={`Protected by ${scheme === 'pin' ? 'a PIN' : label}`}
              sub={scheme === 'pin'
                ? 'Encrypted on this phone. Your PIN is what opens it.'
                : `Encrypted on this phone. Without ${label} it can’t be read at all.`}
            />
          </Card>
        )}

        <div className="settings-note">
          <div className="lbl">Revoke help</div>
          <p>Revoke this key in seconds at the link below if you ever need to.</p>
          <button className="settings-link" onClick={() => window.open(KEY_PAGE, '_blank', 'noopener')}>
            aistudio.google.com/apikey
          </button>
          {present && (
            <button className="settings-link" onClick={() => setResetOpen(true)}>
              Can’t unlock?
            </button>
          )}
        </div>

        <Sheet open={resetOpen} onClose={() => setResetOpen(false)} title="Can’t unlock?">
          <p className="settings-lead">
            Your AI key is locked on this phone and can’t be opened without{' '}
            {scheme === 'pin' ? 'your PIN' : label}. There is no way around that — that is the point of the lock.
          </p>
          <p className="settings-lead">
            You can start over. This removes the saved key from this phone; paste
            a new one from Google and you’re back in a few seconds. It costs
            nothing.
          </p>
          <Button variant="danger" full onClick={handleReset}>Start over</Button>
          <Button variant="outline" full onClick={() => setResetOpen(false)}>Cancel</Button>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="screen settings">
      <div className="settings-header">
        <button className="settings-back" onClick={onBack} aria-label="Back">←</button>
        <span className="settings-title">Settings</span>
        <span className="settings-header-spacer" />
      </div>

      <div className="lbl settings-section">Your keys</div>
      <Card>
        <Row
          thumb={<span className="settings-ic"><KeyIcon /></span>}
          title={present === undefined ? 'Your AI key'
            : present ? `Gemini · ••••${last4 ?? ''}` : 'Add your AI key'}
          sub={present ? 'runs on your key' : 'Verdicts run on your key, no middleman'}
          trailing={present === undefined ? null
            : present ? <StatusTag tone="green">ON</StatusTag> : <StatusTag tone="blue">SET UP</StatusTag>}
          onPress={() => { setStatus(null); setView('ai-key'); }}
        />
      </Card>

      <div className="lbl settings-section">Backup</div>
      <Card>
        <Row
          thumb={<span className="settings-ic"><DownloadIcon /></span>}
          title="Download everything"
          sub="This file is your only backup. Thrift Flip has no server."
          onPress={handleExport}
        />
        <Row
          thumb={<span className="settings-ic"><UploadIcon /></span>}
          title="Import backup"
          sub="Replaces everything on this phone"
          onPress={() => importRef.current?.click()}
        />
      </Card>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
    </div>
  );
}
