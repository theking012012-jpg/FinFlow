'use strict';
/**
 * C3 (Cowork end-to-end test 4.4a): after a reload with a TT$ business active, its amounts show "TT$", not "$".
 * BUG: Island Traders (TTD) showed "$" after a reload. The account-level settings currency (USD), applied late in
 * boot, overrode the active business's own currency. A business's figures are in the business's currency, never
 * the account's.
 * Seed: clientMoneyKit (Business A, USD) + business "Island Co" (TTD) with an invoice of 8,000 issued 2026-07-02, made
 *   the ACTIVE business before the app boots (= a reload while Island Co is selected).
 *   dashboard revenue card → "TT$8.0K"      bug: "$8.0K"
 *   invoices list shows "TT$8,000"           bug: "$8,000"
 */
const { run } = require('./clientMoneyKit.js');

run('C3 — the active business\'s currency survives a reload', async ({ w, d, ev, text, settle, eq, A }) => {
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(40, 60);
  eq('active business after boot', ev(`((window.ENTITIES||[]).find(e=>e.active)||{}).name`), 'Island Co');
  eq('dashboard revenue in TT$', text('d-rev'), 'TT$8.0K', '$8.0K');
  try { w.showPage('invoices'); } catch (_) {}
  await settle(20, 60);
  const inv = (d.getElementById('page-invoices') || {}).textContent || '';
  A('invoices list shows TT$8,000', /TT\$8,000/.test(inv), (inv.match(/.{0,20}8,000.{0,10}/) || [''])[0]);
}, { extraSeed: async ({ http, client, userId }) => {
  await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
  const b = await J('POST', '/api/entities', { name: 'Island Co', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
  await J('POST', '/api/entities/' + b.id + '/activate', {});
  await J('POST', '/api/invoices?entity_id=' + b.id, { client: 'Harbour Ltd', amount: 8000, status: 'pending', issue_date: '2026-07-02', due_date: '2026-07-30', idempotency_key: 'c3-inv' });
  await J('PUT', '/api/settings', { currency: 'USD' });
} });
