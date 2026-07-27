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
import { authorized, ebayApiHost } from '../_lib/relayAuth.js';

const TOKEN_PATH = '/identity/v1/oauth2/token';

// The scope an application token carries. Taxonomy is the only consumer at E2:
// category suggestions are not specific to a user, so eBay wants the app token
// rather than Dad's.
export const APP_SCOPE = 'https://api.ebay.com/oauth/api_scope';

export function tokenEndpoint(env) {
  return `${ebayApiHost(env)}${TOKEN_PATH}`;
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
  } else if (grant_type === 'client_credentials') {
    // The app-level token. Minted on demand and handed straight back — nothing
    // is cached here, because a stateless relay is the whole design (§3).
    body.set('grant_type', 'client_credentials');
    body.set('scope', scope || APP_SCOPE);
  } else {
    return null;
  }
  return body;
}

export function basicAuth(appId, certId) {
  return `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}`;
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
