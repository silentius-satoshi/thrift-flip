// The relays' shared bearer gate.
//
// Lives under api/_lib/ because Vercel excludes paths beginning with an
// underscore from function creation — this is a module, not an endpoint. Even
// if that convention ever changed it would expose a predicate and no secret.
//
// It is shared rather than copied for one reason: the comment below promises
// that NIP-98 replaces this WHOLESALE, and a promise like that is only keepable
// if there is exactly one body to replace.

/**
 * Call it what it is (plan §6.1): a speed bump against a stranger who finds the
 * URL, not authentication — the secret is baked into the client bundle and
 * anyone with the bundle can read it. Its blast radius is the eBay app
 * credentials in oauth.js, which are rotatable from the developer dashboard.
 *
 * The design of record is NIP-98 (nostr §9): a signed kind-27235 event with
 * signature, URL, method, payload-hash, a 60s window and a pubkey allowlist.
 * That track is deferred, so when it lands this function is replaced WHOLESALE
 * — a straight swap of this one body, never a second layer stacked on top.
 */
export function authorized(req) {
  const expected = process.env.RELAY_SECRET;
  if (!expected) return false; // never ship these endpoints ungated
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${expected}`;
}

export function ebayApiHost(env) {
  return env === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
}
