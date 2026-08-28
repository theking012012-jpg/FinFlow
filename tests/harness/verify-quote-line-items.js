'use strict';
/**
 * verify-quote-line-items.js — F194 Phase 2b (QUOTES). A quote may carry JSONB line_items [{desc,qty,rate}];
 * the SERVER derives amount = round(Σ qty×rate, 2) as the canonical quote total (CLAUDE.md Rule 2 — no
 * second writer). A quote with no line_items is unchanged (backward-compatible). Unlike bills/invoices a
 * quote is a DOCUMENT ONLY — it is NOT recognized revenue — so the derived amount must NOT move any money
 * figure. This harness proves both: the total is server-derived AND it stays off the books.
 *
 * Asserts, on the REAL seeded server + the REAL SPA in jsdom (Rules 3/5/6):
 *   • server derives amount from line items and IGNORES a client-sent amount (999 → 1300)
 *   • line_items round-trip intact through GET
 *   • no line_items ⇒ the caller's amount is used, line_items stays absent (backward-compat)
 *   • invalid shapes are rejected 400, never silently stored (empty, negative, non-numeric, non-array, zero-total)
 *   • rounding is exact to 2dp (10.1 + 20.2 = 30.30)
 *   • [Rule 6 negative control] a quote's derived amount does NOT reach recognized revenue (Δrev = 0)
 *   • the modal editor auto-fills + locks the amount and saveQuote POSTs the items with the derived amount
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-quote-line-items.js
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
    const r1 = await http.post('/api/quotes', {
      client: 'LineItem Quote Co', status: 'pending', expiry_date: '2026-08-10',
      amount: 999,   // MUST be ignored
      line_items: [{ desc: 'Scope', qty: 2, rate: 150 }, { desc: 'Delivery', qty: 5, rate: 200 }],
    });
    A('POST with line_items → ok', r1.status >= 200 && r1.status < 300, `status=${r1.status} ${(r1.text || '').slice(0, 120)}`);
    const q1 = r1.json && (r1.json.row || r1.json);
    A('server DERIVES amount = Σ qty×rate = 1300 (ignores the sent 999)', q1 && parseFloat(q1.amount) === 1300, `amount=${q1 && q1.amount}`);
    A('line_items stored (2 rows, desc+qty+rate)', q1 && Array.isArray(q1.line_items) && q1.line_items.length === 2 && q1.line_items[0].desc === 'Scope' && q1.line_items[1].rate === 200, `li=${JSON.stringify(q1 && q1.line_items)}`);

    const g = await http.get('/api/quotes');
    const back = (g.json || []).find(i => i.client === 'LineItem Quote Co');
    A('GET round-trips the derived amount 1300', back && parseFloat(back.amount) === 1300, `amount=${back && back.amount}`);
    A('GET round-trips line_items intact', back && back.line_items && back.line_items[0].qty === 2 && back.line_items[1].desc === 'Delivery', `li=${JSON.stringify(back && back.line_items)}`);

    // ── backward-compat: no line_items ⇒ the sent amount is used, line_items absent ──
    const r2 = await http.post('/api/quotes', { client: 'Single Amount Quote Co', status: 'pending', amount: 777 });
    const q2 = r2.json && (r2.json.row || r2.json);
    A('no line_items → amount = sent 777 (unchanged behaviour)', (r2.status >= 200 && r2.status < 300) && parseFloat(q2.amount) === 777, `status=${r2.status} amount=${q2 && q2.amount}`);
    A('no line_items → line_items stays absent (null/undefined)', q2 && q2.line_items == null, `li=${JSON.stringify(q2 && q2.line_items)}`);

    // ── validation: every invalid shape is rejected 400, never stored ──
    const bad = async (body, label) => { const r = await http.post('/api/quotes', body); A(label, r.status === 400, `status=${r.status} ${(r.text || '').slice(0, 90)}`); };
    await bad({ client: 'X', status: 'pending', line_items: [] }, 'empty line_items → 400');
    await bad({ client: 'X', status: 'pending', line_items: [{ desc: 'a', qty: -1, rate: 10 }] }, 'negative qty → 400');
    await bad({ client: 'X', status: 'pending', line_items: [{ desc: 'a', qty: 'abc', rate: 10 }] }, 'non-numeric qty → 400');
    await bad({ client: 'X', status: 'pending', line_items: [{ desc: 'a', qty: 0, rate: 0 }] }, 'zero total → 400');
    await bad({ client: 'X', status: 'pending', line_items: 'nope' }, 'non-array line_items → 400');

    // ── rounding is exact to 2dp (a naive float sum would leave 30.299999…) ──
    const r3 = await http.post('/api/quotes', { client: 'Round Quote Co', status: 'pending', line_items: [{ desc: 'a', qty: 1, rate: 10.1 }, { desc: 'b', qty: 1, rate: 20.2 }] });
    const q3 = r3.json && (r3.json.row || r3.json);
    A('rounding: 10.1 + 20.2 = 30.30 exactly', (r3.status >= 200 && r3.status < 300) && parseFloat(q3.amount) === 30.3, `amount=${q3 && q3.amount}`);

    // ── [Rule 6 NEGATIVE control] a quote is document-only: its derived amount must NOT reach revenue ──
    // Discriminating: if a future change ever recognized quotes, this goes red. Δ computed independently.
    const rep0 = await http.get('/api/reports');
    const rev0 = rep0.json.revenue;
    const rr = await http.post('/api/quotes', { client: 'NoRecognize Quote Co', status: 'pending', line_items: [{ desc: 'x', qty: 4, rate: 250 }] });
    const qr = rr.json && (rr.json.row || rr.json);
    A('quote line-items created, derived amount 1000', (rr.status >= 200 && rr.status < 300) && parseFloat(qr.amount) === 1000, `amount=${qr && qr.amount}`);
    const rep1 = await http.get('/api/reports');
    const dRev = Math.round((rep1.json.revenue - rev0) * 100) / 100;
    A('[Rule 6 negative] recognized revenue is UNCHANGED by a quote (Δrev = 0 — quotes stay off the books)', dRev === 0, `Δrev=${dRev} (rev0=${rev0} rev1=${rep1.json.revenue})`);

    // ── jsdom end-to-end: editor fills+locks the amount, saveQuote POSTs items with the derived amount ──
    window.ffQuoteLineItems.reset();
    const setV = (id, v) => { const el = doc.getElementById(id); if (el) el.value = v; };
    setV('quote-client', 'E2E Quote Client'); setV('quote-status', 'pending'); setV('quote-expiry', '2026-08-20');
    window.ffQuoteLineItems.addRow();
    window.ffQuoteLineItems.addRow();
    const rows = doc.querySelectorAll('#quote-li-rows .quote-li-row');
    A('editor: two line rows added', rows.length === 2, `rows=${rows.length}`);
    const fill = (tr, d, q, rt) => { tr.querySelector('.quote-li-desc').value = d; tr.querySelector('.quote-li-qty').value = q; tr.querySelector('.quote-li-rate').value = rt; };
    fill(rows[0], 'Phase 1', 3, 100);  // 300
    fill(rows[1], 'Phase 2', 1, 450);  // 450
    window.ffQuoteLineItems.recompute();
    const amtEl = doc.getElementById('quote-amount');
    A('editor: amount auto-fills to Σ = 750.00 and locks (readOnly)', amtEl.value === '750.00' && amtEl.readOnly === true, `val="${amtEl.value}" readOnly=${amtEl.readOnly}`);

    await window.saveQuote();
    await settle(24, 60);
    const wl = boot.wireLog.filter(w => w.path === '/api/quotes' && w.method === 'POST').pop();
    let body = {}; try { body = JSON.parse(wl.body); } catch (_) {}
    A('saveQuote POST body carries line_items (2 rows)', Array.isArray(body.line_items) && body.line_items.length === 2, `body=${wl && (wl.body || '').slice(0, 160)}`);
    const created = (window.quotes || []).find(i => i.client === 'E2E Quote Client');
    A('new quote persisted with the server-derived amount 750', created && parseFloat(created.amount) === 750, `amt=${created && created.amount}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (quote line items — server-derived total, document-only)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
