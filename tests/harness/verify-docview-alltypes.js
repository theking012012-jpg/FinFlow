'use strict';
/**
 * verify-docview-alltypes.js — F194 Phase 3. The rich printable document viewer (finflow-docview.js,
 * window.ffOpenDocView) is now reachable from EVERY Money In/Out list, not just invoices, via a small
 * per-list mapper (viewBill / viewQuote / viewReceipt / viewPaymentReceived / viewCreditNote /
 * viewVendorCredit / viewPaymentMade) defined in finflow-api-wiring-pages.js. Each maps its real record
 * to the shared doc shape and opens the viewer, inheriting F196 letterhead, F195 TZ-safe dates and (for
 * bills/quotes) the Phase-2b line-items table for free.
 *
 * Asserts, on the REAL seeded server + the REAL SPA in jsdom (Rules 3/5/6): for each of the seven doc
 * types, calling window.viewX(id) renders a document whose KIND title, party name and amount are the
 * record's OWN data — and for bills+quotes, that the line-items table renders. Discriminating: without
 * the viewX mappers the overlay iframe is empty, so every KIND-title assertion fails.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-docview-alltypes.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  const idOf = r => { const o = (r.json && (r.json.row || r.json)) || {}; return o.id; };
  try {
    boot = await bootSpaInJsdom({});
    const { http, window, settle } = boot;
    const doc = window.document;
    await settle(40, 60);

    // ── seed one real record of every Money In/Out type ─────────────────────────────────────────
    const rInv = await http.post('/api/invoices', { client: 'Acme Inc', amount: 500, status: 'pending', issue_date: '2026-07-10' });
    const invRow = (rInv.json && (rInv.json.row || rInv.json)) || {};
    // payments-received resolves its party from window._realInvoices (Store-B rows carry invoice_id only) —
    // seed that array with the invoice we just created so the mapper can name the client.
    window._realInvoices = window._realInvoices || [];
    window._realInvoices.push(invRow);
    const rPay = await http.post('/api/invoice-payments', { invoice_id: invRow.id, amount: 200, payment_date: '2026-07-12', method: 'card' });

    const rBill = await http.post('/api/bills', { vendor: 'CloudCo', status: 'unpaid', issue_date: '2026-07-10',
      line_items: [{ desc: 'Compute', qty: 2, rate: 100 }, { desc: 'Storage', qty: 1, rate: 50 }] });        // derived 250
    const rQuote = await http.post('/api/quotes', { client: 'Bidder LLC', status: 'pending',
      line_items: [{ desc: 'Design', qty: 2, rate: 150 }, { desc: 'Build', qty: 1, rate: 200 }] });          // derived 500
    const rRcpt = await http.post('/api/sales-receipts', { customer: 'Walk-in Cust', amount: 75, date: '2026-07-11', method: 'cash', num: 'RCT-9001' });
    const rCn   = await http.post('/api/credit-notes', { customer: 'Refund Co', amount: 60, date: '2026-07-11', status: 'Open', reason: 'Return', num: 'CN-9001' });
    const rVc   = await http.post('/api/vendor-credits', { vendor: 'Supplier X', amount: 40, date: '2026-07-11', status: 'Open', reason: 'Overcharge', num: 'VC-9001' });
    const rPm   = await http.post('/api/payments-made', { vendor: 'Landlord LLC', amount: 1200, date: '2026-07-11', method: 'transfer' });

    // ── refresh the client-side arrays the mappers read (all seven load fns are window-exposed) ──
    for (const fn of ['_loadBillsFromDB','_loadReceiptsFromDB','_loadPaymentsRecvFromDB','_loadCreditNotesFromDB','_loadPaymentsMadeFromDB','_loadVendorCreditsFromDB','_loadQuotesFromDB']) {
      try { if (typeof window[fn] === 'function') await window[fn](); } catch (_) {}
    }
    await settle(24, 60);

    // ── open each doc via its viewX(id) and read the isolated iframe's document ──
    const view = async (fnName, id) => {
      if (typeof window[fnName] !== 'function') return '';
      window[fnName](id);
      await settle(3, 40);
      const frame = doc.getElementById('ff-docview-frame');
      return (frame && (frame.getAttribute('srcdoc') || frame.srcdoc)) || '';
    };
    const has = (h, ...subs) => subs.every(s => h.indexOf(s) !== -1);

    const hBill = await view('viewBill', idOf(rBill));
    A('BILL: KIND title + vendor + derived total render', has(hBill, 'BILL', 'CloudCo', '250.00'), hBill ? 'present-but-missing-token' : 'empty iframe (mapper missing?)');
    A('BILL: line-items table renders both descriptions', has(hBill, 'Compute', 'Storage'), 'line descriptions missing');

    const hQuote = await view('viewQuote', idOf(rQuote));
    A('QUOTE: KIND title + client + derived total render', has(hQuote, 'QUOTE', 'Bidder LLC', '500.00'), hQuote ? 'missing-token' : 'empty iframe');
    A('QUOTE: line-items table renders both descriptions', has(hQuote, 'Design', 'Build'), 'line descriptions missing');

    const hRcpt = await view('viewReceipt', idOf(rRcpt));
    A('RECEIPT: KIND title + customer + amount render', has(hRcpt, 'RECEIPT', 'Walk-in Cust', '75.00'), hRcpt ? 'missing-token' : 'empty iframe');

    const hCn = await view('viewCreditNote', idOf(rCn));
    A('CREDIT NOTE: KIND title + customer + amount render', has(hCn, 'CREDIT NOTE', 'Refund Co', '60.00'), hCn ? 'missing-token' : 'empty iframe');

    const hVc = await view('viewVendorCredit', idOf(rVc));
    A('VENDOR CREDIT: KIND title + vendor + amount render', has(hVc, 'VENDOR CREDIT', 'Supplier X', '40.00'), hVc ? 'missing-token' : 'empty iframe');

    const hPm = await view('viewPaymentMade', idOf(rPm));
    A('PAYMENT (made): KIND title + vendor + amount render', has(hPm, 'PAYMENT', 'Landlord LLC', '1,200.00'), hPm ? 'missing-token' : 'empty iframe');

    const hPr = await view('viewPaymentReceived', idOf(rPay));
    A('PAYMENT (received): KIND title + invoice client (via _realInvoices) + amount render', has(hPr, 'PAYMENT', 'Acme Inc', '200.00'), hPr ? 'missing-token' : 'empty iframe');

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (docview across all Money In/Out types)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
