'use strict';
/**
 * verify-calendar-dates-tz.js — Phase 1.1 / L8 + L11 (Rule 10 class, F87): an accounting date is a CALENDAR
 * date. Four client surfaces still turned 'YYYY-MM-DD' into a Date instant (new Date(d) = UTC midnight) and
 * compared / displayed it in the VIEWER's timezone:
 *   L8  Bills · "Due This Week"          new Date(b.due_date) vs a local-midnight Date      → wrong sum
 *   L11 accountant portal getFiltered()  new Date(d) + local getMonth(), calendar quarters,
 *                                        invoices filtered by DUE date (server recognises by ISSUE date),
 *                                        'year' = every record (server: the fiscal-year window)
 *       accountant portal fmtDate()      new Date('2026-08-30').toLocaleDateString()       → "Aug 29" west of UTC
 *       personal finance period filter   new Date(t.date) vs local-midnight month start    → a row dated the
 *                                                                                           1st drops out
 *       period-lock display (toggleLocking) new Date('2026-03-31').toLocaleDateString()     → "March 30" west of UTC
 *
 * RULE 10 TESTING COROLLARY: the matrix spans the SIGN boundary — the probe re-runs itself (HARNESS_TZ, the
 * zone clock.js applies) under
 * America/New_York (UTC−4) and Asia/Tokyo (UTC+9). Clock pinned 2026-07-25T16:00Z ⇒ the calendar today the
 * client resolves is 2026-07-25 (resolvedToday), even though Tokyo's wall clock already reads Jul 26.
 *
 * Seed (hand-computed expectations):
 *   bills due 07-24 (8, overdue) · 07-25 (1) · 08-01 (2) · 08-02 (4) · 07-28 (5, 2 paid ⇒ balance 3)
 *     ⇒ Due This Week [07-25 … 08-01] = 1 + 2 + 3 = 6   (bug: 7 = face amounts minus the bill due today;
 *        the balance — not the face amount — is what is still due, as the Overdue card beside it uses)
 *   invoice issued 2026-07-01, due 2026-08-30 ⇒ in the portal's MONTH (July) list; due shows "Aug 30, 2026"
 *   personal expenses dated 2026-07-01 (7) and 2026-06-30 (3) ⇒ the July month view holds the 7 only
 *   lock date 2026-03-31 ⇒ "March 31, 2026"
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-calendar-dates-tz.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (!process.env.FF_TZ_CHILD) {
  // ── parent: run the whole probe once per timezone, across the sign boundary ──
  let fails = 0, passes = 0;
  for (const tz of ['America/New_York', 'Asia/Tokyo']) {
    const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'clock.js'), __filename], {
      env: Object.assign({}, process.env, { HARNESS_TZ: tz, TZ: tz, FF_TZ_CHILD: tz }), encoding: 'utf8', timeout: 380000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    process.stdout.write(out.split('\n').filter(l => /PASS|FAIL|FATAL|^\s{8,}|^=+|TZ /.test(l)).join('\n') + '\n');
    const m = out.match(/TZRESULT (\d+) (\d+)/);
    if (!m) { fails++; console.log('  FAIL  ' + tz + ' child produced no result (exit ' + r.status + ')'); continue; }
    passes += +m[1]; fails += +m[2];
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fails ? ('  ' + fails + ' FAILED — ' + passes + ' passed, ' + fails + ' failed') : ('  ALL GREEN — ' + passes + ' passed, 0 failed  (calendar dates, NY + Tokyo)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fails ? 1 : 0);
}

// ── child: one timezone ──
require('./clock.js');
const bcrypt = require('bcryptjs');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const { HarnessHttp } = require('./httpClient.js');
const TZ = process.env.FF_TZ_CHILD;
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  [' + TZ + '] ' + n)) : (fail++, console.log('  FAIL  [' + TZ + '] ' + n + (d ? '\n          ' + d : ''))); };
const money = s => { const m = String(s == null ? '' : s).replace(/[,\s]/g, '').match(/(-?)[^\d-]*(-?\d+(?:\.\d+)?)/); return m ? (m[1] === '-' ? -1 : 1) * parseFloat(m[2]) : NaN; };
const PW = 'harness-password-not-a-secret';

async function seed({ http }) {
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
  const ent = J(await http.post('/api/entities', { name: 'TZ Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
  J(await http.post('/api/entities/' + ent.id + '/activate', {}));
  for (const [due, amt] of [['2026-07-24', 8], ['2026-07-25', 1], ['2026-08-01', 2], ['2026-08-02', 4]])
    J(await http.post('/api/bills', { vendor: 'V' + amt, amount: amt, status: 'unpaid', issue_date: '2026-07-01', due_date: due }));
  const part = J(await http.post('/api/bills', { vendor: 'Part', amount: 5, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-28' }));
  J(await http.post('/api/payments-made', { vendor: 'Part', amount: 2, date: '2026-07-10', method: 'bank', bill_id: part.id }));
  J(await http.post('/api/invoices', { client: 'JulyCo', amount: 11, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-30' }));
  J(await http.post('/api/personal-transactions', { description: 'Groceries Jul 1', category: 'Groceries', amount: 7, tx_type: 'expense', tx_date: '2026-07-01', currency: 'USD' }));
  J(await http.post('/api/personal-transactions', { description: 'Groceries Jun 30', category: 'Groceries', amount: 3, tx_type: 'expense', tx_date: '2026-06-30', currency: 'USD' }));
}

(async () => {
  let ctx, pdom;
  try {
    console.log('\n' + '='.repeat(78) + '\n  TZ ' + TZ + ' — calendar dates compared and shown as calendar dates\n' + '='.repeat(78));
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, settle, client: c, userId, origin } = ctx;
    await settle(60, 100);

    // L8 — Bills · Due This Week
    w.showPage('bills'); await settle(25, 100);
    const card = [...w.document.querySelectorAll('#page-bills .mc')].find(m => /Due This Week/.test(m.textContent));
    A('Bills · Due This Week == 6 (07-25 + 08-01 + balance of 07-28; bug: 7)', card && Math.abs(money(card.querySelector('.mc-val').textContent) - 6) < 0.01, card && card.textContent.replace(/\s+/g, ' '));

    // period-lock display
    w.document.getElementById('lock-enabled').checked = true;
    w.document.getElementById('lock-date').value = '2026-03-31';
    w.toggleLocking();
    A('lock date 2026-03-31 shows "March 31, 2026" (bug west of UTC: March 30)', /March 31, 2026/.test(w.document.getElementById('lock-date-display').textContent), w.document.getElementById('lock-date-display').textContent);

    // personal finance — month view
    w.showPage('personal'); await settle(25, 100);
    w._persPeriod = 'month'; w.eval('_applyPersFilter()'); await settle(3, 100);
    const ptx = w.eval('Array.from(persTransactions||[]).map(t=>t.date)');
    A('personal month view holds the 2026-07-01 row (bug west of UTC: dropped)', ptx.includes('2026-07-01'), JSON.stringify(ptx));
    A('personal month view excludes the 2026-06-30 row', !ptx.includes('2026-06-30'), JSON.stringify(ptx));

    // L11 — accountant portal, Month period
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ($1,$2,'Acc','TZ','Firm','CODETZ','verified') RETURNING id`, ['tz-acc@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, userId]);
    const acc = new HarnessHttp(origin, { xff: '203.0.113.97' });
    if ((await acc.post('/api/accountants/login', { email: 'tz-acc@finflow.test', password: PW })).status !== 200) throw new Error('accountant login');
    const cookiePair = [...acc.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const htmlRes = await acc.get(`/accountant-client?client=${userId}`);
    const jar = new CookieJar();
    for (const [k, v] of acc.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, origin);
    pdom = new JSDOM(htmlRes.text, { url: `${origin}/accountant-client?client=${userId}`, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
    const pw = pdom.window;
    pw.Date = (function () { const P = require('./clock.js').PINNED_MS; class PD extends pw.Date { constructor(...a) { if (a.length === 0) super(P); else super(...a); } static now() { return P; } } return PD; })();
    const nodeFetch = global.fetch;
    pw.fetch = (input, init = {}) => { const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const abs = url.startsWith('http') ? url : origin + (url.startsWith('/') ? url : '/' + url);
      return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) })); };
    await settle(60, 100);
    const btn = pw.document.createElement('button'); btn.dataset.period = 'month';
    await pw.setPeriod(btn); await settle(30, 100);
    const rows = [...pw.document.querySelectorAll('#all-invoices tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim());
    const jul = rows.find(r => /JulyCo/.test(r));
    A('portal Month list holds the invoice ISSUED 2026-07-01 (bug: filtered by due date / viewer month)', !!jul, JSON.stringify(rows));
    A('portal shows its due date as "Aug 30, 2026" (bug west of UTC: Aug 29)', !!jul && /Aug 30, 2026/.test(jul), jul);
  } catch (e) {
    fail++; console.log('  FATAL: [' + TZ + '] ' + (e && e.stack || e));
  } finally {
    try { if (pdom) pdom.window.close(); } catch (_) {}
    if (ctx) await ctx.stop();
  }
  console.log('TZRESULT ' + pass + ' ' + fail);
  process.exit(0);
})();
