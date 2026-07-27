import { useState, useEffect } from 'react';
import { registerUnlockUI, lockoutCopy, PIN_MIN_LENGTH } from '../utils/credentials';
import { prfRegister, prfAuthenticate, probeKeyVaultCapability, isCancellation } from '../lib/keyVault';
import { biometricLabel } from '../lib/biometricLabel';
import { vaultErr } from '../lib/vaultError';
import Sheet from './ui/Sheet';
import Button from './ui/Button';
import StatusTag from './ui/StatusTag';
import { Field, Input } from './ui/Field';
import './VaultGate.css';

// The vault's ceremonies, rendered once at the app root.
//
// The WebAuthn calls live HERE rather than in utils/credentials.js on purpose:
// they need transient activation, and iOS Safari drops it across the awaits
// between tapping "Get verdict" and the credential read. Running them in this
// sheet's own click handler means the gesture is always fresh. It costs one tap
// and buys a ceremony that actually fires.
export default function VaultGate() {
  const [request, setRequest] = useState(null); // { kind, ctx, resolve, reject }
  const [mode, setMode] = useState('choose');   // 'choose' | 'pin-setup'
  const [capability, setCapability] = useState('pin');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [waitMs, setWaitMs] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const label = biometricLabel();

  useEffect(() => {
    registerUnlockUI({
      requestEnroll: () => new Promise((resolve, reject) => {
        setMode('choose');
        setPin(''); setConfirm(''); setNote(null); setBusy(false);
        setWaitMs(0); setDeadline(0);
        probeKeyVaultCapability().then((cap) => {
          setCapability(cap);
          // Nothing to lead with on a device that has no platform
          // authenticator — go straight to the PIN rather than showing a
          // button that cannot work.
          if (cap !== 'prf') setMode('pin-setup');
        });
        setRequest({ kind: 'enroll', ctx: {}, resolve, reject });
      }),
      requestUnlock: (ctx) => new Promise((resolve, reject) => {
        setPin(''); setConfirm(''); setBusy(false);
        setNote(ctx.error ?? null);
        const left = ctx.lockedForMs ?? 0;
        setWaitMs(left);
        // Not during render, so reading the clock here is fine.
        setDeadline(left > 0 ? Date.now() + left : 0);
        setRequest({ kind: 'unlock', ctx, resolve, reject });
      }),
    });
  }, []);

  // Count a lockout down so the button re-enables on its own.
  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      setWaitMs(left);
      if (left === 0) setDeadline(0);
    }, 500);
    return () => clearInterval(id);
  }, [deadline]);

  function settle(fn, value) {
    if (!request) return;
    setRequest(null);
    setPin(''); setConfirm(''); setNote(null); setBusy(false);
    setWaitMs(0); setDeadline(0);
    request[fn](value);
  }

  const finish = (value) => settle('resolve', value);
  const cancel = () => settle('reject', vaultErr('ceremony-cancelled', 'Cancelled'));

  async function enrollWithBiometric() {
    setBusy(true);
    setNote(null);
    try {
      const credentialId = await prfRegister();
      // Registration returns no PRF output — only an assertion does (§5.2).
      // This second prompt is unavoidable and is why enrollment asks twice.
      const ikm = await prfAuthenticate(credentialId);
      finish({ scheme: 'prf', credentialId, ikm });
    } catch (e) {
      setBusy(false);
      if (isCancellation(e)) {
        setNote(`${label} was cancelled — try again, or set a PIN.`);
        return;
      }
      // Auto-fallback: a device that cannot do PRF must not leave the user
      // stranded on a button that will never work.
      setMode('pin-setup');
      setNote(`${label} isn’t available on this phone — set a PIN instead.`);
    }
  }

  async function unlockWithBiometric() {
    setBusy(true);
    setNote(null);
    try {
      const ikm = await prfAuthenticate(request?.ctx?.credentialId);
      finish({ ikm });
    } catch (e) {
      setBusy(false);
      if (isCancellation(e)) { cancel(); return; }
      setNote(`${label} didn’t work. Try again, or start over in Settings.`);
    }
  }

  if (!request) return null;

  const enrolling = request.kind === 'enroll';
  const pinScheme = enrolling ? mode === 'pin-setup' : request.ctx?.scheme === 'pin';
  const locked = waitMs > 0;
  const pinReady = enrolling
    ? pin.length >= PIN_MIN_LENGTH && pin === confirm
    : pin.length >= PIN_MIN_LENGTH && !locked;

  const title = enrolling
    ? 'Lock your AI key'
    : pinScheme ? 'Enter your PIN' : `Unlock with ${label}`;

  return (
    <Sheet open onClose={cancel} title={title} className="vault-sheet">
      {enrolling && mode === 'choose' && (
        <>
          <p className="vault-lead">
            Only your face opens it. Thrift Flip now locks your AI key on this
            phone — without you, it can’t be read at all.
          </p>
          <Button full disabled={busy} onClick={enrollWithBiometric}>
            {busy ? 'Waiting…' : `Use ${label}`}
          </Button>
          <button
            type="button"
            className="vault-alt"
            onClick={() => { setMode('pin-setup'); setNote(null); }}
          >
            Use a PIN instead
          </button>
        </>
      )}

      {enrolling && mode === 'pin-setup' && (
        <>
          <p className="vault-lead">
            Pick a PIN of at least {PIN_MIN_LENGTH} digits. There is no way to
            reset it — if you forget it you’ll paste a fresh key from Google.
          </p>
          <Field label="PIN">
            <Input
              type="password" inputMode="numeric" autoComplete="new-password"
              value={pin} onChange={e => setPin(e.target.value)}
            />
          </Field>
          <Field label="PIN again">
            <Input
              type="password" inputMode="numeric" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)}
            />
          </Field>
          <Button full disabled={!pinReady} onClick={() => finish({ scheme: 'pin', pin })}>
            Lock it
          </Button>
          {capability === 'prf' && (
            <button type="button" className="vault-alt" onClick={() => { setMode('choose'); setNote(null); }}>
              Use {label} instead
            </button>
          )}
        </>
      )}

      {!enrolling && !pinScheme && (
        <>
          <p className="vault-lead">Your AI key is locked on this phone. Unlock it to run the verdict.</p>
          <Button full disabled={busy} onClick={unlockWithBiometric}>
            {busy ? 'Waiting…' : `Unlock with ${label}`}
          </Button>
        </>
      )}

      {!enrolling && pinScheme && (
        <>
          <Field label="PIN">
            <Input
              type="password" inputMode="numeric" autoComplete="current-password"
              value={pin} onChange={e => setPin(e.target.value)} disabled={locked}
            />
          </Field>
          <Button full disabled={!pinReady} onClick={() => finish({ pin })}>
            {locked ? lockoutCopy(waitMs) : 'Unlock'}
          </Button>
        </>
      )}

      {note && <StatusTag tone="red" className="vault-note">{note}</StatusTag>}
      {locked && !note && <StatusTag tone="mute" className="vault-note">{lockoutCopy(waitMs)}</StatusTag>}

      <Button variant="outline" full onClick={cancel}>Not now</Button>
    </Sheet>
  );
}
