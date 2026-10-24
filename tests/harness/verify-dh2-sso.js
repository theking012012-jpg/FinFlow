'use strict';
/**
 * verify-dh2-sso.js — D-H part 2: Enterprise single sign-on (OpenID Connect). The pricing promised "SSO / SAML" and
 * nothing existed. Now an Enterprise owner connects the company's identity provider; members sign in through it; the
 * ID token is verified (signature against the provider's keys, issuer, audience, expiry, nonce; PKCE + state); with
 * "require SSO" on, members of that e-mail domain can no longer use a password (the owner keeps password access as the
 * way back in); new people can join as Viewers if the owner allows it.
 * A REAL OpenID provider runs on localhost (its own RSA key, discovery, JWKS, token endpoint that checks PKCE) — the
 * harness only tells it which person signed in, and in some steps to misbehave (wrong signature, nonce, audience,
 * expiry). Real FinFlow server + Postgres.
 */
require('./clock.js');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const b64u = x => Buffer.from(x).toString('base64url');

// ── a small but real OpenID Connect provider ──
function startIdp() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', use: 'sig', alg: 'RS256' });
  const codes = new Map();
  let base = '';
  const sign = (claims, opts) => {
    const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' })), p = b64u(JSON.stringify(claims));
    const sig = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), opts && opts.badSig ? otherKey : privateKey);
    return h + '.' + p + '.' + b64u(sig);
  };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (u.pathname === '/.well-known/openid-configuration') return send(200, { issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', jwks_uri: base + '/jwks' });
    if (u.pathname === '/jwks') return send(200, { keys: [jwk] });
    if (u.pathname === '/token' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        const f = new URLSearchParams(body), it = codes.get(f.get('code'));
        if (!it || f.get('client_id') !== 'finflow-app' || f.get('client_secret') !== 's3cret-value') return send(400, { error: 'invalid_client' });
        if (b64u(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest()) !== it.challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE' });
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: it.iss || base, aud: it.aud || 'finflow-app', sub: 'u-' + it.email, email: it.email, email_verified: true, name: it.name || it.email, nonce: it.nonce, iat: now, exp: it.exp || now + 600 };
        send(200, { access_token: 'at', token_type: 'Bearer', id_token: sign(claims, it) });
      }); return;
    }
    send(404, { error: 'not_found' });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + srv.address().port; r({ srv, get base() { return base; },
    issue: (o) => { const c = 'code-' + crypto.randomBytes(6).toString('hex'); codes.set(c, o); return c; } }); }));
}

