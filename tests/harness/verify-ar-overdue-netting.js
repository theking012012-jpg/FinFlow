'use strict';
/**
 * verify-ar-overdue-netting.js — L35 (FIX_PLAN_AR_OVERDUE.md). "Overdue" must be ≤ Outstanding and NET of open|applied
 * credit notes on every surface, mirroring the server (server.js /api/reports `overdue` and computeBooks
 * `arSummary.overdueTotal` = min(outstanding, max(0, Σ past-due BALANCE − credit contra))). Live (dab2, 2026-10-07):
 * Overdue $14,300 > Outstanding $13,550 — impossible; server said $13,050. The $1,250 gap was one open credit note.
 *
 * Seed (UTC entity; clock pinned 2026-07-25), through the real routes — sized so GROSS ≠ BALANCE ≠ NETTED:
 *   INV-A  3,000  issued 05-01  due 06-01  partial: payment 1,000 ⇒ balance 2,000   (past due)
 *   INV-B  1,500  issued 06-01  due 07-01  status literally 'overdue' ⇒ balance 1,500 (past due)
 *   INV-C    800  issued 07-01  due 08-30  pending                     ⇒ balance   800 (not due)
 *   CN-1   1,200  open, 07-05 (customer of A)
 * HAND-COMPUTED (Rule 6):
 *   outstanding  = 2,000 + 1,500 + 800 − 1,200 = 3,100
 *   overdue      = min(3,100, (2,000 + 1,500) − 1,200) = 2,300          (2 invoices)
 * BUGGY VALUES each root produces (Rule 4 — every one differs from the correct figure):
 *   Root 1  client arOutstanding().overdueTotal un-netted        ⇒ 3,500 (dashboard sub-line, Invoices "Overdue" tile)
 *   Root 2  reminders rem-out = Σ listed candidates' balances     ⇒ 3,500 (owner's expected: netted outstanding 3,100)
 *   Root 3  portal, pre-L10: status==='overdue' literal, GROSS    ⇒ 1 invoice · 1,500 (no `summary.overdue` at all)
 *
 * Runs in PowerShell on the owner's machine (FIX_PLAN rule):  node -r ./tests/harness/clock.js tests/harness/verify-ar-overdue-netting.js
 */
