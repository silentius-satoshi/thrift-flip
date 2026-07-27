// nostr spec §5.8 — platform-honest copy everywhere. Calling it "Face ID" on a
// laptop is a small lie that makes the security claim harder to trust, and the
// copy must never overclaim what is actually protected: at N1-lite the vault
// holds credentials, not the cart, drafts or history.
export function biometricLabel() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'Face ID' : 'passkey';
}
