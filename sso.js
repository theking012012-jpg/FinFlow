'use strict';
// ── Single sign-on — OpenID Connect (A0 / D-H, owner decision 2026-10-23) ─────────────────────────────────────────────
// For Enterprise accounts: sign in through the company's identity provider (Google Workspace, Microsoft Entra ID, Okta,
// Auth0 — any OpenID Connect provider). Authorization-code flow with PKCE, state and nonce; the ID token's RS256 / ES256
// signature is verified against the provider's published keys (JWKS) with Node's own crypto — no third-party library —
// and its issuer, audience, expiry and nonce are checked. Network calls are passed in (fetchImpl) so the harness can run
// a real provider on localhost.
const crypto = require('crypto');
const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s), 'base64url');

// https only — except a provider on this machine outside production (development and the harness).
function issuerAllowed(issuer, env) {
  let u; try { u = new URL(issuer); } catch (_) { return false; }
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && (env || process.env).NODE_ENV !== 'production';
}

async function discover(issuer, fetchImpl) {
  const base = String(issuer).replace(/\/+$/, '');
  const r = await (fetchImpl || fetch)(base + '/.well-known/openid-configuration');
  if (!r.ok) throw new Error('The identity provider did not answer at ' + base + '/.well-known/openid-configuration (' + r.status + ').');
  const d = await r.json();
  if (String(d.issuer || '').replace(/\/+$/, '') !== base) throw new Error('The identity provider says its issuer is "' + d.issuer + '", not "' + base + '".');
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!d[k]) throw new Error('The identity provider\'s configuration has no ' + k + '.');
  return d;
}

function newPkce() {
  const verifier = b64u(crypto.randomBytes(32));
  return { verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), method: 'S256' };
}
const randomToken = () => b64u(crypto.randomBytes(24));

function authorizeUrl(disc, cfg, { state, nonce, challenge, redirectUri, loginHint }) {
  const u = new URL(disc.authorization_endpoint);
  const q = { response_type: 'code', client_id: cfg.client_id, redirect_uri: redirectUri, scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' };
  if (loginHint) q.login_hint = loginHint;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.toString();
}

async function exchangeCode(disc, cfg, clientSecret, { code, verifier, redirectUri }, fetchImpl) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cfg.client_id, client_secret: clientSecret, code_verifier: verifier });
  const r = await (fetchImpl || fetch)(disc.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error('The identity provider refused the sign-in (' + (j.error_description || j.error || r.status) + ').');
  return j;
}

// Verify an ID token. Returns its claims, or throws with a reason (never a half-checked token).
async function verifyIdToken(idToken, disc, { audience, nonce, nowSec }, fetchImpl) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token.');
  let header, claims;
  try { header = JSON.parse(fromB64u(parts[0]).toString('utf8')); claims = JSON.parse(fromB64u(parts[1]).toString('utf8')); } catch (_) { throw new Error('Malformed ID token.'); }
  const alg = header.alg;
  if (!['RS256', 'ES256'].includes(alg)) throw new Error('Unsupported ID token signature (' + alg + ').');
  const jr = await (fetchImpl || fetch)(disc.jwks_uri);
  if (!jr.ok) throw new Error('Could not read the identity provider\'s signing keys.');
  const keys = ((await jr.json()) || {}).keys || [];
  const jwk = keys.find(k => (!header.kid || k.kid === header.kid) && (k.use == null || k.use === 'sig'));
  if (!jwk) throw new Error('The ID token was signed with an unknown key.');
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(parts[0] + '.' + parts[1]);
  const sig = fromB64u(parts[2]);
  const ok = alg === 'RS256' ? crypto.verify('RSA-SHA256', data, pub, sig) : crypto.verify('SHA256', data, { key: pub, dsaEncoding: 'ieee-p1363' }, sig);
  if (!ok) throw new Error('The ID token signature is not valid.');
  const now = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
  if (String(claims.iss || '').replace(/\/+$/, '') !== String(disc.issuer).replace(/\/+$/, '')) throw new Error('The ID token is from another issuer.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new Error('The ID token is for another application.');
  if (!(Number(claims.exp) > now - 60)) throw new Error('The ID token has expired.');
  if (claims.nbf && Number(claims.nbf) > now + 60) throw new Error('The ID token is not valid yet.');
  if (!nonce || claims.nonce !== nonce) throw new Error('The ID token does not match this sign-in (nonce).');
  if (!claims.email) throw new Error('The identity provider did not share an e-mail address.');
  if (claims.email_verified === false) throw new Error('The identity provider says this e-mail address is not verified.');
  return claims;
}

const domainOf = email => String(email || '').toLowerCase().split('@')[1] || '';

module.exports = { issuerAllowed, discover, newPkce, randomToken, authorizeUrl, exchangeCode, verifyIdToken, domainOf };
