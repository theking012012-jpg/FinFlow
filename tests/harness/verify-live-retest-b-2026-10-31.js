'use strict';
/**
 * verify-live-retest-b-2026-10-31 — the second batch the live re-test found (NEW-6 … NEW-8, NEW-10), executed in a real
 * browser on the real /app and accountant portal against the real server and a scratch Postgres (Rule 3).
 *
 * Clock: pinned (here, sweep-safe) to 2026-11-01T02:40Z = 22:40 on 31 Oct in New York; the browser runs in New York time.
 *   NEW-6  Personal's today is the PERSON's day. Seed: Groceries 320 (Oct 4) · Netflix 15.99 dated Nov 1.
 *          Year spending 320 and Month = October (bug: 335.99, and Month = November). The page saves the device zone as
 *          personal_timezone; the accountant portal's YTD uses it: expense 320.00 (bug 335.99).
 *   NEW-7  A business in another currency: with no rate the consolidated column reads "—" (bug "$0"); the account gets
 *          rates when the business is created / its FX page opens (feed stubbed: USD→TTD 6.79), then converts:
 *          8,000 TTD → 1,178.20 USD, and the FX page lists the rate (bug: "No rates yet").
 *   NEW-8  Personal converts with the server's rate: _safeFX(1000 USD → TTD) = 6,790 (bug 6,800, the built-in table).
 *   NEW-10 Wording: the accountant greeting follows the time of day (23:00 → "Good evening"; bug "Good morning"); the
 *          accountant's revenue card does not say "Paid invoices"; bank-link messages name the country; saving the owner
 *          on the roster does not claim "Personal Finance synced".
 */
{ const _Real = Object.getPrototypeOf(Date) !== Function.prototype ? Object.getPrototypeOf(Date) : Date;
  const _PIN = _Real.parse(process.env.SWEEP_PIN_ISO_B || '2026-11-01T02:40:00.000Z');
  class _Pinned extends _Real { constructor(...a) { if (!a.length) { super(_PIN); return; } super(...a); } static now() { return _PIN; } }
  global.Date = _Pinned; }
// The live rate feed, stubbed in this process (the server runs in it): off until the test turns it on.
let FEED_ON = false;
{ const _f = global.fetch;
  global.fetch = async (u, o) => {
    if (/open\.er-api\.com/.test(String(u))) {
      if (!FEED_ON) throw new Error('feed offline (harness)');
      return { ok: true, status: 200, json: async () => ({ result: 'success', rates: { USD: 1, TTD: 6.79, EUR: 0.92, GBP: 0.79 } }) };
    }
    return _f(u, o);
  }; }
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');
const { HarnessHttp } = require('./httpClient.js');

