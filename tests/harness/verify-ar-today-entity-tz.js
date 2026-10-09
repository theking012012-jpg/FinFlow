'use strict';
/**
 * verify-ar-today-entity-tz.js — L36 (FIX_PLAN_OPEN_DIVERGENCES.md). An accounting "today" is the ENTITY's calendar
 * day (Rule 10): the server resolves every AR / overdue / D2 / period boundary with entityTodayYmd, but the client
 * called FinFlowDates.resolvedToday(new Date()) with NO zone (= the UTC day), and the accountant portal compared
 * due dates against new Date().toISOString() (UTC). For a business far from UTC, near midnight the two disagree on
 * which invoices are overdue, which are issued, and which bills are past due.
 *
 * Asia/Tokyo business; clock pinned 2026-07-25T16:00Z = 2026-07-26 01:00 in Tokyo. Seed (distinct amounts — Rule 4):
 *   INV-Y   700  issued 07-01, due 07-25 (yesterday in Tokyo)  ⇒ OVERDUE on the entity day; not on the UTC day
 *   INV-T   450  issued 07-26 (today in Tokyo), due 08-26      ⇒ ISSUED on the entity day; "future" (D2) on UTC
 *   BILL    230  issued 07-01, due 07-25, unpaid               ⇒ past due on the entity day; not on UTC
 * HAND-COMPUTED on the entity day 2026-07-26:  outstanding 1,150 · overdue 700 (1 invoice) · billed 1,150 ·
 *   bills overdue 230.   BUGGY (UTC day 2026-07-25): outstanding 700 · overdue 0 · billed 700 · bills overdue 0 ·
 *   portal overdue count 0.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-ar-today-entity-tz.js
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
const amounts = t => (String(t || '').match(/\$\s?-?[\d,]+(?:\.\d+)?/g) || []).map(s => parseFloat(s.replace(/[^\d.\-]/g, '')));
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

(async () => {
  let ctx, portal;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L36 — client AR / D2 / overdue "today" is the ENTITY\'s day (Tokyo, UTC+9)\n' + '='.repeat(78) + '\n');
    const accEmail = 'l36-acc@finflow.test';
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client: c, userId }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'Tokyo KK', currency: 'USD', timezone: 'Asia/Tokyo', country: 'JP' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/invoices', { client: 'Yesterday Co', amount: 700, status: 'pending', issue_date: '2026-07-01', due_date: '2026-07-25' });
      await J('/api/invoices', { client: 'Today Co', amount: 450, status: 'pending', issue_date: '2026-07-26', due_date: '2026-08-26' });
      await J('/api/bills', { vendor: 'Tokyo Gas', amount: 230, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-25' });
      const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
         VALUES ($1,$2,'Acc','L36','Firm','CODEL36','verified') RETURNING id`, [accEmail, bcrypt.hashSync(PW, 10)])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, userId]);
    } });
    const { window: w, settle, http, userId, origin } = ctx;
    await settle(60, 100);

    // premises
    A('premise: the active entity zone is Asia/Tokyo on the client', w._activeEntityTz() === 'Asia/Tokyo', 'tz=' + w._activeEntityTz());
    A('premise: UTC day 2026-07-25, entity day 2026-07-26', w.FinFlowDates.resolvedToday(new Date()) === '2026-07-25' && w.FinFlowDates.resolvedToday(new Date(), 'Asia/Tokyo') === '2026-07-26');

    // server (already entity-day)
    const rep = (await http.get('/api/reports?period=year&fyStart=0')).json || {};
    A('server /api/reports: outstanding 1,150 · overdue 700 (entity day)', near(rep.outstanding, 1150) && near(rep.overdue, 700), JSON.stringify({ outstanding: rep.outstanding, overdue: rep.overdue }));

    // client AR (arOutstanding — app-main.js)
    const ar = w._arOutstanding(w._realInvoices || []);
    A('client arOutstanding: total 1,150 (bug: 700 — the invoice issued "today" in Tokyo treated as future)', near(ar.total, 1150), JSON.stringify(ar));
    A('client arOutstanding: overdue 700 · 1 invoice (bug: 0 — due "yesterday" in Tokyo is "today" in UTC)', near(ar.overdueTotal, 700) && ar.overdueCount === 1, JSON.stringify(ar));
    A('client == server (overdue and outstanding)', near(ar.overdueTotal, rep.overdue) && near(ar.total, rep.outstanding), JSON.stringify({ client: ar, server: { o: rep.outstanding, ov: rep.overdue } }));

    // rendered surfaces
    w.showPage('invoices'); await settle(20, 100);
    if (typeof w.updateInvoices === 'function') { try { w.updateInvoices(); } catch (_) {} await settle(10, 100); }
    const billed = (w.document.getElementById('inv-billed') || {}).textContent || '';
    const over = (w.document.getElementById('inv-over') || {}).textContent || '';
    A('Invoices page: Billed $1,150 (D2 on the entity day; bug: $700)', amounts(billed).some(v => near(v, 1150)), 'inv-billed=' + billed);
    A('Invoices page: Overdue $700 (bug: $0)', amounts(over).some(v => near(v, 700)), 'inv-over=' + over);
    // L44: bills "Overdue" is now the server's canonical AP overdue (computeBooks.apSummary, entity-day `today`) — the
    // client helper _billsOverdueSum it used to call was removed. Same property: past due on the ENTITY's day.
    const _bsT = (await http.post('/api/reports/balance-sheet', {})).json || {};
    const bo2 = _bsT.apSummary ? Number(_bsT.apSummary.overdueTotal) : NaN;
    A('Bills: past-due sum 230 on the entity day (bug: 0)', near(bo2, 230), 'apSummary.overdueTotal=' + bo2);

    // accountant portal — overdue list/count on the entity day
    const acc = new HarnessHttp(origin, { xff: '203.0.113.136' });
    if ((await acc.post('/api/accountants/login', { email: accEmail, password: PW })).status !== 200) throw new Error('accountant login');
    portal = await openPage(origin, acc, `/accountant-client?client=${userId}`);
    await wait(6000);
    const pill = (portal.window.document.getElementById('s-overdue') || {}).textContent || '';
    A('portal overdue pill "1 · $700" (bug: "0 · $700" — count from the UTC day, amount from the server)', /^\s*1\b/.test(pill) && amounts(pill).some(v => near(v, 700)), 's-overdue=' + pill);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (portal) { try { portal.window.close(); } catch (_) {} }
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (AR today = entity day)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
