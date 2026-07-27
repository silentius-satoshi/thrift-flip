// One error type for the whole vault, carrying a `code` and nothing else that
// could leak. Never interpolate a PIN, a key, or a decoded byte into `message`
// — nostr spec §5.6: error messages are an exfiltration path.
export class VaultError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'VaultError';
    this.code = code;
  }
}

export const vaultErr = (code, message) => new VaultError(code, message);
