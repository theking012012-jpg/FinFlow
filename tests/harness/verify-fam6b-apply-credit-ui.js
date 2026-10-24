'use strict';
/**
 * verify-fam6b-apply-credit-ui.js — FA-M6b, the screens. Real SPA in jsdom + real bundle + real scratch Postgres.
 * Hand-computed: invoice A Acme 1,000 (paid 0) · invoice C Bright 500 · credit note CN Acme 300 dated 15 Jul 2026 (today 25 Jul).
 *   1  the credit row offers Apply; the dialog lists ONLY Acme's invoice (not Bright's), suggests min(300 left, 1,000 owed) = 300
 *   2  applying 250 through the dialog → one application; a second click on the same dialog does not add one
 *   3  the credit row shows "$50.00 left"; cards: issued $300 · not yet applied $50 · applied $250 · this month $300
 *      (bug: the first card was a COUNT, "1", under "Total Credits"; Open/Applied summed whole credits by status)
 *   4  invoice A's Paid cell says "Credited $250.00 · $750.00 left", not "Paid $250" (bug: a credit shown as money received)
 *   5  the Invoices page "Collected" is $0.00 (bug: $250.00) · Outstanding $1,200 = 750 + 500 − 50
 *   6  the invoice document shows "Credit note applied −$250.00", Balance Due $750.00, and no "Payments received" line
 *   7  Unapply → the credit is whole again, invoice owes 1,000
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam6b-apply-credit-ui.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, seedExtra: async (c, uid) => {
      await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { name: 'M6b UI Co', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }]);
    } });
    const { window, http, settle, pg } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.openApplyCredit !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    const a = (await http.post('/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-30', idempotency_key: 'm6bui-a' })).json || {};
    await http.post('/api/invoices', { client: 'Bright', amount: 500, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-30', idempotency_key: 'm6bui-c' });
    const cn = (await http.post('/api/credit-notes', { customer: 'Acme', amount: 300, date: '2026-07-15', idempotency_key: 'm6bui-cn' })).json || {};
    const reload = async () => {
      try { await window.refreshFinancials('invoices'); } catch (_) {}
      try { await window._loadCreditNotesFromDB(); } catch (_) {}
      await settle(6, 50);
    };
    await reload();
    try { window.showPage('credit-notes'); window.renderCreditNotes(); } catch (_) {}
    await settle(4, 40);
    const row = () => ((d.getElementById('credit-notes-list') || {}).textContent || '').replace(/\s+/g, ' ');
    A('premise: the credit note row is listed', /Acme/.test(row()) && /Apply/.test(row()), row().slice(0, 160));
    await window.openApplyCredit('credit_note', cn.id);
    await settle(3, 30);
    const sel = d.getElementById('apc-doc');
    const opts = sel ? [...sel.options].map(o => o.textContent) : [];
    A('1  the dialog lists only Acme\'s invoice, and suggests 300.00', opts.length === 1 && /\$1,000 owed/.test(opts[0]) && d.getElementById('apc-amount').value === '300.00', JSON.stringify({ opts, amt: d.getElementById('apc-amount') && d.getElementById('apc-amount').value }));
    d.getElementById('apc-amount').value = '250';
    await Promise.all([window.submitApplyCredit('credit_note', cn.id), window.submitApplyCredit('credit_note', cn.id)]);
    await settle(8, 60);
    const apps = (await http.get('/api/credit-applications?kind=credit_note&credit_id=' + cn.id)).json || [];
    A('2  one application of 250, though the button fired twice', apps.length === 1 && Math.abs(apps[0].amount - 250) < 0.01, JSON.stringify(apps));
    d.getElementById('apply-credit-overlay') && d.getElementById('apply-credit-overlay').remove();
    await reload();
    try { window.renderCreditNotes(); } catch (_) {}
    await settle(12, 100);
    const cards = [...d.querySelectorAll('#page-credit-notes .mc-val')].map(e => e.textContent.trim());
    A('3  the row shows $50.00 left; cards $300 · $50 · $250 · $300 (bug: "1" · whole credits by status)', /\$50 left/.test(row()) && cards.join('|') === '$300|$50|$250|$300', row().slice(0, 120) + ' cards=' + cards.join('|'));
    try { window.showPage('invoices'); window.renderInvoices && window.renderInvoices(); } catch (_) {}
    await settle(12, 100);   // the stat cards count up for ~700 ms (finflow-counter.js) — read the landed value
    const invTxt = ((d.getElementById('invoice-list') || {}).textContent || '').replace(/\s+/g, ' ');
    A('4  invoice A: "Credited $250 · $750 left", not "Paid $250"', /Credited \$250\b/.test(invTxt) && /\$750 left/.test(invTxt) && !/Paid \$250\b/.test(invTxt), (invTxt.match(/.{0,60}\$250.{0,40}/) || [invTxt.slice(0, 160)])[0]);
    const val = id => ((d.getElementById(id) || {}).textContent || '').trim();
    A('5  Invoices "Collected" $0 (bug: $250); Outstanding $1,200 = 750 + 500 − 50', val('inv-paid') === '$0' && val('inv-out') === '$1,200', JSON.stringify({ paid: val('inv-paid'), out: val('inv-out'), pct: val('inv-paid-pct') }));
    const raw = (window._realInvoices || []).find(r => r.id === a.id) || {};
    const html = String(window.buildDocumentHTML({ number: raw.number, party: raw.client, issue_date: raw.issue_date, due_date: raw.due_date, status: raw.status, amount: raw.amount, amount_paid: raw.amount_paid, credit_applied: raw.credit_applied, currency: 'USD' }, 'invoice')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    A('6  the invoice shows "Credit note applied −$250.00", Balance Due $750.00, no "Payments received"', /Credit note applied (−|&minus;)\$250\.00/.test(html) && /Balance Due \$750\.00/.test(html) && !/Payments received/.test(html), (html.match(/Total.{0,140}/) || [''])[0]);
    await window.openApplyCredit('credit_note', cn.id);
    await settle(3, 30);
    await window.unapplyCredit('credit_note', cn.id, apps[0] && apps[0].id);
    await settle(8, 60);
    const left = (await http.get('/api/credit-applications?kind=credit_note&credit_id=' + cn.id)).json || [];
    const inv7 = ((await http.get('/api/invoices')).json || []).find(r => r.id === a.id) || {};
    A('7  Unapply → the credit is whole again, invoice A owes 1,000', left.length === 0 && Number(inv7.amount_paid || 0) === 0, JSON.stringify({ left: left.length, paid: inv7.amount_paid }));
    void pg;
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-M6b apply credit UI)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
