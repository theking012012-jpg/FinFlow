'use strict';
/**
 * verify-invoice-line-items.js — F194 Phase 2a. An invoice may carry JSONB line_items [{desc,qty,rate}];
 * the SERVER derives amount = round(Σ qty×rate, 2) and that derived amount is the single canonical
 * figure every money surface reads (CLAUDE.md Rule 2 — no second writer of the total). A record with
 * no line_items is unchanged (backward-compatible).
 *
 * Asserts, on the REAL seeded server + the REAL SPA in jsdom (Rules 3/5/6):
 *   • server derives amount from line items and IGNORES a client-sent amount (999 → 1300)
 *   • line_items round-trip intact through GET
 *   • no line_items ⇒ the caller's amount is used, line_items stays absent (backward-compat)
 *   • invalid shapes are rejected 400, never silently stored (empty, negative, non-numeric, non-array, zero-total)
 *   • rounding is exact to 2dp (10.1 + 20.2 = 30.30)
 *   • [Rule 6] the derived amount reaches RECOGNIZED REVENUE — independent expected delta, not read from the code
 *   • the modal editor auto-fills + locks the amount, saveInvoice POSTs the items, and View renders them
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-invoice-line-items.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { http, window, settle } = boot;
    const doc = window.document;
    await settle(40, 60);

    // ── server derives the total from line items, ignoring a (deliberately wrong) sent amount ──
    const r1 = await http.post('/api/invoices', {
      client: 'LineItem Co', status: 'pending', issue_date: '2026-07-10', due_date: '2026-07-10',
      amount: 999,   // MUST be ignored
      line_items: [{ desc: 'Design', qty: 2, rate: 150 }, { desc: 'Build', qty: 5, rate: 200 }],
    });
    A('POST with line_items → 201', r1.status === 201, `status=${r1.status} ${(r1.text || '').slice(0, 120)}`);
    A('server DERIVES amount = Σ qty×rate = 1300 (ignores the sent 999)', r1.json && parseFloat(r1.json.amount) === 1300, `amount=${r1.json && r1.json.amount}`);
    A('line_items stored (2 rows, desc+qty+rate)', r1.json && Array.isArray(r1.json.line_items) && r1.json.line_items.length === 2 && r1.json.line_items[0].desc === 'Design' && r1.json.line_items[1].rate === 200, `li=${JSON.stringify(r1.json && r1.json.line_items)}`);

    const g = await http.get('/api/invoices');
    const back = (g.json || []).find(i => i.client === 'LineItem Co');
    A('GET round-trips the derived amount 1300', back && parseFloat(back.amount) === 1300, `amount=${back && back.amount}`);
    A('GET round-trips line_items intact', back && back.line_items && back.line_items[0].qty === 2 && back.line_items[1].desc === 'Build', `li=${JSON.stringify(back && back.line_items)}`);

    // ── backward-compat: no line_items ⇒ the sent amount is used, line_items absent ──
    const r2 = await http.post('/api/invoices', { client: 'Single Amount Co', status: 'pending', issue_date: '2026-07-11', amount: 777 });
    A('no line_items → amount = sent 777 (unchanged behaviour)', r2.status === 201 && parseFloat(r2.json.amount) === 777, `status=${r2.status} amount=${r2.json && r2.json.amount}`);
    A('no line_items → line_items stays absent (null/undefined)', r2.json && r2.json.line_items == null, `li=${JSON.stringify(r2.json && r2.json.line_items)}`);

    // ── validation: every invalid shape is rejected 400, never stored ──
    const bad = async (body, label) => { const r = await http.post('/api/invoices', body); A(label, r.status === 400, `status=${r.status} ${(r.text || '').slice(0, 90)}`); };
    await bad({ client: 'X', status: 'pending', line_items: [] }, 'empty line_items → 400');
    await bad({ client: 'X', status: 'pending', line_items: [{ desc: 'a', qty: -1, rate: 10 }] }, 'negative qty → 400');
    await bad({ client: 'X', status: 'pending', line_items: [{ desc: 'a', qty: 'abc', rate: 10 }] }, 'non-numeric qty → 400');
    await bad({ client: 'X', status: 'pending', line_items: [{ desc: 'a', qty: 0, rate: 0 }] }, 'zero total → 400');
    await bad({ client: 'X', status: 'pending', line_items: 'nope' }, 'non-array line_items → 400');

    // ── rounding is exact to 2dp (a naive float sum would leave 30.299999…) ──
    const r3 = await http.post('/api/invoices', { client: 'Round Co', status: 'pending', issue_date: '2026-07-12', line_items: [{ desc: 'a', qty: 1, rate: 10.1 }, { desc: 'b', qty: 1, rate: 20.2 }] });
    A('rounding: 10.1 + 20.2 = 30.30 exactly', r3.status === 201 && parseFloat(r3.json.amount) === 30.3, `amount=${r3.json && r3.json.amount}`);

    // ── [Rule 6] the DERIVED amount reaches recognized revenue — independent expected delta ──
    // Expected delta 1000 is computed HERE from the line items (4×250), not read from the endpoint.
    const rep0 = await http.get('/api/reports');
    const rev0 = rep0.json.revenue;
    const rr = await http.post('/api/invoices', { client: 'RevFlow Co', status: 'pending', issue_date: '2026-07-13', line_items: [{ desc: 'x', qty: 4, rate: 250 }] });
    A('RevFlow line-items invoice created, derived amount 1000', rr.status === 201 && parseFloat(rr.json.amount) === 1000, `amount=${rr.json && rr.json.amount}`);
    const rep1 = await http.get('/api/reports');
    const dRev = Math.round((rep1.json.revenue - rev0) * 100) / 100;
    A('[Rule 6] recognized revenue rose by EXACTLY the derived 1000 (line-items amount reaches the money path)', dRev === 1000, `Δrev=${dRev} (rev0=${rev0} rev1=${rep1.json.revenue})`);

    // ── jsdom end-to-end: editor fills+locks the amount, saveInvoice POSTs items, View renders them ──
    const setV = (id, v) => { const el = doc.getElementById(id); if (el) el.value = v; };
    window.openInvoiceModal();
    setV('inv-client', 'E2E Client'); setV('inv-issue', '2026-07-14'); setV('inv-status', 'pending'); setV('inv-due', '2026-07-20');
    window.ffInvLineItems.addRow();
    window.ffInvLineItems.addRow();
    const rows = doc.querySelectorAll('#inv-li-rows .inv-li-row');
    A('editor: two line rows added', rows.length === 2, `rows=${rows.length}`);
    const fill = (tr, d, q, rt) => { tr.querySelector('.inv-li-desc').value = d; tr.querySelector('.inv-li-qty').value = q; tr.querySelector('.inv-li-rate').value = rt; };
    fill(rows[0], 'Consulting', 3, 100);  // 300
    fill(rows[1], 'License', 1, 450);     // 450
    window.ffInvLineItems.recompute();
    const amtEl = doc.getElementById('inv-amount');
    A('editor: amount auto-fills to Σ = 750.00 and locks (readOnly)', amtEl.value === '750.00' && amtEl.readOnly === true, `val="${amtEl.value}" readOnly=${amtEl.readOnly}`);

    await window.saveInvoice();
    await settle(24, 60);
    const wl = boot.wireLog.filter(w => w.path === '/api/invoices' && w.method === 'POST').pop();
    let body = {}; try { body = JSON.parse(wl.body); } catch (_) {}
    A('saveInvoice POST body carries line_items (2 rows)', Array.isArray(body.line_items) && body.line_items.length === 2, `body=${wl && (wl.body || '').slice(0, 140)}`);
    const created = (window.userInvoices || []).find(i => i.client === 'E2E Client');
    A('new invoice persisted with the server-derived amount 750', created && parseFloat(created.amount) === 750, `amt=${created && created.amount}`);

    const idx = (window.userInvoices || []).findIndex(i => i.client === 'E2E Client');
    window.viewInvoice(idx);
    await settle(3, 40);
    const frame = doc.getElementById('ff-docview-frame');
    const html = (frame && (frame.getAttribute('srcdoc') || frame.srcdoc)) || '';
    A('View renders the two line-item descriptions', /Consulting/.test(html) && /License/.test(html), 'line descriptions missing in the document');
    A('View shows per-line + derived total (450.00 and 750.00)', html.indexOf('450.00') !== -1 && html.indexOf('750.00') !== -1, 'line/total figures missing');

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (invoice line items — server-derived amount)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
