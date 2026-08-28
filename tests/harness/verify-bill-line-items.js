'use strict';
/**
 * verify-bill-line-items.js — F194 Phase 2b (BILLS). A bill may carry JSONB line_items [{desc,qty,rate}];
 * the SERVER derives amount = round(Σ qty×rate, 2) and that derived amount is the single canonical
 * figure every money surface reads (CLAUDE.md Rule 2 — no second writer of the total). A bill with no
 * line_items is unchanged (backward-compatible). Unlike quotes, an ISSUED bill is RECOGNIZED as an
 * expense (RECOGNIZED_BILL, FULL amount, keyed on issue_date), so the derived amount must flow to OpEx.
 *
 * Asserts, on the REAL seeded server + the REAL SPA in jsdom (Rules 3/5/6):
 *   • server derives amount from line items and IGNORES a client-sent amount (999 → 1300)
 *   • line_items round-trip intact through GET
 *   • no line_items ⇒ the caller's amount is used, line_items stays absent (backward-compat)
 *   • invalid shapes are rejected 400, never silently stored (empty, negative, non-numeric, non-array, zero-total)
 *   • rounding is exact to 2dp (10.1 + 20.2 = 30.30)
 *   • [Rule 6] the derived amount reaches RECOGNIZED EXPENSE (OpEx) — independent expected delta, not read from the code
 *   • the modal editor auto-fills + locks the amount and saveBill POSTs the items with the derived amount
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-bill-line-items.js
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
    const r1 = await http.post('/api/bills', {
      vendor: 'LineItem Vendor', status: 'unpaid', issue_date: '2026-07-10', due_date: '2026-07-10',
      amount: 999,   // MUST be ignored
      line_items: [{ desc: 'Hosting', qty: 2, rate: 150 }, { desc: 'Support', qty: 5, rate: 200 }],
    });
    A('POST with line_items → ok', r1.status >= 200 && r1.status < 300, `status=${r1.status} ${(r1.text || '').slice(0, 120)}`);
    A('server DERIVES amount = Σ qty×rate = 1300 (ignores the sent 999)', r1.json && parseFloat((r1.json.row || r1.json).amount) === 1300, `amount=${r1.json && (r1.json.row || r1.json).amount}`);
    const b1 = r1.json && (r1.json.row || r1.json);
    A('line_items stored (2 rows, desc+qty+rate)', b1 && Array.isArray(b1.line_items) && b1.line_items.length === 2 && b1.line_items[0].desc === 'Hosting' && b1.line_items[1].rate === 200, `li=${JSON.stringify(b1 && b1.line_items)}`);

    const g = await http.get('/api/bills');
    const back = (g.json || []).find(i => i.vendor === 'LineItem Vendor');
    A('GET round-trips the derived amount 1300', back && parseFloat(back.amount) === 1300, `amount=${back && back.amount}`);
    A('GET round-trips line_items intact', back && back.line_items && back.line_items[0].qty === 2 && back.line_items[1].desc === 'Support', `li=${JSON.stringify(back && back.line_items)}`);

    // ── backward-compat: no line_items ⇒ the sent amount is used, line_items absent ──
    const r2 = await http.post('/api/bills', { vendor: 'Single Amount Vendor', status: 'unpaid', issue_date: '2026-07-11', amount: 777 });
    const b2 = r2.json && (r2.json.row || r2.json);
    A('no line_items → amount = sent 777 (unchanged behaviour)', (r2.status >= 200 && r2.status < 300) && parseFloat(b2.amount) === 777, `status=${r2.status} amount=${b2 && b2.amount}`);
    A('no line_items → line_items stays absent (null/undefined)', b2 && b2.line_items == null, `li=${JSON.stringify(b2 && b2.line_items)}`);

    // ── validation: every invalid shape is rejected 400, never stored ──
    const bad = async (body, label) => { const r = await http.post('/api/bills', body); A(label, r.status === 400, `status=${r.status} ${(r.text || '').slice(0, 90)}`); };
    await bad({ vendor: 'X', status: 'unpaid', line_items: [] }, 'empty line_items → 400');
    await bad({ vendor: 'X', status: 'unpaid', line_items: [{ desc: 'a', qty: -1, rate: 10 }] }, 'negative qty → 400');
    await bad({ vendor: 'X', status: 'unpaid', line_items: [{ desc: 'a', qty: 'abc', rate: 10 }] }, 'non-numeric qty → 400');
    await bad({ vendor: 'X', status: 'unpaid', line_items: [{ desc: 'a', qty: 0, rate: 0 }] }, 'zero total → 400');
    await bad({ vendor: 'X', status: 'unpaid', line_items: 'nope' }, 'non-array line_items → 400');

    // ── rounding is exact to 2dp (a naive float sum would leave 30.299999…) ──
    const r3 = await http.post('/api/bills', { vendor: 'Round Vendor', status: 'unpaid', issue_date: '2026-07-12', line_items: [{ desc: 'a', qty: 1, rate: 10.1 }, { desc: 'b', qty: 1, rate: 20.2 }] });
    const b3 = r3.json && (r3.json.row || r3.json);
    A('rounding: 10.1 + 20.2 = 30.30 exactly', (r3.status >= 200 && r3.status < 300) && parseFloat(b3.amount) === 30.3, `amount=${b3 && b3.amount}`);

    // ── [Rule 6] the DERIVED amount reaches recognized EXPENSE (OpEx) — independent expected delta ──
    // Expected delta 1000 is computed HERE from the line items (4×250), not read from the endpoint.
    // status 'unpaid' ∈ RECOGNIZED_BILL and issue_date is in period, so the FULL derived amount is OpEx.
    const rep0 = await http.get('/api/reports');
    const exp0 = rep0.json.expenses;
    const rr = await http.post('/api/bills', { vendor: 'ExpFlow Vendor', status: 'unpaid', issue_date: '2026-07-13', line_items: [{ desc: 'x', qty: 4, rate: 250 }] });
    const br = rr.json && (rr.json.row || rr.json);
    A('ExpFlow line-items bill created, derived amount 1000', (rr.status >= 200 && rr.status < 300) && parseFloat(br.amount) === 1000, `amount=${br && br.amount}`);
    const rep1 = await http.get('/api/reports');
    const dExp = Math.round((rep1.json.expenses - exp0) * 100) / 100;
    A('[Rule 6] recognized expense (OpEx) rose by EXACTLY the derived 1000 (line-items amount reaches the money path)', dExp === 1000, `Δexp=${dExp} (exp0=${exp0} exp1=${rep1.json.expenses})`);

    // ── jsdom end-to-end: editor fills+locks the amount, saveBill POSTs items with the derived amount ──
    window.ffBillLineItems.reset();
    const setV = (id, v) => { const el = doc.getElementById(id); if (el) el.value = v; };
    setV('bill-vendor', 'E2E Vendor'); setV('bill-issue', '2026-07-14'); setV('bill-status', 'unpaid'); setV('bill-due', '2026-07-20');
    const rc = doc.getElementById('bill-recurring'); if (rc) rc.checked = false;
    window.ffBillLineItems.addRow();
    window.ffBillLineItems.addRow();
    const rows = doc.querySelectorAll('#bill-li-rows .bill-li-row');
    A('editor: two line rows added', rows.length === 2, `rows=${rows.length}`);
    const fill = (tr, d, q, rt) => { tr.querySelector('.bill-li-desc').value = d; tr.querySelector('.bill-li-qty').value = q; tr.querySelector('.bill-li-rate').value = rt; };
    fill(rows[0], 'Compute', 3, 100);  // 300
    fill(rows[1], 'Storage', 1, 450);  // 450
    window.ffBillLineItems.recompute();
    const amtEl = doc.getElementById('bill-amount');
    A('editor: amount auto-fills to Σ = 750.00 and locks (readOnly)', amtEl.value === '750.00' && amtEl.readOnly === true, `val="${amtEl.value}" readOnly=${amtEl.readOnly}`);

    await window.saveBill();
    await settle(24, 60);
    const wl = boot.wireLog.filter(w => w.path === '/api/bills' && w.method === 'POST').pop();
    let body = {}; try { body = JSON.parse(wl.body); } catch (_) {}
    A('saveBill POST body carries line_items (2 rows)', Array.isArray(body.line_items) && body.line_items.length === 2, `body=${wl && (wl.body || '').slice(0, 160)}`);
    const created = (window.bills || []).find(i => i.vendor === 'E2E Vendor');
    A('new bill persisted with the server-derived amount 750', created && parseFloat(created.amount) === 750, `amt=${created && created.amount}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (bill line items — server-derived amount + expense recognition)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
