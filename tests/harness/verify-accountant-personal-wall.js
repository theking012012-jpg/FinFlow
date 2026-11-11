#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-personal-wall.js — owner question 2026-11-11 (after live 6.5b): with Personal access = NONE, can an
 * accountant reach the owner's personal finances through ANY route, not only the portal's books call?
 *
 * Real server + scratch Postgres, real logins (owner session + accountant session), no stubs. The owner's access is set
 * through the owner's own route (PUT /api/accountants/my-accountant/access) — the one the My Accountant page uses.
 * Personal data carries MARKERS no business row has: a transaction "ZQXPERS-TX" for 9,137.41, an account "ZQXPERS-ACCT"
 * worth 52,345.67, a holding "ZQXH" (7 × 311.13 = 2,177.91), a goal "ZQXPERS-GOAL", a net-worth snapshot 61,234.56.
 *
 * Routes, enumerated from the code (Rule 13), so a new accountant route cannot be missed silently:
 *   · EVERY GET route registered in accountant-routes.js (parsed from the source to build the list — the assertions are on
 *     the HTTP responses; a GET with an unfillable :param is reported, not skipped silently), :userId = this client;
 *   · the read-type POST  /api/accountants/clients/:userId/ai-insights. NOTE: with no AI key (harness) it answers 503
 *     AFTER assembling its facts — its response is checked, but the prompt it would send is not executed here. By reading
 *     (accountant-routes.js ~1662–1695) the facts are business-only (books + scoped invoices/expenses; no personal table).
 *   · the owner's own personal routes (/api/personal-transactions, -accounts, -history, -bank, /api/holdings, /api/goals,
 *     /api/snapshots, /api/budget-targets, /api/plaid/items) called with the ACCOUNTANT's session.
 * SSE routes (…/stream) are read for 1.5 s.
 * EXPECTED with personal = none: no response contains any marker; the books payload has personalAccess "none" and no
 *   `personal` block.
 * DISCRIMINATOR (Rule 4): the same accountant with personal = VIEW must see the markers on the books route — proving the
 *   markers are detectable and the "none" result is not an artefact of a seed nobody could see.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-personal-wall.js
 */
