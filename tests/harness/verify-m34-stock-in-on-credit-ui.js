'use strict';
/**
 * M34 (fix pass round 2), BROWSER end-to-end: Stock In → "Supplier bill (on credit)" records the purchase AND the
 * supplier's bill in one step (real SPA in jsdom, clientMoneyKit seed, clock 2026-07-25).
 * Seed: clientMoneyKit (item Widget). Stock in 10 @ 20 on credit from "Acme Supplies", due 2026-08-24, dated 2026-07-25.
 *   correct: one bill 200 from Acme Supplies, tagged Stock, unpaid, no delete button; Year expenses unchanged ($2.9K)
 *   bug:     no "Paid by" choice — the purchase is cash and no bill exists (a second, manual bill would be opex)
 */
const { run } = require('./clientMoneyKit.js');

run('M34 — Stock In on credit creates the supplier bill', async ({ w, d, ev, text, settle, http, eq, A }) => {
  w.showPage('inventory'); await settle(30, 60);
  const idx = ev(`(window.inventory||[]).findIndex(i => i.name === 'Widget')`);
  A('seed item present', idx >= 0);
  ev(`openStockInModal(${idx})`); await settle(5, 40);
  const fund = d.getElementById('si-funding');
  eq('Stock In offers "Paid by"', fund ? 1 : 0, 1, 0);
  if (!fund) return;
  ev(`(function(){ const s=(id,v)=>{document.getElementById(id).value=v;}; s('si-qty','10'); s('si-cost','20'); s('si-funding','bill'); _siFundingChange(); s('si-vendor','Acme Supplies'); s('si-due','2026-08-24'); })()`);
  eq('supplier fields shown for a credit purchase', d.getElementById('si-bill-fields').classList.contains('hidden'), false);
  await ev(`submitStockIn()`); await settle(40, 60);
  const bills = ((await http.request('GET', '/api/bills')).json || []).filter(b => b.vendor === 'Acme Supplies');
  eq('one supplier bill for the purchase', bills.map(b => [Number(b.amount), b.status, String(b.due_date).slice(0, 10), b.inventory_movement_id != null]), [[200, 'unpaid', '2026-08-24', true]], []);
  w.showPage('bills'); await settle(30, 60);
  const row = Array.from(d.querySelectorAll('#page-bills .table-row')).find(r => /Acme Supplies/.test(r.textContent));
  eq('Bills page: the bill is tagged Stock', !!(row && /Stock/.test(row.textContent)), true, false);
  eq('Bills page: no delete on a purchase bill', row && row.querySelector('button[data-on-click^="deleteBill"]') ? 1 : 0, 0);
  w.showPage('dashboard'); ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(40, 60);
  eq('Year expenses unchanged by buying stock', text('d-exp'), '$2.9K', '$3.1K');
});