(async () => {
  console.log('\n' + '='.repeat(78) + '\n  D-H part 2 — Enterprise single sign-on (OpenID Connect)\n' + '='.repeat(78) + '\n');
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  await initSchema(scratch.url);
  let server = null, idp = null;
  try {
    idp = await startIdp();
    server = await bootServer(scratch.url);
    const ins = async d => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [d])).rows[0].id;
    const owner = await ins({ email: 'owner@acme.test', name: 'Olu Owner', plan: 'enterprise', role: 'owner', password: bcrypt.hashSync(PW, 10) });
    const ann = await ins({ email: 'ann@acme.test', name: 'Ann', plan: 'trial', role: 'owner', password: bcrypt.hashSync(PW, 10) });
    await c.query(`INSERT INTO team_members (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [owner, { email: 'ann@acme.test', name: 'Ann', role: 'accountant', status: 'active', member_user_id: String(ann) }]);
    await ins({ email: 'pro@other.test', name: 'Pro', plan: 'pro', role: 'owner', password: bcrypt.hashSync(PW, 10) });
    const o = new HarnessHttp(server.baseUrl, { xff: '10.140.0.1' });
    await o.post('/api/auth/login', { email: 'owner@acme.test', password: PW });
    const p = new HarnessHttp(server.baseUrl, { xff: '10.140.0.2' });
    await p.post('/api/auth/login', { email: 'pro@other.test', password: PW });
    const cfg = { issuer: idp.base, client_id: 'finflow-app', client_secret: 's3cret-value', domains: ['acme.test'], enforce: true, jitViewer: false };

    const pr = await p.put('/api/sso/config', cfg);
    A('1  Pro cannot turn on SSO — it is an Enterprise feature (402)', pr.status === 402, pr.status + ' ' + String(pr.text).slice(0, 120));
    const put = await o.put('/api/sso/config', cfg);
    const got = (await o.get('/api/sso/config')).json || {};
    const raw = JSON.stringify((await c.query(`SELECT data FROM user_settings WHERE user_id = $1 AND data->>'key' = 'sso_config'`, [owner])).rows);
    A('2  the Enterprise owner connects the provider (checked against its discovery document); the secret is never shown back and is stored encrypted', put.status === 200 && got.enabled === true && got.hasSecret === true && got.client_secret === undefined && !raw.includes('s3cret-value') && raw.length > 10,
      put.status + ' ' + JSON.stringify(got) + ' rawHasSecret=' + raw.includes('s3cret-value'));

    const signIn = async (email, idpOpts) => {
      const h = new HarnessHttp(server.baseUrl, { xff: '10.140.1.' + Math.floor(Math.random() * 200) });
      const st = await h.post('/api/auth/sso/start', { email });
      if (st.status !== 200) return { h, start: st };
      const url = new URL(st.json.url);
      const code = idp.issue(Object.assign({ email, nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge') }, idpOpts || {}));
      const state = (idpOpts && idpOpts.badState) ? 'not-the-state' : url.searchParams.get('state');
      const cb = await h.get('/api/auth/sso/callback?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state));
      const me = await h.get('/api/auth/me');
      return { h, start: st, url, cb, me };
    };
    const s1 = await signIn('ann@acme.test');
    const u1 = s1.url || new URL('http://x');
    A('3  start: a redirect to the provider with PKCE (S256), state, nonce and the account\'s client id', s1.start.status === 200 && u1.searchParams.get('code_challenge_method') === 'S256' && !!u1.searchParams.get('state') && !!u1.searchParams.get('nonce') && u1.searchParams.get('client_id') === 'finflow-app', s1.start.status + ' ' + String(s1.start.text).slice(0, 160));
    A('4  Ann signs in through the provider → a FinFlow session as Ann, sent to the app', s1.cb && s1.cb.status === 302 && /\/app/.test(s1.cb.headers.get('location') || '') && s1.me.status === 200 && /ann@acme\.test/.test(s1.me.text), (s1.cb && s1.cb.status) + ' ' + (s1.cb && s1.cb.headers.get('location')) + ' me ' + s1.me.status);
    for (const [label, opts] of [['a forged signature', { badSig: true }], ['another nonce', { nonce: 'other-nonce' }], ['another application (audience)', { aud: 'some-other-app' }], ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }], ['another issuer', { iss: 'https://evil.example' }], ['a wrong state', { badState: true }]]) {
      const s = await signIn('ann@acme.test', opts);
      A('5  refused: ' + label + ' — no session, the reason shown', s.cb && s.cb.status === 302 && /sso_error=/.test(s.cb.headers.get('location') || '') && s.me.status === 401, (s.cb && s.cb.status) + ' ' + (s.cb && s.cb.headers.get('location')) + ' me ' + s.me.status);
    }
    const s6 = await signIn('bob@acme.test');
    A('6  someone at acme.test who is not a member is refused (joining is off)', s6.me && s6.me.status === 401 && /sso_error=/.test((s6.cb && s6.cb.headers.get('location')) || ''), s6.me && s6.me.status);
    await o.put('/api/sso/config', Object.assign({}, cfg, { client_secret: '', jitViewer: true }));   // blank secret = keep the stored one
    const s7 = await signIn('bob@acme.test');
    const bobRow = (await c.query(`SELECT data FROM team_members WHERE user_id = $1 AND lower(data->>'email') = 'bob@acme.test'`, [owner])).rows[0];
    A('7  with "new people join as Viewers" on: Bob signs in and joins the account as a Viewer (the stored secret kept)', s7.me && s7.me.status === 200 && bobRow && bobRow.data.role === 'viewer' && bobRow.data.status === 'active', (s7.me && s7.me.status) + ' ' + JSON.stringify(bobRow && bobRow.data));
    const pw = await new HarnessHttp(server.baseUrl, { xff: '10.140.2.1' }).post('/api/auth/login', { email: 'ann@acme.test', password: PW });
    A('8  with "require SSO" on, Ann can no longer sign in with a password (403 SSO_REQUIRED, pointing to SSO)', pw.status === 403 && (pw.json || {}).code === 'SSO_REQUIRED', pw.status + ' ' + String(pw.text).slice(0, 120));
    const opw = await new HarnessHttp(server.baseUrl, { xff: '10.140.2.2' }).post('/api/auth/login', { email: 'owner@acme.test', password: PW });
    A('8b the owner keeps password sign-in (the way back in if the provider fails)', opw.status === 200, 'status ' + opw.status);
    const none = await new HarnessHttp(server.baseUrl, { xff: '10.140.2.3' }).post('/api/auth/sso/start', { email: 'eve@nowhere.test' });
    A('9  an e-mail domain with no SSO is told to use a password', none.status === 404 && /password/i.test((none.json || {}).error || ''), none.status + ' ' + String(none.text).slice(0, 120));
    const aud = (await c.query(`SELECT count(*)::int AS n FROM audit_trail WHERE user_id = $1 AND table_name = 'sso' AND action IN ('UPDATE','CREATE')`, [owner])).rows[0].n;
    A('10 turning SSO on / changing it is audited', aud >= 2, 'rows ' + aud);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (server && server.close) await server.close(); if (idp) idp.srv.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-H SSO)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
