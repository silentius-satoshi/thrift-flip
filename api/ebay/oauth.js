// eBay token exchange relay (ebay-connect §3, §5 — step E1).
//
// This is the repo's first server code, and it exists for exactly two reasons
// neither of which the client can work around: eBay's REST APIs serve no CORS
// headers, and eBay's token exchange requires the client secret in a Basic
// header with no PKCE-only public-client option.
//
// Stateless by construction: no database, no KV, and NOT ONE console statement
// that receives a body, a token, or a secret. The relay sees tokens in flight
// and stores nothing. That is the honest form of the principle — *no server
// holds user data* — rather than "no server exists", which eBay's CORS policy
// makes impossible for a web app.
const TOKEN_PATH = '/identity/v1/oauth2/token';

export function tokenEndpoint(env) {
  return env === 'production'
    ? `https://api.ebay.com${TOKEN_PATH}`
    : `https://api.sandbox.ebay.com${TOKEN_PATH}`;
}

/**
 * The two grants E1 needs. Kept pure so a test can pin the body shape without
 * a network or a Vercel runtime.
 *
 * Note what `refresh_token` deliberately omits: eBay's refresh grant returns
 * only access_token / expires_in / token_type — no new refresh_token — so the
 * caller must carry the stored one forward rather than overwrite from the
 * response. Getting that wrong destroys the connection on the first refresh.
 */
export function grantBody({ grant_type, code, refresh_token, redirect_uri, scope }) {
  const body = new URLSearchParams();
  if (grant_type === 'authorization_code') {
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    // eBay takes the RuName here, not a URL, and it must match the authorize call.
    body.set('redirect_uri', redirect_uri);
  } else if (grant_type === 'refresh_token') {
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refresh_token);
    if (scope) body.set('scope', scope);
  } else {
    return null;
  }
  return body;
}

export function basicAuth(appId, certId) {
  return `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}`;
}

/**
 * The bearer gate.
 *
 * Call it what it is (plan §6.1): a speed bump against a stranger who finds the
 * URL, not authentication — the secret is baked into the client bundle and
 * anyone with the bundle can read it. Its blast radius is the eBay app
 * credentials held here, which are rotatable from the developer dashboard.
 *
 * The design of record is NIP-98 (nostr §9): a signed kind-27235 event with
 * signature, URL, method, payload-hash, a 60s window and a pubkey allowlist.
 * That track is deferred, so when it lands this function is replaced WHOLESALE
 * — a straight swap of this one body, never a second layer stacked on top.
 */
function authorized(req) {
  const expected = process.env.RELAY_SECRET;
  if (!expected) return false; // never ship these endpoints ungated
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId) return res.status(500).json({ error: 'relay_not_configured' });

  // Vercel parses JSON bodies; tolerate a raw string for `vercel dev` + curl.
  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const body = grantBody(payload);
  if (!body) return res.status(400).json({ error: 'unsupported_grant_type' });

  let upstream;
  try {
    upstream = await fetch(tokenEndpoint(process.env.EBAY_ENV), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuth(appId, certId),
      },
      body,
    });
  } catch {
    // No cause, no message — an upstream error string can echo request content.
    return res.status(502).json({ error: 'upstream_unreachable' });
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    // Pass eBay's own error code through at eBay's status, never enriched with
    // anything from this environment.
    let code = 'ebay_error';
    try { code = JSON.parse(text).error ?? code; } catch { /* keep the generic code */ }
    return res.status(upstream.status).json({ error: code });
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).send(text); // eBay's JSON, verbatim
}
