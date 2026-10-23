'use strict';
/**
 * verify-conduct-policy.js — A0 / D-E (owner decision 2026-10-23). Accountants were asked at sign-up to agree to a
 * "Professional Conduct Policy" that did not exist (the link pointed at /terms.html#6 — Terms has no such anchor and no
 * such policy). Now:
 *   • the policy exists at /conduct.html, version 1.0, with the off-platform (non-circumvention) penalties stated;
 *     its version equals the ONE version source (conduct-policy.js) the server and pages use
 *   • sign-up has an explicit, required "I accept" checkbox linking to it; the server refuses a registration without
 *     acceptance of the CURRENT version, and records version + time (history kept in conduct_acceptances)
 *   • an existing accountant (registered before the policy) is asked at sign-in; for 14 days nothing changes, after
 *     that access to CLIENT BOOKS pauses (403 CONDUCT_ACCEPTANCE_REQUIRED) — messages keep working — until they accept
 * Real Postgres + real server. Clock: the server's NOW() is real time, so the 14-day boundary is driven by the stored
 * prompted time (Rule 10: an instant, compared as an instant).
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  console.log('\n' + '='.repeat(78) + '\n  D-E — the Professional Conduct Policy exists, is accepted, and is enforced\n' + '='.repeat(78) + '\n');
  let Conduct = null;
  try { Conduct = require(path.join(ROOT, 'conduct-policy.js')); } catch (_) {}
  A('0  one version source exists (conduct-policy.js)', !!(Conduct && Conduct.VERSION), 'conduct-policy.js missing');
  const V = Conduct ? Conduct.VERSION : '?';

  // the document
  const pol = fs.existsSync(path.join(ROOT, 'public', 'conduct.html')) ? new JSDOM(fs.readFileSync(path.join(ROOT, 'public', 'conduct.html'), 'utf8')).window.document : null;
  const polText = pol ? pol.body.textContent.replace(/\s+/g, ' ') : '';
  A('1  /conduct.html exists and its version equals conduct-policy.js', !!pol && (pol.querySelector('meta[name="conduct-version"]') || {}).content === V, pol ? 'meta=' + (pol.querySelector('meta[name="conduct-version"]') || {}).content : 'no page');
  A('1b it states the off-platform rule and penalties (24 months, conversion fee, warning → suspension → removal)', /24 months/.test(polText) && /conversion fee/i.test(polText) && /Suspension/.test(polText) && /Permanent removal/.test(polText), polText.slice(0, 120));
  A('1c it has a plain-language summary for clients', !!(pol && pol.getElementById('for-clients')), 'no #for-clients');

  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  await initSchema(scratch.url);
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const anon = new HarnessHttp(server.baseUrl, { xff: '203.0.113.71' });

    // the sign-up page
    const reg = await anon.get('/join');   // /accountant-register 301s here
    const rd = new JSDOM(reg.text).window.document;
    const box = rd.getElementById('conduct-accept');
    const link = [...rd.querySelectorAll('a')].find(a => /Professional Conduct Policy/.test(a.textContent));
    A('2  sign-up has a required "I accept" checkbox (bug: none — "by registering you agree")', !!box && box.type === 'checkbox' && box.required, box ? box.outerHTML.slice(0, 120) : 'no #conduct-accept');
    A('2b …linking to /conduct.html (bug: /terms.html#6, which does not exist)', !!link && link.getAttribute('href') === '/conduct.html', link ? link.getAttribute('href') : 'no link');
    const cp = await anon.get('/conduct-policy.js');
    A('2c the browser can load the version source (/conduct-policy.js)', cp.status === 200 && /VERSION/.test(cp.text), 'status ' + cp.status);

    // the server
    const body = (email, extra) => Object.assign({ firstName: 'Con', lastName: 'Duct', email, password: PW, firm: 'Duct & Co', country: 'United Kingdom', specialisation: 'Bookkeeping', verification: { method: 'membership', profBody: 'ACCA', membershipNumber: 'ACCA-123' } }, extra || {});
    const r0 = await anon.post('/api/accountants/register', body('c0@finflow.test'));
    A('3  registering WITHOUT accepting is refused (bug: 201 — agreed to nothing)', r0.status === 400 && (r0.json || {}).code === 'CONDUCT_REQUIRED', r0.status + ' ' + String(r0.text).slice(0, 120));
    const rOld = await anon.post('/api/accountants/register', body('c1@finflow.test', { conductAccepted: true, conductVersion: '0.9' }));
    A('3b accepting an OLD version is refused', rOld.status === 400 && (rOld.json || {}).code === 'CONDUCT_REQUIRED', rOld.status + ' ' + String(rOld.text).slice(0, 120));
    const r1 = await anon.post('/api/accountants/register', body('c2@finflow.test', { conductAccepted: true, conductVersion: V }));
    A('3c accepting the current version registers', r1.status === 201, r1.status + ' ' + String(r1.text).slice(0, 120));
    const acc2 = (await c.query(`SELECT id, conduct_version, conduct_accepted_at FROM accountants WHERE email = 'c2@finflow.test'`).catch(e => ({ rows: [], e }))).rows[0] || {};
    const hist2 = acc2.id ? (await c.query(`SELECT version FROM conduct_acceptances WHERE accountant_id = $1`, [acc2.id]).catch(() => ({ rows: [] }))).rows : [];
    A('3d …and records the version and time, with a history row', acc2.conduct_version === V && !!acc2.conduct_accepted_at && hist2.length === 1 && hist2[0].version === V, JSON.stringify({ acc2, hist2 }));

    // an existing accountant, from before the policy, with a client
    const owner = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'con-owner@finflow.test', name: 'Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('old-acc@finflow.test', $1, 'Old', 'Acc', 'Firm', 'CODEOLDACC', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, owner]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '203.0.113.72' });
    const li = await acc.post('/api/accountants/login', { email: 'old-acc@finflow.test', password: PW });
    const st = (li.json || {}).conduct || {};
    A('4  at sign-in an existing accountant is asked to accept, with 14 days of grace', li.status === 200 && st.required === true && st.paused === false && !!st.graceEndsAt, li.status + ' ' + JSON.stringify(st));
    const booksIn = await acc.get(`/api/accountants/clients/${owner}/books?period=year`);
    A('4b within the grace period client books still open', booksIn.status === 200, 'status ' + booksIn.status);

    await c.query(`UPDATE accountants SET conduct_prompted_at = NOW() - INTERVAL '15 days' WHERE id = $1`, [accId]);
    const booksOut = await acc.get(`/api/accountants/clients/${owner}/books?period=year`);
    A('5  after 14 days without accepting, client books pause (403 CONDUCT_ACCEPTANCE_REQUIRED; bug: open)', booksOut.status === 403 && (booksOut.json || {}).code === 'CONDUCT_ACCEPTANCE_REQUIRED', booksOut.status + ' ' + String(booksOut.text).slice(0, 120));
    const jr = await acc.post(`/api/accountants/clients/${owner}/journal`, { lines: [] });
    A('5b …writes to client books too', jr.status === 403 && (jr.json || {}).code === 'CONDUCT_ACCEPTANCE_REQUIRED', 'status ' + jr.status);
    const msg = await acc.get(`/api/accountants/clients/${owner}/messages`);
    A('5c …but messages with the client keep working', msg.status === 200, 'status ' + msg.status);
    const me = await acc.get('/api/accountants/me');
    A('5d /me says the access is paused and why', ((me.json || {}).conduct || {}).paused === true, JSON.stringify((me.json || {}).conduct));

    const badAcc = await acc.post('/api/accountants/conduct/accept', { version: '0.9' });
    A('6  accepting a version that is not current is refused', badAcc.status === 400, 'status ' + badAcc.status);
    // the dashboard asks, and its button accepts (the real page, its real script, the real endpoint)
    const cookiePair = [...acc.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const page = await acc.get('/accountant');
    const jar = new CookieJar();
    for (const [k, v] of acc.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, server.baseUrl);
    const dom = new JSDOM(page.text, { url: server.baseUrl + '/accountant', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
    const nodeFetch = global.fetch;
    dom.window.fetch = (input, init = {}) => { const u = typeof input === 'string' ? input : String(input && input.url || input);
      const abs = u.startsWith('http') ? u : server.baseUrl + (u.startsWith('/') ? u : '/' + u);
      return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) })); };
    let banner = null;
    for (let i = 0; i < 60 && !banner; i++) { await new Promise(r => setTimeout(r, 100)); banner = dom.window.document.getElementById('ff-conduct-banner'); }
    const bt = banner ? banner.textContent.replace(/\s+/g, ' ') : '';
    A('6a the dashboard shows the request — "paused", with a link to the policy and an Accept button', /paused/i.test(bt) && !!dom.window.document.getElementById('ff-conduct-accept') && !!banner.querySelector('a[href="/conduct.html"]'), bt.slice(0, 160) || 'no banner');
    const btn = dom.window.document.getElementById('ff-conduct-accept');
    if (btn) btn.click();
    for (let i = 0; i < 60 && dom.window.document.getElementById('ff-conduct-banner'); i++) await new Promise(r => setTimeout(r, 100));
    const after = await acc.get(`/api/accountants/clients/${owner}/books?period=year`);
    A('6b clicking Accept records it and reopens client books (the banner goes)', !dom.window.document.getElementById('ff-conduct-banner') && after.status === 200, 'banner still there: ' + !!dom.window.document.getElementById('ff-conduct-banner') + ' · books ' + after.status);
    try { dom.window.close(); } catch (_) {}
    const hist = (await c.query(`SELECT version FROM conduct_acceptances WHERE accountant_id = $1`, [accId])).rows;
    A('6c …and is recorded (one history row, version ' + V + ')', hist.length === 1 && hist[0].version === V, JSON.stringify(hist));
    const again = await acc.post('/api/accountants/conduct/accept', { version: V });
    const hist3 = (await c.query(`SELECT count(*)::int AS n FROM conduct_acceptances WHERE accountant_id = $1`, [accId])).rows[0].n;
    A('6d accepting twice records it once (idempotent)', again.status === 200 && hist3 === 1, again.status + ' rows=' + hist3);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (server) await server.close();
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-E conduct policy)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