const fs = require('fs'), path = require('path');
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const MARKERS = ['ZQXPERS-TX', '9137.41', '9,137.41', 'ZQXPERS-ACCT', '52345.67', '52,345.67', 'ZQXH', '2177.91', 'ZQXPERS-GOAL', '61234.56', '61,234.56'];
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const hits = t => MARKERS.filter(m => String(t || '').includes(m));

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  Accountant ↔ Personal wall — personal = none hides personal data on EVERY route\n' + '='.repeat(78) + '\n');

    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: 'wall-owner@finflow.test', name: 'Wall Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await seed(c, uid);
    const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('wall-acc@finflow.test', $1, 'Acc', 'Wall', 'Firm', 'WALLCODE', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1, $2, 'active', 'view')`, [acc, uid]);

    const owner = new HarnessHttp(server.baseUrl);
    const OK = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 200)); return r; };
    A('owner logs in', (await owner.post('/api/auth/login', { email: 'wall-owner@finflow.test', password: PW })).status === 200);
    const ent = JSON.parse(OK(await owner.post('/api/entities', { name: 'Wall Biz', currency: 'USD', timezone: 'UTC', country: 'US' })).text);
    OK(await owner.post('/api/entities/' + ent.id + '/activate', {}));
    OK(await owner.post('/api/invoices', { client: 'BizCust', amount: 4000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-31', idempotency_key: 'w-i' }));
    // personal data — through the owner's own route where it has one, otherwise the real tables (entity_id NULL = personal)
    OK(await owner.post('/api/personal-transactions', { description: 'ZQXPERS-TX', amount: 9137.41, currency: 'USD', category: 'Freelance', tx_type: 'income', tx_date: '2026-07-10', idempotency_key: 'w-p' }));
    for (const [table, data] of [
      ['personal_accounts', { name: 'ZQXPERS-ACCT', kind: 'asset', value: 52345.67, value_usd: 52345.67, currency: 'USD' }],
      ['holdings', { ticker: 'ZQXH', name: 'ZQXH Corp', asset_type: 'Stock', shares: 7, cost_per: 200, price: 311.13 }],
      ['goals', { name: 'ZQXPERS-GOAL', target: 10000, saved: 2500 }],
      ['snapshots', { kind: 'networth', date: '2026-07-20', value: 61234.56 }],
    ]) await c.query(`INSERT INTO ${table} (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`, [uid, data]);

    const setAccess = async personal => {
      const r = await owner.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [String(ent.id)]: 'view' }, personal } });
      A(`owner sets Personal = ${personal} (business = view) through the owner route`, r.status >= 200 && r.status < 300, r.status + ' ' + r.text.slice(0, 160));
    };
    const accHttp = new HarnessHttp(server.baseUrl);
    A('accountant logs in', (await accHttp.post('/api/accountants/login', { email: 'wall-acc@finflow.test', password: PW })).status === 200);

    // ── DISCRIMINATOR: personal = view → the markers ARE visible on the books route ──
    await setAccess('view');
    const bv = await accHttp.get(`/api/accountants/clients/${uid}/books`);
    const bvj = JSON.parse(bv.text || '{}');
    A('[DISCRIMINATOR] personal = view: books carries the personal block with the markers (bug-free seed is visible)',
      bv.status === 200 && bvj.personalAccess === 'view' && !!bvj.personal && hits(bv.text).length >= 2, 'status ' + bv.status + ' access ' + bvj.personalAccess + ' hits ' + JSON.stringify(hits(bv.text)));

    // ── personal = none ──
    await setAccess('none');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'accountant-routes.js'), 'utf8');
    const gets = [...src.matchAll(/^\s*(?:router|app)\.get\('([^']+)'/gm)].map(m => m[1]);
    const fill = p => p.replace(':userId', String(uid)).replace(/\/:id\/reviews$/, '/' + acc + '/reviews').replace(':id', '1');
    const urls = [...new Set(gets.map(fill))].map(u => u === '/api/accountants/bill-options' ? u + '?clientId=' + uid : u);   // needs ?clientId
    const unfilled = urls.filter(u => /:[a-zA-Z]/.test(u));
    A('every GET route in accountant-routes.js has its parameters filled (' + gets.length + ' routes)', unfilled.length === 0, JSON.stringify(unfilled));
    const ownerPersonal = ['/api/personal-transactions', '/api/personal-accounts', '/api/personal-history', '/api/personal-bank', '/api/holdings', '/api/holdings?scope=personal',
      '/api/goals', '/api/snapshots?kind=networth', '/api/snapshots?kind=portfolio', '/api/budget-targets', '/api/plaid/items', '/api/plaid/items?scope=personal'];
    const cookie = accHttp._cookieHeader();
    const read = async (method, u, body) => {
      if (/\/stream$/.test(u)) {
        const ac = new AbortController(); let text = '', status = 0;
        const t = setTimeout(() => ac.abort(), 1500);
        try { const r = await fetch(server.baseUrl + u, { headers: { cookie }, signal: ac.signal }); status = r.status;
          const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; text += Buffer.from(value).toString(); } }
        catch (_) {} finally { clearTimeout(t); }
        return { status, text };
      }
      return method === 'POST' ? accHttp.post(u, body || {}) : accHttp.get(u);
    };
    const leaks = [], statuses = {};
    for (const u of urls) { const r = await read('GET', u); statuses[u] = r.status; const h = hits(r.text); if (h.length) leaks.push(u + ' → ' + r.status + ' ' + JSON.stringify(h)); }
    const ai = await read('POST', `/api/accountants/clients/${uid}/ai-insights`); statuses['POST ai-insights'] = ai.status;
    if (hits(ai.text).length) leaks.push('POST ai-insights → ' + ai.status + ' ' + JSON.stringify(hits(ai.text)));
    for (const u of ownerPersonal) { const r = await read('GET', u); statuses['acct-session ' + u] = r.status; const h = hits(r.text); if (h.length) leaks.push('accountant session ' + u + ' → ' + r.status + ' ' + JSON.stringify(h)); }
    console.log('  info  statuses: ' + JSON.stringify(statuses));
    A(`personal = none: NO personal marker in any of ${urls.length} accountant GET routes + ai-insights + ${ownerPersonal.length} owner personal routes (accountant session)`, leaks.length === 0, leaks.join('\n          '));
    const bn = JSON.parse((await accHttp.get(`/api/accountants/clients/${uid}/books`)).text || '{}');
    A('personal = none: books says personalAccess "none" and carries no `personal` block', bn.personalAccess === 'none' && bn.personal == null, 'personalAccess ' + bn.personalAccess + ' personal ' + JSON.stringify(bn.personal).slice(0, 80));
    A('the business is still served (wall is personal-only): books has revenue > 0', Number(bn.revenue || (bn.books && bn.books.revenue) || 0) > 0 || /4000|4,000/.test(JSON.stringify(bn)), JSON.stringify(bn).slice(0, 160));
  } finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { await scratch.stop(); } catch (_) {}
  }
}
main().catch(e => { fail++; console.log('  FATAL: ' + e.message + ' ' + (e.code || '') + '\n' + e.stack); if (e.errors) e.errors.forEach(x => console.log('  - ' + x.message)); })
  .finally(() => { console.log('\n' + '-'.repeat(78)); console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant personal wall)`); process.exit(fail ? 1 : 0); });