runBrowser('Live re-test (b) 2026-10-31 — NEW-6 · NEW-7 · NEW-8 · NEW-10', async ({ A, eq, J, http, c, uid, base, server }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const { chromium } = (require('./browserKit.js').loadPlaywright() || (() => { throw new Error('NOT RUN — Playwright is not installed (local or global). Install once: npm i --no-save playwright && npx playwright install chromium'); })());
  const host = new URL(base).hostname;
  const browser = await chromium.launch();
  const openNY = async (path, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' });
    if (opts.cookies) await ctx.addCookies(opts.cookies.map(([name, value]) => ({ name, value, domain: host, path: '/' })));
    const page = await ctx.newPage();
    if (opts.clock) await page.clock.setFixedTime(new Date(opts.clock));
    await page.goto(base + path, { waitUntil: 'load' }); await wait(opts.settle || 3500);
    return page;
  };
  try {
    // ── seed ────────────────────────────────────────────────────────────────────────────────────────────────────
    const ents = await J('GET', '/api/entities'); const usId = ents[0].id;
    await J('POST', '/api/personal-transactions', { description: 'Groceries', category: 'Groceries', amount: 320, tx_type: 'expense', tx_date: '2026-10-04', currency: 'USD' });
    await J('POST', '/api/personal-transactions', { description: 'Netflix', category: 'Subscriptions', amount: 15.99, tx_type: 'expense', tx_date: '2026-11-01', currency: 'USD' });
    await J('POST', '/api/personal-transactions', { description: 'Salary', category: 'Salary', amount: 1000, tx_type: 'income', tx_date: '2026-10-15', currency: 'USD' });

    // ── NEW-6: Personal, in the person's day ────────────────────────────────────────────────────────────────────
    const page = await openNY('/app', { cookies: [...http.cookies.entries()] });
    const p6 = await page.evaluate(async () => {
      showPage('personal'); await window.loadPersonalFinance(); setPersPeriod('year'); await new Promise(r => setTimeout(r, 800));
      const year = Math.round((window.spending || []).reduce((a, s) => a + s.amount, 0) * 100) / 100;
      const yearTxt = [...document.querySelectorAll('#page-personal .mc')].map(c => c.innerText).find(t => /SPENDING/i.test(t));
      setPersPeriod('month'); await new Promise(r => setTimeout(r, 500));
      return { today: window._personalToday(), tz: window._personalTz(), yearTxt: (yearTxt || '').replace(/\n/g, ' '), monthRange: _persPeriodRange(), monthTx: (persTransactions || []).map(t => t.desc).sort() };
    });
    eq('NEW-6 Personal today is the person\'s day (22:40 on 31 Oct in New York)', p6.today, '2026-10-31', '2026-11-01');
    A('NEW-6 Year spending leaves out the charge dated tomorrow', /\$320\b/.test(p6.yearTxt), p6.yearTxt + '  (bug: $336)');
    eq('NEW-6 Month is October', [p6.monthRange.from, p6.monthRange.to], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-01']);
    eq('NEW-6 Month lists October\'s rows', p6.monthTx, ['Groceries', 'Salary'], ['Netflix']);
    await wait(500);
    const st = await J('GET', '/api/settings');
    eq('NEW-6 the page saved the device zone as the person\'s timezone', st.personal_timezone, 'America/New_York');

    // accountant portal, same person
    const PW = 'lrb-acc-pw-not-a-secret';
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('lrb-acc@finflow.test', $1, 'Casey', 'Acct', 'Firm', 'LRBREF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
    A('owner grants view + personal', (await http.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [usId]: 'view' }, personal: 'view' } })).status === 200);
    const ACC = new HarnessHttp(base, { xff: '203.0.113.231' });
    A('accountant login', (await ACC.post('/api/accountants/login', { email: 'lrb-acc@finflow.test', password: PW })).status === 200);
    const pers = ((await ACC.get(`/api/accountants/clients/${uid}/books?period=year`)).json || {}).personal || {};
    eq('NEW-6 accountant portal: personal YTD expense, in the person\'s day', [pers.expense, pers.window && pers.window.to], ['320.00', '2026-10-31'], ['335.99', '2026-11-01']);

    // ── NEW-10: accountant greeting + revenue label (23:00 New York in the accountant's browser) ─────────────────
    const accPage = await openNY('/accountant', { cookies: [...ACC.cookies.entries()], clock: '2026-10-31T23:00:00-04:00' });
    const greet = await accPage.evaluate(() => (document.querySelector('h1') || {}).innerText || '');
    A('NEW-10 accountant greeting at 23:00 says evening', /^Good evening, Casey/.test(greet), JSON.stringify(greet) + '  (bug: "Good morning")');
    const cpage = await openNY(`/accountant-client?client=${uid}&name=Owner`, { cookies: [...ACC.cookies.entries()] });
    const revSub = await cpage.evaluate(() => { const c = [...document.querySelectorAll('.metric-card')].find(x => /Total Revenue/i.test(x.innerText)); return c ? c.querySelector('.mc-sub').textContent : null; });
    A('NEW-10 the accountant\'s revenue card does not say "Paid invoices"', revSub && !/Paid invoices/.test(revSub), JSON.stringify(revSub));
    await accPage.context().close(); await cpage.context().close();

    // ── NEW-7: a second business in TTD, the feed offline → no rate ─────────────────────────────────────────────
    const tt = await J('POST', '/api/entities', { name: 'Island QA', currency: 'TTD', country: 'TT' });
    eq('no rate yet (the feed is offline)', (await c.query(`SELECT count(*)::int n FROM fx_rates WHERE user_id=$1`, [uid])).rows[0].n, 0);
    await J('POST', '/api/entities/' + tt.id + '/activate', {});
    await J('POST', '/api/invoices', { client: 'Harbour Ltd', amount: 8000, issue_date: '2026-09-12', due_date: '2026-10-31', status: 'pending', idempotency_key: 'lrb-h' });
    await J('POST', '/api/entities/' + usId + '/activate', {});
    const consol = async () => page.evaluate(async () => {
      await window.loadEntitiesFromDB(true); showPage('entities'); await new Promise(r => setTimeout(r, 300));
      window.consolCurrency = 'USD'; if (typeof window.renderEntities === 'function') window.renderEntities();
      await new Promise(r => setTimeout(r, 2500));
      const hdr = [...document.querySelectorAll('#consol-pl-header span')].map(s => s.textContent);
      const rev = [...document.querySelectorAll('#consol-pl > div')][0]; const cells = rev ? [...rev.querySelectorAll('span')].map(s => s.textContent) : [];
      const i = hdr.indexOf('Island QA'); return { hdr, cell: i >= 0 ? cells[i] : null, title: i >= 0 && rev ? rev.querySelectorAll('span')[i].getAttribute('title') : null };
    });
    let cc = await consol();
    eq('NEW-7 with no rate, the Island QA column reads "—" (not $0)', cc.cell, '—', '$0');
    A('NEW-7 …and names the missing rate', /No TTD→USD rate yet/.test(cc.title || ''), JSON.stringify(cc.title));

    // the feed comes back; opening the FX page gives the account its rates
    FEED_ON = true;
    const fx = await J('GET', '/api/fx-rates');
    const ttd = fx.find(r => r.from_currency === 'USD' && r.to_currency === 'TTD');
    eq('NEW-7 the FX page lists the live USD→TTD rate (bug: "No rates yet")', ttd && Number(ttd.rate), 6.79, null);
    const rep = await J('GET', '/api/reports?entity_id=' + tt.id + '&display=USD');
    eq('NEW-7 Island QA converts: 8,000 TTD at 6.79 → 1,178.20 USD', Math.round(rep.revenue * 100) / 100, 1178.2, 0);
    cc = await consol();
    A('NEW-7 the column now shows the converted figure', /^\$1(\.2K|,178)/.test(cc.cell || ''), JSON.stringify(cc.cell));

    // a business created while the feed is up gets its rates at once
    await c.query(`DELETE FROM fx_rates WHERE user_id=$1`, [uid]);
    await J('POST', '/api/entities', { name: 'Euro QA', currency: 'EUR', country: 'DE' });
    eq('NEW-7 creating a business gives the account today\'s rates', (await c.query(`SELECT count(*)::int n FROM fx_rates WHERE user_id=$1 AND source='live'`, [uid])).rows[0].n, 3, 0);

    // ── NEW-8: Personal converts with the server's rate ─────────────────────────────────────────────────────────
    const p8 = await page.evaluate(async () => { await window._ffApplyLiveRates(); return window._safeFX(1000, 'USD', 'TTD'); });
    eq('NEW-8 _safeFX(1,000 USD → TTD) uses the live rate', Math.round(p8 * 100) / 100, 6790, 6800);

    // ── NEW-10: bank-link wording + the roster toast ────────────────────────────────────────────────────────────
    const toasts = await page.evaluate(async () => {
      const out = []; const o = window.notify; window.notify = function (m) { out.push(String(m)); return o && o.apply(this, arguments); };
      await window.ffBankLinkForCountry('TT', 'personal', () => {});
      showPage('payroll'); await new Promise(r => setTimeout(r, 800));
      const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('payroll-cta-fname', 'Owner'); set('payroll-cta-lname', 'QA'); set('payroll-cta-gross', '5000');
      if (typeof saveOwnerPayrollCard === 'function') await saveOwnerPayrollCard();
      await new Promise(r => setTimeout(r, 1500)); window.notify = o; return out;
    });
    A('NEW-10 bank-link message names the country, not its code', toasts.some(t => /for Trinidad (&|and) Tobago/.test(t)) && !toasts.some(t => /for TT\b/.test(t)), JSON.stringify(toasts[0]));
    A('NEW-10 saving yourself on the roster does not claim "Personal Finance synced"', toasts.some(t => /Payroll saved/.test(t)) && !toasts.some(t => /Personal Finance synced/.test(t)), JSON.stringify(toasts.filter(t => /Payroll/.test(t))));
  } finally { try { await browser.close(); } catch (_) {} }
}, { entities: [{ name: 'Northwind QA', currency: 'USD', country: 'US', timezone: 'America/New_York' }] });
