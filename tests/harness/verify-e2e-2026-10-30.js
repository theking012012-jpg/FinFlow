'use strict';
/**
 * verify-e2e-2026-10-30 — the fixes for the full end-to-end test of 2026-10-30 (COWORK_TEST_SCRIPT.md run on the live
 * app), executed in a real browser on the real /app against the real server and a real scratch Postgres (Rule 3).
 *
 *   E2E-1  An invoice can be saved as a DRAFT and issued later. The form offered only Unpaid / Paid, so the script's
 *          "leave as draft" invoice (Cedar LLC, 9,000) was issued and counted everywhere.
 *          Seed: Delta 1,200 issued + Cedar 9,000 saved through the form as a draft.
 *          Revenue (year): correct 1,200 — bug 10,200. After "Issue": 10,200.
 *   E2E-2  A refused change in a locked period says which dates are locked and what to do. It said "Period is locked."
 *          Seed: a paid September 2026 run, books locked through 2026-09-30, Void pressed in the UI.
 *   E2E-3  Payroll cards: the second card shows the latest run and its status (it was a hard-coded "—"); the Run Payroll
 *          form says when its month already has a run (live → held; voided → "replaces the voided run").
 *   E2E-4  Personal categories: a bank line's provider code reads as the app's category; the breakdown shows the
 *          person's own categories. Seed (stored as a bank feed stores them): Groceries 320 · FOOD_AND_DRINK 50 ·
 *          FOOD_AND_DRINK 25 · TRANSFER_OUT 500. Correct breakdown: Groceries 320, Dining out 75 (transfer not spending).
 *          Bug: "Food" 320 + "Other" 75 (the codes fold into Other) — the categories never shown by name.
 *   E2E-5  The dashboard Investments card has one format whichever writer paints it (it flipped "$2,610" → "$2.6K").
 *   E2E-6  The sign-in screen makes no data request: zero 401s / red console lines signed out (bug: one per boot
 *          loader), and signing in through the form still loads the business.
 */
const { runBrowser } = require('./browserKit.js');
const FC = require('../../public/finflow-categories.js');