require('./clock.js');
const clock = require('./clock.js');
const bcrypt = require('bcryptjs');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
// Every money token in a piece of text, as numbers (handles "$2,300", "$2,300.00", "TT$1,500", "2 · $2,300").
const amounts = t => (String(t || '').match(/\$\s?-?[\d,]+(?:\.\d+)?/g) || []).map(s => parseFloat(s.replace(/[^\d.\-]/g, '')));
const OUT = 3100, OVD = 2300;

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
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ctx, portal;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L35 — AR "Overdue" is net of credit notes and ≤ Outstanding, on every surface\n' + '='.repeat(78) + '\n');
    let accEmail = 'l35-acc@finflow.test';
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client: c, userId }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L35 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      const a = await J('/api/invoices', { client: 'Alpha Ltd', amount: 3000, status: 'pending', issue_date: '2026-05-01', due_date: '2026-06-01' });
      await J('/api/invoice-payments', { invoice_id: a.id, amount: 1000, payment_date: '2026-05-20', method: 'bank' });
      await J('/api/invoices', { client: 'Beta Ltd', amount: 1500, status: 'overdue', issue_date: '2026-06-01', due_date: '2026-07-01' });
      await J('/api/invoices', { client: 'Gamma Ltd', amount: 800, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-30' });
      await J('/api/credit-notes', { customer: 'Alpha Ltd', num: 'CN-1', amount: 1200, date: '2026-07-05' });
      const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
         VALUES ($1,$2,'Acc','L35','Firm','CODEL35','verified') RETURNING id`, [accEmail, bcrypt.hashSync(PW, 10)])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, userId]);
    } });
    const { window: w, settle, http, userId, origin } = ctx;
    await settle(60, 100);

    // ── server (the canonical figure every surface must mirror) ──
    const rep = (await http.get('/api/reports?period=year&fyStart=0')).json || {};
    A(`server /api/reports: outstanding ${OUT}, overdue ${OVD} (hand-computed)`, near(rep.outstanding, OUT) && near(rep.overdue, OVD), JSON.stringify({ outstanding: rep.outstanding, overdue: rep.overdue }));
    A('server: overdue ≤ outstanding', Number(rep.overdue) <= Number(rep.outstanding) + 0.005, JSON.stringify({ outstanding: rep.outstanding, overdue: rep.overdue }));

    // ── Root 1: client arOutstanding() and the surfaces that render it ──
    const invs = w._realInvoices || w.invoices || [];
    const ar = w._arOutstanding(invs);
    A(`Root 1: client arOutstanding().total = ${OUT}`, near(ar.total, OUT), JSON.stringify(ar));
    A(`Root 1: client arOutstanding().overdueTotal = ${OVD} == server (bug: 3,500 un-netted)`, near(ar.overdueTotal, OVD) && near(ar.overdueTotal, rep.overdue), JSON.stringify(ar));
    A('Root 1: client overdue ≤ outstanding', ar.overdueTotal <= ar.total + 0.005, JSON.stringify(ar));
    w.showPage('dashboard'); await settle(15, 100);
    if (typeof w.updateDashboard === 'function') { try { w.updateDashboard(); } catch (_) {} await settle(10, 100); }   // repaint from current data (updateKPIs)
    const sub = (w.document.getElementById('d-outstanding-chg') || {}).textContent || '';
    A(`Root 1: dashboard Outstanding sub-line reads "2 overdue · $2,300" (bug: $3,500)`, /2 overdue/.test(sub) && amounts(sub).some(v => near(v, OVD)) && !amounts(sub).some(v => near(v, 3500)), 'd-outstanding-chg=' + sub);
    w.showPage('invoices'); await settle(20, 100);
    if (typeof w.updateInvoices === 'function') { try { w.updateInvoices(); } catch (_) {} await settle(10, 100); }   // runtime winner (postgres wiring)
    const tile = (w.document.getElementById('inv-over') || {}).textContent || '';
    const outT = (w.document.getElementById('inv-out') || {}).textContent || '';
    A(`Root 1: Invoices "Overdue" tile $2,300 ≤ "Outstanding" $3,100 (bug: $3,500 > $3,100)`, amounts(tile).some(v => near(v, OVD)) && amounts(outT).some(v => near(v, OUT)), 'inv-over=' + tile + ' inv-out=' + outT);

    // ── Root 2: reminders "Outstanding" = the canonical netted outstanding (owner's expected), not Σ of the list ──
    const rem = (await http.get('/api/payment-reminders')).json || {};
    A(`Root 2: /api/payment-reminders summary.ar_outstanding = ${OUT} (bug: absent; list sum ${rem.summary && rem.summary.total_outstanding})`,
      rem.summary && near(rem.summary.ar_outstanding, OUT), JSON.stringify(rem.summary || {}));
    w.showPage('reminders'); await settle(30, 100);
    const remOut = (w.document.getElementById('rem-out') || {}).textContent || '';
    const remNum = parseFloat(String(remOut).replace(/[^\d.\-]/g, ''));
    A(`Root 2: reminders "Outstanding" card shows ${OUT} (bug: 3,500 = gross list sum)`, near(remNum, OUT), 'rem-out=' + remOut);

    // ── Root 3: accountant portal (fixed by L10 at 1e72aa2 — RED on 470dce2) ──
    const acc = new HarnessHttp(origin, { xff: '203.0.113.135' });
    if ((await acc.post('/api/accountants/login', { email: accEmail, password: PW })).status !== 200) throw new Error('accountant login');
    const bk = (await acc.get('/api/accountants/clients/' + userId + '/books?period=year')).json || {};
    const sOv = bk.summary ? bk.summary.overdue : undefined;
    A(`Root 3: portal books summary.overdue = ${OVD} (server arSummary; pre-L10 the field did not exist)`, sOv != null && near(sOv, OVD), 'summary.overdue=' + sOv);
    portal = await openPage(origin, acc, `/accountant-client?client=${userId}`);
    await wait(6000);
    const pd = portal.window.document;
    const sPill = (pd.getElementById('s-overdue') || {}).textContent || '';
    A(`Root 3: portal overdue pill "2 · $2,300" (bug pre-L10: "1 · $1,500" — literal status, gross amount)`, /^\s*2\b/.test(sPill) && amounts(sPill).some(v => near(v, OVD)), 's-overdue=' + sPill);
    if (typeof portal.window.showSection === 'function') { try { portal.window.showSection('invoices'); } catch (_) {} await wait(1500); }
    const invOv = (pd.getElementById('inv-overdue') || {}).textContent || '';
    A('Root 3: portal Invoices "Overdue" card $2,300', amounts(invOv).some(v => near(v, OVD)), 'inv-overdue=' + invOv);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (portal) { try { portal.window.close(); } catch (_) {} }
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (AR overdue netting)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
