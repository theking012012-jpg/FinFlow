'use strict';
/**
 * verify-portal-balance-sheet.js — L38. The accountant portal built its OWN balance sheet (accountant-routes.js /books
 * `balanceSheet` + accountant-client.html renderBalanceSheet): assets = AR only, liabilities = AP + "Payroll
 * Obligations" where that figure was the PERIOD PAYROLL EXPENSE (books.parts.payroll — wages already paid are not owed),
 * equity = assets − liabilities. A second writer of the balance sheet (failure #2), disagreeing with the owner's own
 * statement (glBalanceSheet). Fix: the portal reads glBalanceSheet itself, scoped to what the accountant may see —
 * a single entity, the whole account (legacy link), or ONLY the permitted entities (fine-grained grant; a hidden
 * entity's balances must never enter the totals).
 *
 * Seed (UTC entities, clock pinned 2026-07-25), through the REAL routes:
 *   Entity A: invoice 1,000 pending (06-01) · bill 400 unpaid (06-02) · JE 07-01 Dr 1010 Checking 5,000 / Cr 3000
 *             Owner's Equity 5,000 · payroll: employee gross 2,000, run 2026-07 approved then PAID.
 *   Entity B (hidden from the scoped accountant): JE 07-02 Dr 1010 Checking 777 / Cr 3000 Owner's Equity 777.
 * HAND-COMPUTED (Rule 6):
 *   A alone        Cash 3,000 (5,000 − 2,000 wages paid) · AR 1,000 = 4,000 | AP 400 = 400 | Owner's Equity 5,000 ·
 *                  accumulated net income −1,400 (1,000 − 400 − 2,000) = 3,600.          4,000 = 400 + 3,600
 *   A + B          Cash 3,777 · AR 1,000 = 4,777 | AP 400 | Owner's Equity 5,777 · net income −1,400 = 4,377
 * BUGGY (pre-fix) portal: assets 1,000 (AR only) · liabilities 2,400 (AP 400 + "Payroll Obligations" 2,000 —
 *   the paid wages) · equity −1,400 · no lines; a missing permitted-entity filter would show the scoped accountant
 *   A + B (4,777) instead of A (4,000).
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-portal-balance-sheet.js
 */
require('./clock.js');
const clock = require('./clock.js');
const bcrypt = require('bcryptjs');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const num = t => parseFloat(String(t || '').replace(/[^\d.\-]/g, ''));
const sum = arr => Math.round((arr || []).reduce((s, l) => s + Number(l.amount || 0), 0) * 100) / 100;
const wait = ms => new Promise(r => setTimeout(r, ms));

async function openPage(origin, httpClient, urlPath) {
  const cookiePair = [...httpClient.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const htmlRes = await httpClient.get(urlPath);
  if (htmlRes.status !== 200) throw new Error('GET ' + urlPath + ' ' + htmlRes.status);
  const jar = new CookieJar();
  for (const [k, v] of httpClient.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, origin);
  const dom = new JSDOM(htmlRes.text, { url: origin + urlPath, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.Date = (function () { const P = clock.PINNED_MS; class PD extends w.Date { constructor(...a) { if (a.length === 0) super(P); else super(...a); } static now() { return P; } } return PD; })();
  const nodeFetch = global.fetch;
  w.fetch = (input, init = {}) => { const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const abs = url.startsWith('http') ? url : origin + (url.startsWith('/') ? url : '/' + url);
    return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) })); };
  return dom;
}

