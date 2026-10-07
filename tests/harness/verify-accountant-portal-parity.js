#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-portal-parity.js — Phase 1.1 / L10 (Rule 2: "the accountant portal" and "exports"
 * are surfaces of every money figure). The accountant looking at a client's books must see the SAME
 * figures the owner sees. The portal's headline cards already read the canonical server summary
 * (computeBooks); four surfaces re-derived money from the raw rows instead:
 *
 *   Invoices · Outstanding   Σ full amount of every non-paid invoice     → 790  (canonical AR 725)
 *   Invoices · Collected     Σ full amount of FULLY-paid invoices         →   0  (Σ amount_paid 60)
 *   Invoices · Overdue       Σ invoices whose STATUS reads 'overdue'      →   0  (canonical 85: past-due 90 − open credit 5)
 *   Expenses · Total         Σ expense rows only                          →   8  (canonical opex 614)
 *   Expenses · Deductible    Σ rows marked 'yes' (ignores 'half')         →   0  (canonical 4)
 *   CSV export P&L SUMMARY   revenue = paid invoices, expenses = rows     → '' / 8 / −8 (835 / 614 / 221)
 *                            (and its quote helper wrote 0 as an empty cell: `v || ''`)
 *
 * Seed: fullLegScenario written by the OWNER through the real endpoints, plus one past-due invoice (90,
 * issued 2026-05-01, due 2026-06-01); accountant (verified) with an active 'filing' link. Hand-computed:
 * revenue 835 · opex 614 · net 221 · AR 725 · overdue 85 (past-due balance 90 net of the open credit
 * note 5 — the established AR rule, verify-ar-by-customer) · collected 60 · deductible 4.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-portal-parity.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const { postFullLegScenario, EXPECTED } = require('./fullLegScenario.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const settle = async (n = 60, ms = 100) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, ms)); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const money = s => { const m = String(s == null ? '' : s).replace(/[,\s]/g, '').match(/(-?)[^\d-]*(-?\d+(?:\.\d+)?)/); return m ? (m[1] === '-' ? -1 : 1) * parseFloat(m[2]) : NaN; };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null, dom = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L10 — accountant portal shows the owner\'s canonical figures (incl. CSV export)\n' + '='.repeat(78) + '\n');
    const ownerEmail = 'portal-owner@finflow.test';
    const clientId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: ownerEmail, name: 'Portal Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const owner = new HarnessHttp(server.baseUrl, { xff: '203.0.113.91' });
    if ((await owner.post('/api/auth/login', { email: ownerEmail, password: PW })).status !== 200) throw new Error('owner login');
    await postFullLegScenario({ http: owner, client: c });
    // + one PAST-DUE invoice (status stays 'pending'): 90, issued 2026-05-01, due 2026-06-01 — makes Overdue
    // discriminate (a status-literal 'overdue' reader shows 0) and moves every total off the base seed:
    //   revenue 745+90 = 835 · opex 614 · net 221 · AR 635+90 = 725 · overdue 90−5 = 85 · collected 60
    const _x = await owner.post('/api/invoices', { client: 'Late Co', amount: 90, status: 'pending', issue_date: '2026-05-01', due_date: '2026-06-01' });
    if (_x.status >= 300) throw new Error('late invoice ' + _x.status);

    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ($1,$2,'Acc','Parity','Firm','CODEPARITY','verified') RETURNING id`, ['portal-acc@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, clientId]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '203.0.113.92' });
    if ((await acc.post('/api/accountants/login', { email: 'portal-acc@finflow.test', password: PW })).status !== 200) throw new Error('accountant login');

    const books = JSON.parse((await acc.get(`/api/accountants/clients/${clientId}/books?period=year`)).text);
    A('server books summary: revenue 835 · opex 614 · net 221 · AR 725', near(books.summary.revenue, 835) && near(books.summary.opex, 614) && near(books.summary.netProfit, 221) && near(books.summary.outstanding, 725),
      JSON.stringify(books.summary));

    const cookiePair = [...acc.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const htmlRes = await acc.get(`/accountant-client?client=${clientId}`);
    if (htmlRes.status !== 200) throw new Error('GET portal ' + htmlRes.status);
    const jar = new CookieJar();
    for (const [k, v] of acc.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, server.baseUrl);
    dom = new JSDOM(htmlRes.text, { url: `${server.baseUrl}/accountant-client?client=${clientId}`, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
    const w = dom.window;
    const nodeFetch = global.fetch;
    w.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const abs = url.startsWith('http') ? url : server.baseUrl + (url.startsWith('/') ? url : '/' + url);
      return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) }));
    };
    let csvBlob = null;
    w.URL.createObjectURL = b => { csvBlob = b; return 'blob:harness'; };
    w.HTMLAnchorElement.prototype.click = function () {};
    await settle(70, 100);
    const t = id => { const el = w.document.getElementById(id); return el ? el.textContent.trim() : null; };

    // headline (control — already canonical)
    A('portal headline: revenue 835 · expenses 614 · profit 221 · outstanding 725',
      near(money(t('d-revenue')), 835) && near(money(t('d-expenses')), 614) && near(money(t('d-profit')), 221) && near(money(t('d-outstanding')), 725),
      [t('d-revenue'), t('d-expenses'), t('d-profit'), t('d-outstanding')].join(' / '));
    // invoices page
    A('portal Invoices · Outstanding == canonical AR 725 (bug 790)', near(money(t('inv-outstanding')), EXPECTED.ar + 90), 'inv-outstanding=' + t('inv-outstanding'));
    A('portal Invoices · Collected == Σ amount_paid 60 (bug 0)', near(money(t('inv-collected')), 60), 'inv-collected=' + t('inv-collected'));
    const ownerRep = JSON.parse((await owner.get('/api/reports?period=year&fyStart=0')).text);
    A('owner /api/reports overdue == 85 (past-due 90 − open credit 5)', near(ownerRep.overdue, 85), 'overdue=' + ownerRep.overdue);
    A('portal Invoices · Overdue == owner overdue 85 (bug: status-literal 0)', near(money(t('inv-overdue')), 85), 'inv-overdue=' + t('inv-overdue'));
    // expenses page
    A('portal Expenses · Total == canonical opex 614 (bug 8)', near(money(t('exp-total')), EXPECTED.opex), 'exp-total=' + t('exp-total'));
    A('portal Expenses · Deductible == 4 (half of 8; bug 0)', near(money(t('exp-ded')), EXPECTED.deductible), 'exp-ded=' + t('exp-ded'));
    // CSV export
    w.exportCSV();
    const csv = csvBlob ? await csvBlob.text() : '';
    const row = k => { const m = csv.match(new RegExp('^"' + k + '","(-?[\\d.]+)"', 'm')); return m ? parseFloat(m[1]) : NaN; };
    A('CSV export produced', csv.length > 0, 'len=' + csv.length);
    A('CSV P&L Revenue == 835 (bug: paid invoices → empty cell)', near(row('Revenue'), 835), 'Revenue=' + row('Revenue'));
    A('CSV P&L Expenses == 614 (bug: rows 8)', near(row('Expenses'), 614), 'Expenses=' + row('Expenses'));
    A('CSV P&L Net Profit == 221 (bug: −8)', near(row('Net Profit'), 221), 'Net Profit=' + row('Net Profit'));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    try { if (dom) dom.window.close(); } catch (_) {}
    if (server && server.close) await server.close();
    await appPool.end().catch(() => {});
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (accountant portal parity)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main();
