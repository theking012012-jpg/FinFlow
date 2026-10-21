'use strict';
/**
 * verify-lr24-money-labels-currency.js — LR24: a business money field's label names the business's currency.
 *  The live retest saw "Amount ($)" on a quote and "Rate ($/hr)" on a time entry on a TT$ business. The class is every
 *  business-form money label that hard-coded "($)": 19 labels across 17 forms. They now carry <span data-cur="biz">,
 *  painted by ONE painter whenever a modal is shown, however it is opened.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Each form is opened with the app's own opener (the button
 * path); the label is read back from the DOM by its field id.
 *   TT$ business: every label reads "TT$"              (old: "($)" — 19 of 19 measured)
 *   then a USD business is made active: the quote label reads "$" again (the painter follows the business; a label
 *   stuck on "TT$" would be the same defect the other way round)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr24-money-labels-currency.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

// [opener, modal id, field ids whose label names a currency]
const FORMS = [
  ['openQuoteModal', 'quote-modal', ['quote-amount']],
  ['openTimesheetModal', 'timesheet-modal', ['ts-rate']],
  ['openProjectModal', 'project-modal', ['proj-budget']],
  ['openBillModal', 'bill-modal', ['bill-amount']],
  ['openRecurringBillModal', 'recurring-bill-modal', ['rb-amount']],
  ['openRecurringInvoiceModal', 'recurring-inv-modal', ['ri-amount']],
  ['openReceiptModal', 'modal-receipt', ['receipt-amount']],
  ['openPaymentReceivedModal', 'modal-payment-received', ['pr-amount']],
  ['openCreditNoteModal', 'modal-credit-note', ['cn-amount']],
  ['openPaymentMadeModal', 'modal-payment-made', ['pm-amount']],
  ['openVendorCreditModal', 'modal-vendor-credit', ['vc-amount']],
  ['openInvoiceModal', 'invoice-modal', ['inv-amount']],
  ['openExpenseModal', 'expense-modal', ['bexp-amount']],
  ['openProductModal', 'product-modal', ['prod-cost']],
  ['openItemModal', 'item-modal', ['item-price', 'item-cost']],
  [null, 'edit-inv-modal', ['edit-inv-cost']],
  [null, 'journal-entry-modal', []],
];

(async () => {
  let boot;
  console.log('\nLR24 — business money labels name the business currency\n');
  try {
    let usdId;
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const u = await J('POST', '/api/entities', { name: 'Mainland LR24', currency: 'USD', timezone: 'UTC', country: 'US' });
      usdId = u.id;
      const e = await J('POST', '/api/entities', { name: 'Island LR24', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);

    const labelOf = id => {
      const f = d.getElementById(id); if (!f) return null;
      const l = d.querySelector(`label[for="${id}"]`) || (f.closest('.field-wrap, div') || {}).querySelector?.('label');
      return l ? l.textContent.trim() : null;
    };
    const open = async (fn, modalId) => {
      let how = 'opener';
      try { if (fn && typeof w[fn] === 'function') await w[fn](); else how = 'none'; } catch (_) { how = 'opener-threw'; }
      await settle(10, 20);
      const m = d.getElementById(modalId);
      if (m && m.classList.contains('hidden')) { m.classList.remove('hidden'); how += '+shown'; await settle(2, 5); }   // what every opener does
      return how;
    };
    const close = modalId => { const m = d.getElementById(modalId); if (m) m.classList.add('hidden'); };

    const bad = [], seen = [];
    for (const [fn, modalId, ids] of FORMS) {
      await open(fn, modalId);
      for (const id of ids) {
        const t = labelOf(id); seen.push(id);
        if (t == null || !/TT\$/.test(t) || /\(\$/.test(t)) bad.push(`${id}: ${t}`);
      }
      if (modalId === 'journal-entry-modal') {
        const hdr = (d.getElementById(modalId) || {}).textContent || '';
        seen.push('journal Debit', 'journal Credit');
        if (!/Debit \(TT\$\)/.test(hdr)) bad.push('journal Debit');
        if (!/Credit \(TT\$\)/.test(hdr)) bad.push('journal Credit');
      }
      close(modalId);
    }
    eq('every business money label reads TT$ on a TT$ business (19 labels)', [seen.length, bad], [19, []], [19, ['19 of 19 read "($)" — measured']]);
    eq('the reported two: quote "Amount (TT$)", time entry "Rate (TT$/hr)"',
      [labelOf('quote-amount'), labelOf('ts-rate')], ['Amount (TT$) *', 'Rate (TT$/hr)'], ['Amount ($) *', 'Rate ($/hr)']);

    // The painter follows the business: switch to the USD business and reopen the quote form.
    const idx = (w.ENTITIES || w.eval('ENTITIES')).findIndex(x => String(x.id) === String(usdId));
    await w.switchEntity(idx);
    await settle(60, 60);
    await open('openQuoteModal', 'quote-modal');
    eq('[GUARD] after switching to the USD business, the quote label reads "$"', labelOf('quote-amount'), 'Amount ($) *', undefined);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