// tag, the statement under test, and the hand-computed figures it must equal
function checkStatement(tag, bs, exp) {
  const L = (bs && bs.lines) || {};
  A(`${tag}: totals ${exp.ta} / ${exp.tl} / ${exp.eq} (bug: ${exp.bug})`,
    near(bs && bs.totalAssets, exp.ta) && near(bs && bs.totalLiabilities, exp.tl) && near(bs && bs.equity, exp.eq),
    JSON.stringify(bs && { source: bs.source, ta: bs.totalAssets, tl: bs.totalLiabilities, eq: bs.equity, ar: bs.accountsReceivable, ap: bs.accountsPayable, payroll: bs.totalPayroll }).slice(0, 260));
  A(`${tag}: cash ${exp.cash} (wages paid reduce cash; they are not a liability)`, near(bs && bs.cash, exp.cash), 'cash=' + (bs && bs.cash));
  A(`${tag}: lines foot — Σ assets ${exp.ta}, Σ liabilities ${exp.tl}, Σ equity ${exp.eq}`,
    Array.isArray(L.assets) && near(sum(L.assets), exp.ta) && near(sum(L.liabilities), exp.tl) && near(sum(L.equity), exp.eq),
    JSON.stringify(L).slice(0, 260));
  A(`${tag}: no "payroll obligation" for wages already paid (payrollLiabilities 0; bug: totalPayroll 2,000)`,
    bs && !(Number(bs.totalPayroll) > 0) && !(Number(bs.payrollLiabilities) > 0), JSON.stringify({ totalPayroll: bs && bs.totalPayroll, payrollLiabilities: bs && bs.payrollLiabilities }));
}

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server, portal;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L38 — the accountant portal balance sheet IS the owner\'s balance sheet, scoped to the grant\n' + '='.repeat(78) + '\n');
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'l38@finflow.test', name: 'L38', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.138' });
    if ((await http.post('/api/auth/login', { email: 'l38@finflow.test', password: PW })).status !== 200) throw new Error('owner login');
    const J = async (p, b, m) => { const r = await (m === 'PUT' ? http.put(p, b) : http.post(p, b)); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
    const eA = await J('/api/entities', { name: 'A Co', currency: 'USD', timezone: 'UTC', country: 'US' });
    const eB = await J('/api/entities', { name: 'B Co', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('/api/entities/' + eA.id + '/activate', {});
    await J('/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-08-01', entity_id: eA.id });
    await J('/api/bills', { vendor: 'Supplier', amount: 400, status: 'unpaid', issue_date: '2026-06-02', due_date: '2026-08-02', entity_id: eA.id });
    await J('/api/journals', { date: '2026-07-01', description: 'Owner investment A', status: 'Posted', entity_id: eA.id,
      lines: [{ code: '1010', name: 'Checking Account', debit: 5000, credit: 0 }, { code: '3000', name: "Owner's Equity", debit: 0, credit: 5000 }] });
    await J('/api/payroll', { fname: 'Ada', lname: 'L', gross: 2000, entity_id: eA.id });
    const run = await J('/api/payroll-runs', { period: '2026-07', entity_id: eA.id });
    await J('/api/payroll-runs/' + run.id + '/approve', { entity_id: eA.id }, 'PUT');
    await J('/api/payroll-runs/' + run.id + '/mark-paid', { entity_id: eA.id }, 'PUT');
    await J('/api/journals', { date: '2026-07-02', description: 'Owner investment B', status: 'Posted', entity_id: eB.id,
      lines: [{ code: '1010', name: 'Checking Account', debit: 777, credit: 0 }, { code: '3000', name: "Owner's Equity", debit: 0, credit: 777 }] });

    const EXP_A = { ta: 4000, tl: 400, eq: 3600, cash: 3000, bug: 'assets 1,000 · liabilities 2,400 · equity −1,400' };
    const EXP_AB = { ta: 4777, tl: 400, eq: 4377, cash: 3777, bug: 'assets 1,000 · liabilities 2,400 · equity −1,400' };

    // ── CONTROL: the owner's own statements are already right (they are the oracle the portal must equal) ──
    const ownA = (await http.post('/api/reports/balance-sheet?entity_id=' + eA.id, {})).json || {};
    const ownAll = (await http.post('/api/reports/balance-sheet?entity_id=all', {})).json || {};
    A('CONTROL: owner A served from the reconciled GL, 4,000 / 400 / 3,600', ownA.source === 'gl' && near(ownA.totalAssets, 4000) && near(ownA.totalLiabilities, 400) && near(ownA.equity, 3600), JSON.stringify(ownA).slice(0, 220));
    A('CONTROL: owner all-entities served from the GL, 4,777 / 400 / 4,377', ownAll.source === 'gl' && near(ownAll.totalAssets, 4777) && near(ownAll.equity, 4377), JSON.stringify(ownAll).slice(0, 220));

    // ── accountant 1: legacy (whole-account) link ──
    const mkAcc = async (tag, entityAccess) => {
      const email = 'l38-' + tag + '@finflow.test';
      const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
         VALUES ($1,$2,'Acc',$3,'Firm',$4,'verified') RETURNING id`, [email, bcrypt.hashSync(PW, 10), tag, 'CODEL38' + tag.toUpperCase()])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, entity_access) VALUES ($1,$2,'active','filing',$3)`,
        [accId, uid, entityAccess == null ? null : JSON.stringify(entityAccess)]);
      const h = new HarnessHttp(server.baseUrl, { xff: tag === 'wide' ? '203.0.113.139' : '203.0.113.140' });
      if ((await h.post('/api/accountants/login', { email, password: PW })).status !== 200) throw new Error('accountant login ' + tag);
      return h;
    };
    const wide = await mkAcc('wide', null);
    const books = async (h, q) => ((await h.get('/api/accountants/clients/' + uid + '/books?period=year' + (q || ''))).json || {}).balanceSheet || {};
    checkStatement('legacy accountant, entity A', await books(wide, '&entity_id=' + eA.id), EXP_A);
    const wideAll = await books(wide, '');
    checkStatement('legacy accountant, all entities', wideAll, EXP_AB);
    A('legacy accountant all-entities == owner all-entities (one writer)', near(wideAll.totalAssets, ownAll.totalAssets) && near(wideAll.totalLiabilities, ownAll.totalLiabilities) && near(wideAll.equity, ownAll.equity),
      JSON.stringify({ portal: [wideAll.totalAssets, wideAll.totalLiabilities, wideAll.equity], owner: [ownAll.totalAssets, ownAll.totalLiabilities, ownAll.equity] }));

    // ── accountant 2: fine-grained grant — entity A 'view', entity B 'none' ──
    const scoped = await mkAcc('scoped', { entities: { [eA.id]: 'view', [eB.id]: 'none' }, personal: 'none' });
    const scAll = await books(scoped, '');
    checkStatement('scoped accountant, all permitted entities (= A only)', scAll, EXP_A);
    A('scoped accountant never sees the hidden entity\'s 777 (filter bug: 4,777)', !near(scAll.totalAssets, 4777) && !JSON.stringify(scAll).includes('3777') && !JSON.stringify(scAll).includes('5777'), JSON.stringify(scAll).slice(0, 220));
    const scB = await scoped.get('/api/accountants/clients/' + uid + '/books?period=year&entity_id=' + eB.id);
    A('scoped accountant: hidden entity B by id → 403 (control)', scB.status === 403, 'status=' + scB.status);

    // ── rendered portal (legacy accountant, default All-entities view) ──
    portal = await openPage(server.baseUrl, wide, `/accountant-client?client=${uid}`);
    await wait(6000);
    const d = portal.window.document;
    const rowsIn = id => [...((d.getElementById(id) || { querySelectorAll: () => [] }).querySelectorAll('.bs-row'))].map(r => { const sp = r.querySelectorAll('span'); return { label: (sp[0] || {}).textContent, value: num((sp[sp.length - 1] || {}).textContent) }; });
    const tot = id => num((d.getElementById(id) || {}).textContent);
    const rs = arr => Math.round(arr.reduce((s, r) => s + (Number.isFinite(r.value) ? r.value : 0), 0) * 100) / 100;
    const aR = rowsIn('bs-assets-lines'), lR = rowsIn('bs-liab-lines'), eR = rowsIn('bs-equity-lines');
    console.log('  [rendered] assets ' + JSON.stringify(aR) + ' | liabilities ' + JSON.stringify(lR) + ' | equity ' + JSON.stringify(eR) + ' | totals ' + [tot('bs-assets'), tot('bs-liabilities'), tot('bs-equity')]);
    A('rendered portal: Total Assets 4,777 and the asset rows foot to it (bug: 1,000, AR only)', near(tot('bs-assets'), 4777) && near(rs(aR), 4777), 'rows=' + rs(aR) + ' total=' + tot('bs-assets'));
    A('rendered portal: Total Liabilities 400 and the liability rows foot to it (bug: 2,400 incl. paid wages)', near(tot('bs-liabilities'), 400) && near(rs(lR), 400), 'rows=' + rs(lR) + ' total=' + tot('bs-liabilities'));
    A('rendered portal: Equity 4,377 and the equity rows foot to it (bug: −1,400)', near(tot('bs-equity'), 4377) && near(rs(eR), 4377), 'rows=' + rs(eR) + ' total=' + tot('bs-equity'));
    A('rendered portal: no "Payroll Obligations" row', !/Payroll Obligations/i.test((d.getElementById('section-balance') || {}).textContent || ''), 'section text has Payroll Obligations');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (portal) { try { portal.window.close(); } catch (_) {} }
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (portal balance sheet = owner\'s)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
