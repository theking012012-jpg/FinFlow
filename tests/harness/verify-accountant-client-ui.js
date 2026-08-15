#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-client-ui.js — EXECUTE the accountant-client.html gating in jsdom (was
 * inspection-only). Loads the real standalone accountant page with an accountant session and
 * asserts the journal/lock edit affordances are hidden for a `view` accountant and shown for a
 * `filing` one — the client half of the F158 view/filing feature.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-client-ui.js
 *
 * Standalone jsdom (accountant-client.html is served at /accountant-client?client=<id>, not the SPA),
 * so the plumbing (cookie jar + window.fetch → server) is replicated here from jsdomBoot.
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const settle = async (n = 60, ms = 100) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, ms)); };

async function loadScenario(server, c, tag, accessLevel) {
  const clientId = (await c.query(
    `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
    [{ email: `acui-client-${tag}@finflow.test`, name: `Client ${tag}`, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
  )).rows[0].id;
  await seed(c, clientId);   // real books so the page renders periods/journal sections
  const accId = (await c.query(
    `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
     VALUES ($1,$2,'Acc',$3,'Firm',$4,'verified') RETURNING id`,
    [`acui-acc-${tag}@finflow.test`, bcrypt.hashSync(PW, 10), tag, 'CODE' + tag.toUpperCase()]
  )).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active',$3)`,
    [accId, clientId, accessLevel]);

  const http = new HarnessHttp(server.baseUrl);
  const lg = await http.post('/api/accountants/login', { email: `acui-acc-${tag}@finflow.test`, password: PW });
  if (lg.status !== 200) throw new Error(`acc login (${tag}): ${lg.status}`);
  const cookiePair = [...http.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const pageUrl = `${server.baseUrl}/accountant-client?client=${clientId}`;
  const htmlRes = await http.get(`/accountant-client?client=${clientId}`);
  if (htmlRes.status !== 200) throw new Error(`GET page (${tag}): ${htmlRes.status}`);

  const jar = new CookieJar();
  for (const [k, v] of http.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, server.baseUrl);
  const vc = new VirtualConsole();
  const dom = new JSDOM(htmlRes.text, { url: pageUrl, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc });
  const window = dom.window;
  const nodeFetch = global.fetch;
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const abs = url.startsWith('http') ? url : server.baseUrl + (url.startsWith('/') ? url : '/' + url);
    return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) }));
  };
  await settle(70, 100);
  return { window, dom };
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT-CLIENT UI — journal/lock gating by access_level (real page in jsdom)');
    console.log('='.repeat(78));

    const jbtnHidden = (w) => {
      const btns = [...w.document.querySelectorAll('[onclick="toggleJournalForm()"]')];
      return btns.length > 0 && btns.every(b => b.style.display === 'none');
    };
    const jbtnShown = (w) => {
      const btns = [...w.document.querySelectorAll('[onclick="toggleJournalForm()"]')];
      return btns.length > 0 && btns.every(b => b.style.display !== 'none');
    };
    const periodsHtml = (w) => ((w.document.getElementById('periods-list') || {}).innerHTML) || '';

    // ── VIEW: edit affordances hidden ──
    console.log('\n-- access_level = view --');
    const v = await loadScenario(server, c, 'view', 'view');
    A('view: _acctCanEdit === false', v.window._acctCanEdit === false, `_acctCanEdit=${v.window._acctCanEdit}`);
    A('view: Journal Entry button(s) HIDDEN', jbtnHidden(v.window), 'expected all display:none');
    A('view: period rows show "View-only", not a Lock Period button',
      /View-only/.test(periodsHtml(v.window)) && !/Lock Period/.test(periodsHtml(v.window)), `periods=${periodsHtml(v.window).slice(0,160)}`);

    // ── FILING: edit affordances shown ──
    console.log('\n-- access_level = filing --');
    const f = await loadScenario(server, c, 'filing', 'filing');
    A('filing: _acctCanEdit === true', f.window._acctCanEdit === true, `_acctCanEdit=${f.window._acctCanEdit}`);
    A('filing: Journal Entry button(s) SHOWN', jbtnShown(f.window), 'expected display not none');
    A('filing: period rows offer a Lock Period button', /Lock Period/.test(periodsHtml(f.window)), `periods=${periodsHtml(f.window).slice(0,160)}`);

    try { v.dom.window.close(); f.dom.window.close(); } catch (_) {}
    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (accountant-client UI gating)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    try { if (appPool && appPool.end && !appPool.ended) await appPool.end(); } catch (_) {}
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('[acui] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});
