// eBay Marketplace Account Deletion endpoint (ebay-connect §4).
//
// eBay requires production keysets to receive account-deletion notifications or
// claim a no-data exemption. This relay stores nothing, so the exemption is
// arguably available — but the endpoint is thirty lines and removes all review
// friction, so it exists.
//
// DELIBERATELY EXEMPT FROM THE §3 BEARER GATE. eBay calls it unauthenticated,
// by design, under both the bearer-secret and the future NIP-98 scheme. Its own
// security is the token-hash challenge below. Do not "fix" this by adding auth.
import { createHash } from 'node:crypto';

/**
 * sha256hex(challenge_code + verification_token + endpoint_url) — IN THAT EXACT
 * ORDER. eBay recomputes the same hash and rejects the endpoint on a mismatch,
 * with no diagnostic saying the order was wrong. Pinned by a test.
 */
export function challengeResponse(challengeCode, verificationToken, endpointUrl) {
  return createHash('sha256')
    .update(challengeCode)
    .update(verificationToken)
    .update(endpointUrl)
    .digest('hex');
}

/**
 * The URL must byte-match the one registered in the eBay dashboard, so an
 * explicit value always wins. The derived fallback keeps the endpoint working
 * before the env var is set, but a custom domain or a preview deployment can
 * make the derived host disagree with what eBay has on file — which is exactly
 * the silent failure EBAY_DELETION_ENDPOINT_URL exists to prevent.
 */
export function endpointUrl(req) {
  if (process.env.EBAY_DELETION_ENDPOINT_URL) return process.env.EBAY_DELETION_ENDPOINT_URL;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  const path = (req.url ?? '').split('?')[0];
  return `${proto}://${host}${path}`;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const token = process.env.EBAY_VERIFICATION_TOKEN;
    if (!token) return res.status(500).json({ error: 'relay_not_configured' });

    const url = new URL(req.url, 'https://placeholder.invalid');
    const challengeCode = url.searchParams.get('challenge_code');
    if (!challengeCode) return res.status(400).json({ error: 'missing_challenge_code' });

    return res.status(200).json({
      challengeResponse: challengeResponse(challengeCode, token, endpointUrl(req)),
    });
  }

  if (req.method === 'POST') {
    // Acknowledge and stop. There is nothing to delete: this relay holds no
    // data at all, and the client holds no other user's data.
    return res.status(200).end();
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}