runBrowser('E2E 2026-10-30 fixes — draft invoices · lock refusal · payroll cards · personal categories · investments card · sign-in 401s', async ({ open, A, eq, J, http, c, uid, base }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const year = async () => (await J('GET', '/api/reports?period=year'));

  // ── E2E-6 first: a fresh browser with NO session ───────────────────────────────────────────────────────────────
  {
    const { chromium } = require('playwright');
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [], s401 = [];
    // (a request the sandbox cannot make at all — an outside font / CDN host — is not the app's: net::ERR_TUNNEL…)
    page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(m.text())) errs.push(m.text()); });
    page.on('response', r => { if (r.status() === 401) s401.push(r.url().replace(base, '')); });
    await page.goto(base + '/app', { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    const loginShown = await page.evaluate(() => { const el = document.getElementById('login-screen'); return !!el && getComputedStyle(el).display !== 'none'; });
    A('E2E-6 signed out: the sign-in screen shows', loginShown);
    eq('E2E-6 signed out: 401 responses on load', s401.length, 0, '≈38 (one per boot loader)');
    if (s401.length) console.log('        first 401s:', s401.slice(0, 8).join(' '));
    eq('E2E-6 signed out: red console lines on load', errs.length, 0, '≈38');
    if (errs.length) console.log('        first errors:', errs.slice(0, 5).join(' | '));
    // sign in through the form — the gate must open and the app must load the business
    const email = (await c.query('SELECT data->>\'email\' AS e FROM users WHERE id=$1', [uid])).rows[0].e;
    await page.fill('#login-email', email);
    await page.fill('#login-pw', 'browser-kit-pw-not-a-secret');
    await page.evaluate(() => window.doLogin());
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => ({ ent: ((window.ENTITIES || []).find(e => e.active) || {}).name || null, rev: (document.getElementById('d-rev') || {}).textContent }));
    eq('E2E-6 after signing in through the form: the active business loads', after.ent, 'Layout Co');
    A('E2E-6 after signing in: the Revenue card is filled (not "—" / "…")', after.rev && !/^(—|…)$/.test(after.rev.trim()), 'rev=' + after.rev);
    await b.close();
  }

  // ── seed (API as the owner) ────────────────────────────────────────────────────────────────────────────────────
  await J('POST', '/api/invoices', { client: 'Delta Co', amount: 1200, issue_date: '2026-10-01', due_date: '2026-10-31', status: 'pending', idempotency_key: 'e2e-delta' });
  await J('POST', '/api/holdings', { ticker: 'MSFT', shares: 5, cost_per: 300, price: 522, scope: 'business' });
  await J('POST', '/api/payroll', { fname: 'Jordan', lname: 'Lee', gross: 3000, type: 'Full-time', deductions: [] });
  const run = await J('POST', '/api/payroll-runs', { period: 'September 2026', run_date: '2026-10-29', idempotency_key: 'e2e-run',
    lines: [{ employee_name: 'Jordan Lee', gross: 3000, bonus: 0, overtime: 0, payroll_id: null }] });
  await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
  await J('PUT', '/api/payroll-runs/' + run.id + '/mark-paid', {});
  const pt = (category, amount, tx_type, d) => c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
    [uid, { description: 'seed ' + category, category, amount, tx_type, tx_date: d, currency: 'USD', source: 'banking' }]);
  await pt('Groceries', 320, 'expense', '2026-10-04');
  await pt('FOOD_AND_DRINK', 50, 'debit', '2026-10-05');
  await pt('FOOD_AND_DRINK', 25, 'debit', '2026-10-06');
  await pt('TRANSFER_OUT', 500, 'debit', '2026-10-07');

  const page = await open({ width: 1280, height: 900 });
  const toasts = [];
  await page.exposeFunction('__toast', t => toasts.push(t));
  await page.evaluate(() => { const o = window.notify; window.notify = function (m, e) { try { window.__toast(String(m)); } catch (_) {} return o && o.apply(this, arguments); }; });

  // ── E2E-1 draft invoice through the form ──────────────────────────────────────────────────────────────────────
  {
    await page.evaluate(() => { showPage('invoices'); openInvoiceModal(); });
    await wait(400);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#inv-status option')].map(o => o.value));
    A('E2E-1 the invoice form offers Draft', opts.includes('draft'), JSON.stringify(opts));
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('inv-client', 'Cedar LLC'); set('inv-amount', '9000'); set('inv-issue', '2026-09-01'); set('inv-due', '2026-10-01'); set('inv-status', 'draft');
    });
    await page.evaluate(() => window.saveInvoice());
    await wait(1500);
    const rows = await J('GET', '/api/invoices');
    const cedar = rows.find(r => r.client === 'Cedar LLC');
    eq('E2E-1 Cedar is stored as a draft', cedar && cedar.status, 'draft', 'pending');
    eq('E2E-1 revenue (year) leaves the draft out', Number((await year()).revenue), 1200, 10200);
    await page.evaluate(() => renderInvoices());
    const ui = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#invoice-list .table-row')].find(r => /Cedar LLC/.test(r.textContent));
      return row ? { badge: (row.querySelector('.badge.b-grey') || {}).textContent || null, issue: !!(row.querySelector('[data-on-click^="issueInvoice"]')), pay: /Record Payment/.test(row.textContent) } : null;
    });
    eq('E2E-1 the list shows the draft with an Issue button and no Record Payment', ui, { badge: 'draft', issue: true, pay: false });
    await page.evaluate(() => { const i = (window.userInvoices || []).findIndex(x => x.client === 'Cedar LLC'); return window.issueInvoice(i); });
    await wait(1500);
    eq('E2E-1 after Issue: Cedar is issued', (await J('GET', '/api/invoices')).find(r => r.client === 'Cedar LLC').status, 'pending');
    eq('E2E-1 after Issue: revenue (year) counts it', Number((await year()).revenue), 10200, 1200);
  }

  // ── E2E-3 payroll cards + E2E-2 the lock refusal on Void ─────────────────────────────────────────────────────
  {
    await page.evaluate(() => { showPage('payroll'); return loadPayrollRuns(); });
    await wait(800);
    const card = await page.evaluate(() => ({ v: document.getElementById('pr-last-run')?.textContent, s: document.getElementById('pr-last-run-sub')?.textContent }));
    eq('E2E-3 last-run card (paid run)', card, { v: 'September 2026', s: 'paid · gross $3,000' });
    // Run Payroll for September while a live run exists → held, named
    await page.evaluate(() => { openRunPayrollModal(); const i = document.getElementById('prm-period'); i.value = '2026-09'; _prmPeriodHint(); });
    const held = await page.evaluate(() => ({ hint: document.getElementById('prm-period-hint').textContent, disabled: document.querySelector('#run-payroll-modal .btn-primary').disabled }));
    A('E2E-3 Run Payroll for a month with a live run: held, run named', held.disabled && /already has a payroll run \(#\d+, paid\)/.test(held.hint), JSON.stringify(held));
    await page.evaluate(() => { const i = document.getElementById('prm-period'); i.value = '2026-08'; _prmPeriodHint(); });
    eq('E2E-3 another month: the button is free again', await page.evaluate(() => document.querySelector('#run-payroll-modal .btn-primary').disabled), false);
    await page.evaluate(() => closeModal('run-payroll-modal'));

    await J('POST', '/api/lock-settings', { enabled: true, lock_date: '2026-09-30' });
    toasts.length = 0;
    await page.evaluate(() => { window._confirmModal = async () => true; return voidPayrollRun(Number(document.querySelector('[data-on-click^="voidPayrollRun"]').dataset.argId)); });
    await wait(1000);
    const lockMsg = toasts.find(t => /lock/i.test(t)) || toasts.join(' | ');
    A('E2E-2 Void in a locked month is refused with the lock date, the record date and the way out',
      /locked through Sep 30 2026/.test(lockMsg) && /dated Sep 1 2026/.test(lockMsg) && /Transaction Locking/.test(lockMsg), 'toast: ' + lockMsg + '  (bug: "⚠ Period is locked.")');
    eq('E2E-2 the run is still paid', (await J('GET', '/api/payroll-runs')).find(r => r.id === run.id).status, 'paid');

    await J('POST', '/api/lock-settings', { enabled: false, lock_date: null });
    await page.evaluate(() => voidPayrollRun(Number(document.querySelector('[data-on-click^="voidPayrollRun"]').dataset.argId)));
    await wait(1200);
    const card2 = await page.evaluate(() => ({ v: document.getElementById('pr-last-run')?.textContent, s: document.getElementById('pr-last-run-sub')?.textContent }));
    eq('E2E-3 last-run card after the void', card2, { v: 'September 2026', s: 'voided · not in your books' });
    await page.evaluate(() => { openRunPayrollModal(); const i = document.getElementById('prm-period'); i.value = '2026-09'; _prmPeriodHint(); });
    const rep = await page.evaluate(() => ({ hint: document.getElementById('prm-period-hint').textContent, disabled: document.querySelector('#run-payroll-modal .btn-primary').disabled }));
    A('E2E-3 Run Payroll for the voided month: allowed, says it replaces the voided run', !rep.disabled && new RegExp('replaces the voided run #' + run.id).test(rep.hint), JSON.stringify(rep));
    await page.evaluate(() => closeModal('run-payroll-modal'));
    const labels = await page.evaluate(() => [...document.querySelectorAll('#page-payroll .mc-label')].map(e => e.textContent));
    eq('E2E-3 roster cards say they are the plan', labels, ['Monthly payroll (roster)', 'Last payroll run', 'Deductions (roster)', 'Your net pay']);
  }

  // ── E2E-4 personal categories ────────────────────────────────────────────────────────────────────────────────
  {
    await page.evaluate(async () => { showPage('personal'); await window.loadPersonalFinance(); setPersPeriod('year'); });
    await wait(800);
    const bars = await page.evaluate(() => [...document.querySelectorAll('#spending-bars .bar-row')].map(r => r.querySelector('.bar-label').textContent + '=' + r.querySelector('.bar-val').textContent));
    eq('E2E-4 spending breakdown: the categories by their own names', bars, ['Groceries=$320', 'Dining out=$75'], ['Food=$320', 'Other=$75']);
    const listCats = await page.evaluate(() => (window._allPersTxs || []).map(t => t.cat).sort());
    eq('E2E-4 transaction list: no provider code on screen', listCats, ['Dining out', 'Dining out', 'Groceries', 'Transfer'], ['FOOD_AND_DRINK', 'FOOD_AND_DRINK', 'Groceries', 'TRANSFER_OUT']);
    // the one mapper the server applies when a bank line is written (executed values)
    eq('E2E-4 personalCategory(Plaid primary)', ['FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'TRANSPORTATION', 'BANK_FEES', 'LOAN_PAYMENTS', 'RENT_AND_UTILITIES', 'SOME_NEW_CODE'].map(x => FC.personalCategory(x)),
      ['Dining out', 'Shopping', 'Transport', 'Fees & charges', 'Transfer', 'Utilities', 'Some new code']);
    eq('E2E-4 personalCategory(detailed refines)', [FC.personalCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'), FC.personalCategory('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT'), FC.personalCategory('INCOME', 'INCOME_WAGES')],
      ['Groceries', 'Rent/Mortgage', 'Salary']);
    eq('E2E-4 personalCategory keeps the person\'s own names', ['Groceries', 'Healthcare', 'My hobby', 'Uncategorized', ''].map(x => FC.personalCategory(x)), ['Groceries', 'Healthcare', 'My hobby', 'Other', 'Other']);
    eq('E2E-4 a mapped transfer is still a transfer (not spending)', require('../../public/finflow-dates.js').personalTxKind({ category: FC.personalCategory('TRANSFER_OUT'), tx_type: 'expense' }), 'transfer');
  }

  // ── E2E-5 investments card: one format ──────────────────────────────────────────────────────────────────────
  {
    await page.evaluate(() => { showPage('dashboard'); });
    await wait(1500);
    const r = await page.evaluate(() => {
      const el = document.getElementById('d-invest'); const overlay = el.textContent;
      window._refreshDashboardUI && window._refreshDashboardUI();   // the dashboard wiring paints the card again
      return { overlay, wiring: el.textContent, abbr: window._fmtMoneyAbbr(5 * 522) };
    });
    eq('E2E-5 Investments card: same text from both writers', r.wiring, r.overlay, '$2,610 vs $2.6K');
    eq('E2E-5 Investments card: the abbreviated value of 5 × 522', r.wiring, r.abbr);
  }
}, { entities: [{ name: 'Layout Co', currency: 'USD', country: 'US', timezone: 'UTC' }] });
