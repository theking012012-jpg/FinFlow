'use strict';
/**
 * verify-f90b-history-panel — F90 part 2. Every record shows its History in plain words: who, when (in the BUSINESS's
 * time zone), what changed (old → new, per field), and how (by hand, by an API key, automatically, straight in the
 * database). Documents show it under the document (never printed); records with no document (expenses, payroll runs,
 * journals) have a History button.
 *
 * BUG: History existed for invoices and bills only, showed 8 hard-coded fields, a date without a time, nothing about
 * how a change was made, and nothing at all for payments, quotes, receipts, credit notes, vendor credits, expenses,
 * payroll runs or journals.
 *
 * Executed: the real /app in Chromium against the real server + scratch Postgres (Rule 3). The business is in
 * Asia/Tokyo (UTC+9) so a time shown in the viewer's zone or UTC is visibly wrong (Rule 10 sign corollary).
 * Seed through the real routes: invoice 1,200 → edited to 1,250 → paid 400; expense 80 → edited to 95; a payroll run
 * created then approved; a journal; a credit note; a quote; an invoice raised by the recurring job; a direct
 * database edit of the quote.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90b-history-panel.js
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('F90 part 2 — every record shows its History', async ({ open, A, eq, J, c, uid, server }) => {
  await c.query(`UPDATE users SET data = data || '{"name":"Avery Owner"}'::jsonb WHERE id = $1`, [uid]);
  const ent = (await c.query(`SELECT id FROM entities WHERE user_id = $1 ORDER BY id LIMIT 1`, [uid])).rows[0];
  await c.query(`UPDATE entities SET data = data || '{"timezone":"Asia/Tokyo"}'::jsonb WHERE id = $1`, [ent.id]);

  const inv = await J('POST', '/api/invoices', { client: 'Pier Co', amount: 1200, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01' });
  await J('PUT', '/api/invoices/' + inv.id, { amount: 1250 });
  await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 400, payment_date: '2026-07-10', method: 'Bank' });
  const exp = await J('POST', '/api/expenses', { description: 'Harbour fuel', category: 'Travel', amount: 80, expense_date: '2026-07-11', idempotency_key: 'f90b-e' });
  await J('PUT', '/api/expenses/' + exp.id, { amount: 95 });
  const cn = await J('POST', '/api/credit-notes', { customer: 'Pier Co', amount: 50, date: '2026-07-14', status: 'Open' });
  const q = await J('POST', '/api/quotes', { client: 'Pier Co', amount: 600, expiry_date: '2026-09-30' });
  await c.query(`UPDATE quotes SET data = data || '{"amount": 650}'::jsonb WHERE id = $1`, [q.id]);   // outside the app
  await J('POST', '/api/recurring-invoices', { client: 'Monthly Co', amount: 80, frequency: 'Monthly', next_run: '2026-07-01' });
  await require('../../server.js')._jobs.recurring();
  const recInv = (await c.query(`SELECT id FROM invoices WHERE user_id = $1 AND data->>'client' = 'Monthly Co' ORDER BY id DESC LIMIT 1`, [uid])).rows[0];
  await J('POST', '/api/payroll', { fname: 'Sam', lname: 'Field', gross: 2000 });
  const run = await J('POST', '/api/payroll-runs', { period: 'July 2026', idempotency_key: 'f90b-run' });
  await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
  const jn = await J('POST', '/api/journals', { date: '2026-07-05', description: 'Accrual', status: 'Posted', lines: [{ code: '5000', debit: 15, credit: 0 }, { code: '1010', debit: 0, credit: 15 }], idempotency_key: 'f90b-j' });
  const ch = (await c.query(`SELECT changed_at FROM audit_trail WHERE table_name = 'invoices' AND record_id = $1 AND action = 'CREATE'`, [inv.id])).rows[0].changed_at;
  const tokyo = (() => { const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ch)).forEach(x => { p[x.type] = x.value; }); return p.day + ' ' + p.month + ' ' + p.year + ', ' + p.hour + ':' + p.minute; })();

  const page = await open({ width: 1280, height: 900 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.waitForTimeout(3000);
  const histOfDoc = async (fn, arg) => {
    await page.evaluate(fn, arg); await page.waitForTimeout(1200);
    return page.evaluate(() => { const h = document.getElementById('ff-docview-history'); const t = h && h.style.display !== 'none' ? h.innerText : '';
      const c = document.getElementById('ff-docview-close'); if (c) c.click(); return t; });
  };
  const histOfRec = async (table, id) => {
    await page.evaluate(([t, i]) => window.ffRecordHistory(t, i, 'test'), [table, id]); await page.waitForTimeout(1200);
    return page.evaluate(() => { const t = (document.getElementById('ff-history-body') || {}).innerText || ''; const c = document.getElementById('ff-history-close'); if (c) c.click(); return t; });
  };

  // invoice — in its document view
  const viewInv = (id) => { const idx = (window.userInvoices || []).findIndex(i => (i._dbId != null ? i._dbId : i.id) === id); if (idx >= 0) window.viewInvoice(idx); };
  const ih2 = await histOfDoc(viewInv, inv.id);
  A('invoice: created by Avery Owner, at the time in the BUSINESS\'s zone (Asia/Tokyo: ' + tokyo + ')', ih2.includes(tokyo + ' · Avery Owner created'), ih2.slice(0, 300));
  A('invoice: the edit, Amount 1,200.00 → 1,250.00', /Avery Owner edited[\s\S]*Amount 1,200\.00 → 1,250\.00/.test(ih2), ih2.slice(0, 400));
  A('invoice: the payment\'s effect, Paid 0.00 → 400.00 and Status pending → partial (bug: not shown)', /Paid (—|0\.00) → 400\.00/.test(ih2) && /Status pending → partial/.test(ih2), ih2.slice(0, 500));

  // the recurring job's invoice says it was automatic
  await page.evaluate(async () => { if (typeof window.refreshFinancials === 'function') await window.refreshFinancials('invoices'); }); await page.waitForTimeout(800);
  const rh2 = await histOfDoc(viewInv, recInv.id);
  A('an invoice the recurring job raised: "FinFlow (automatic) created (automatically — recurring schedule)"', /FinFlow \(automatic\) created \(automatically — recurring schedule\)/.test(rh2), JSON.stringify(rh2.slice(0, 600)));

  // the other documents (bug: no History at all)
  await page.evaluate(() => window.showPage('quotes')); await page.waitForTimeout(1500);
  const qh2 = await histOfDoc((id) => window.viewQuote(id), q.id);
  A('quote: its History, including the change made straight in the database (Amount 600.00 → 650.00, "directly in the database, outside the app")', /Amount 600\.00 → 650\.00/.test(qh2) && /directly in the database, outside the app/.test(qh2), qh2.slice(0, 400));
  await page.evaluate(() => window.showPage('credit-notes')); await page.waitForTimeout(1500);
  const ch2 = await histOfDoc((id) => window.viewCreditNote(id), cn.id);
  A('credit note: its History (created, Amount 50.00)', /Avery Owner created/.test(ch2) && /Amount 50\.00/.test(ch2), ch2.slice(0, 300));

  // records without a document — the History window
  const eh = await histOfRec('expenses', exp.id);
  A('expense: the edit, Amount 80.00 → 95.00 (bug: no History anywhere)', /Avery Owner edited[\s\S]*Amount 80\.00 → 95\.00/.test(eh), eh.slice(0, 300));
  await page.evaluate(() => window.showPage('expenses')); await page.waitForTimeout(1500);
  const btn = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'History' && /ffRecordHistory\('expenses'/.test(b.getAttribute('data-on-click') || '')));
  A('the expenses list has a History button on each saved expense', btn);
  if (btn) {
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'History' && /ffRecordHistory\('expenses'/.test(b.getAttribute('data-on-click') || '')).click());
    await page.waitForTimeout(1200);
    const clicked = await page.evaluate(() => (document.getElementById('ff-history-body') || {}).innerText || '');
    A('…and clicking it opens that expense\'s History', /Amount 80\.00 → 95\.00/.test(clicked), clicked.slice(0, 200));
    await page.evaluate(() => { const c = document.getElementById('ff-history-close'); if (c) c.click(); });
  }
  const ph = await histOfRec('payroll_runs', run.id);
  A('payroll run: created, then "approved" by Avery Owner with Status draft → approved', /Avery Owner created/.test(ph) && /Avery Owner approved[\s\S]*Status draft → approved/.test(ph), ph.slice(0, 300));
  const jh = await histOfRec('journals', jn.id);
  A('journal: its History (created by Avery Owner)', /Avery Owner created/.test(jh), jh.slice(0, 200));
  await page.evaluate(() => window.showPage('payroll')); await page.waitForTimeout(1500);
  A('the payroll run list has a History button', await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'History' && /ffRecordHistory\('payroll_runs'/.test(b.getAttribute('data-on-click') || ''))));
  await page.evaluate(() => window.showPage('manual-journals')); await page.waitForTimeout(1500);
  A('the journals list has a History button', await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'History' && /ffRecordHistory\('journals'/.test(b.getAttribute('data-on-click') || ''))));
  eq('no page errors', errs, []);
}, {});
