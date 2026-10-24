'use strict';
/**
 * verify-dh2-sso-ui.js — D-H part 2 on the screens.
 *   • Settings → Single sign-on: the Enterprise owner connects the provider (issuer, client id / secret, domains, require
 *     SSO) and is shown the redirect URL to register
 *   • the sign-in screen: "Sign in with single sign-on" sends a member to the company's provider
 *   • a member whose company requires SSO who tries a password is told to use SSO, and the SSO button is highlighted
 *   • a sign-in the provider refused comes back with the reason shown on the sign-in screen
 * A real OpenID provider on localhost (discovery only is needed here); the REAL SPA in jsdom; real server + Postgres.
 */
require('./clock.js');
const http = require('http');
const bcrypt = require('bcryptjs');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const wait = ms => new Promise(r => setTimeout(r, ms));

function startIdp() {
  let base = '';
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/.well-known/openid-configuration')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', jwks_uri: base + '/jwks' })); }
    res.writeHead(404); res.end();
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + srv.address().port; r({ srv, base }); }));
}
async function openPage(server, urlPath, cookies) {
  const page = await fetch(server.baseUrl + urlPath, { headers: cookies ? { Cookie: cookies } : {} }).then(r => r.text());
  const jar = new CookieJar();
  if (cookies) for (const kv of cookies.split('; ')) jar.setCookieSync(kv + '; Path=/', server.baseUrl);
  const dom = new JSDOM(page, { url: server.baseUrl + urlPath, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
  const w = dom.window, nodeFetch = global.fetch;
  w.fetch = (input, init = {}) => { const u = typeof input === 'string' ? input : String(input && input.url || input);
    const abs = u.startsWith('http') ? u : server.baseUrl + (u.startsWith('/') ? u : '/' + u);
    return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, cookies ? { Cookie: cookies } : {}) })); };
  for (let i = 0; i < 80 && typeof w.ffSsoSignIn !== 'function'; i++) await wait(100);
  return w;
}

(async () => {
  console.log('\n' + '='.repeat(78) + '\n  D-H part 2 — single sign-on on the screens\n' + '='.repeat(78) + '\n');
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  await initSchema(scratch.url);
  let server = null, idp = null;
  try {
    idp = await startIdp();
    server = await bootServer(scratch.url);
    const ins = async d => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [d])).rows[0].id;
    const owner = await ins({ email: 'owner@acme.test', name: 'Olu', plan: 'enterprise', role: 'owner', password: bcrypt.hashSync(PW, 10) });
    const ann = await ins({ email: 'ann@acme.test', name: 'Ann', plan: 'trial', role: 'owner', password: bcrypt.hashSync(PW, 10) });
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [owner, { name: 'Acme', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }]);
    await c.query(`INSERT INTO team_members (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [owner, { email: 'ann@acme.test', name: 'Ann', role: 'accountant', status: 'active', member_user_id: String(ann) }]);

    // 1 — the owner connects the provider in Settings
    const o = new HarnessHttp(server.baseUrl, { xff: '10.141.0.1' });
    await o.post('/api/auth/login', { email: 'owner@acme.test', password: PW });
    const ck = [...o.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const w = await openPage(server, '/app', ck);
    for (let i = 0; i < 60 && typeof w.ffRenderSso !== 'function'; i++) await wait(100);
    await wait(1500);
    try { w.showPage('settings'); } catch (_) {}
    try { await w.ffRenderSso(); } catch (_) {}
    const d = w.document, set = (id, v) => { const el = d.getElementById(id); if (el) el.value = v; };
    A('1  Settings shows the redirect URL to register in the provider', /\/api\/auth\/sso\/callback/.test((d.getElementById('sso-redirect') || {}).textContent || ''), ((d.getElementById('sso-panel') || {}).textContent || '').slice(0, 200));
    set('sso-issuer', idp.base); set('sso-client', 'finflow-app'); set('sso-secret', 's3cret-value'); set('sso-domains', 'acme.test');
    const enf = d.getElementById('sso-enforce'); if (enf) enf.checked = true;
    try { await w.ffSaveSso(); } catch (_) {}
    await wait(400);
    const cfg = (await o.get('/api/sso/config')).json || {};
    A('1b saving it turns SSO on for acme.test, required, from the page', cfg.enabled === true && (cfg.domains || []).join() === 'acme.test' && cfg.enforce === true && cfg.hasSecret === true, JSON.stringify(cfg));
    A('1c the page now says On for acme.test', /On/.test((d.getElementById('sso-panel') || {}).textContent || '') && /acme\.test/.test((d.getElementById('sso-panel') || {}).textContent || ''), ((d.getElementById('sso-panel') || {}).textContent || '').slice(0, 120));

    // 2 — the sign-in screen (signed out)
    const lw = await openPage(server, '/app', null);
    const ld = lw.document;
    let went = null; lw._ffGo = u => { went = u; };
    ld.getElementById('login-email').value = 'ann@acme.test';
    await lw.ffSsoSignIn(); await wait(200);
    A('2  "Sign in with single sign-on" sends Ann to the company\'s provider (authorize URL, client id, PKCE)', !!went && went.startsWith(idp.base + '/authorize') && /client_id=finflow-app/.test(went) && /code_challenge_method=S256/.test(went), String(went));
    ld.getElementById('login-pw').value = PW;
    await lw.doLogin(); await wait(200);
    A('3  Ann tries a password → told her company uses single sign-on; the SSO button is highlighted', /single sign-on/i.test(ld.getElementById('login-error').textContent) && /btn-primary/.test(ld.getElementById('sso-btn').className), ld.getElementById('login-error').textContent + ' | ' + ld.getElementById('sso-btn').className);
    const ew = await openPage(server, '/app?sso_error=' + encodeURIComponent('The ID token has expired.'), null);
    await wait(300);
    A('4  a refused single sign-on comes back with the reason on the sign-in screen', /did not complete/.test(ew.document.getElementById('login-error').textContent) && /expired/.test(ew.document.getElementById('login-error').textContent), ew.document.getElementById('login-error').textContent);
    for (const x of [w, lw, ew]) { try { x.close(); } catch (_) {} }
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (server && server.close) await server.close(); if (idp) idp.srv.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-H SSO UI)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
