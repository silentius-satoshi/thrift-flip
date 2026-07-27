import { useState, useRef, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import { getAiKey, setAiKey, clearAiKey, verifyKey } from '../utils/ai';
import { downloadBackup, parseBackup, restoreBackup } from '../utils/backup';
import Button from './ui/Button';
import Card from './ui/Card';
import Row from './ui/Row';
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

function loadKeyLast4() {
  // Direct read — sync required for useState lazy init; only the last 4 are kept
  try {
    const raw = JSON.parse(localStorage.getItem('thrift-flip-ai-key'));
    return raw ? String(raw).slice(-4) : null;
  } catch { return null; }
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
  const [last4, setLast4] = useState(loadKeyLast4);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, text }
  const [replacing, setReplacing] = useState(false);
  const importRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('thrift-flip-settings-view', view);
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
    await setAiKey(key);
    setLast4(key.slice(-4));
    setPaste('');
    setReplacing(false);
    setStatus({ ok: true, text: 'Connected — verdicts are live' });
  }

  async function handleTestKey() {
    setBusy(true);
    setStatus(null);
    const key = await getAiKey();
    const result = await verifyKey(key);
    setBusy(false);
    setStatus(result.ok
      ? { ok: true, text: 'Still working — verdicts are live' }
      : { ok: false, text: VERIFY_COPY[result.code] ?? VERIFY_COPY['bad-response'] });
  }

  async function handleRemoveKey() {
    await clearAiKey();
    setLast4(null);
    setPaste('');
    setReplacing(false);
    setStatus(null);
    showToast('Key removed from this phone');
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
    const showPaste = !last4 || replacing;
    return (
      <div className="screen settings">
        <div className="settings-header">
          <button className="settings-back" onClick={() => { setView('main'); setStatus(null); }} aria-label="Back to settings">←</button>
          <span className="settings-title">Verdicts</span>
          <span className="settings-header-spacer" />
        </div>

        {last4 && !replacing && (
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

        {last4 && !replacing && (
          <div className="settings-keyactions">
            <Button variant="outline" disabled={busy} onClick={handleTestKey}>{busy ? 'Testing…' : 'Test key'}</Button>
            <Button variant="outline" onClick={() => { setReplacing(true); setStatus(null); }}>Replace key</Button>
            <Button variant="danger" onClick={handleRemoveKey}>Remove key</Button>
          </div>
        )}
        {replacing && last4 && (
          <Button variant="outline" full onClick={() => { setReplacing(false); setPaste(''); setStatus(null); }}>Cancel</Button>
        )}

        <div className="settings-note">
          <div className="lbl">Revoke help</div>
          {/* Interim note — deleted in the same commit that moves the key into a vault (N1) */}
          <p>Stored on this phone. Anyone who can unlock your phone can read it — revoke it in seconds at the link below if that ever happens.</p>
          <button className="settings-link" onClick={() => window.open(KEY_PAGE, '_blank', 'noopener')}>
            aistudio.google.com/apikey
          </button>
        </div>
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
          title={last4 ? `Gemini · ••••${last4}` : 'Add your AI key'}
          sub={last4 ? 'runs on your key' : 'Verdicts run on your key, no middleman'}
          trailing={last4 ? <StatusTag tone="green">ON</StatusTag> : <StatusTag tone="blue">SET UP</StatusTag>}
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
