'use strict';
/**
 * M54 (found in fix pass round 2): a ledger REBUILD posts each stock purchase against the account it was recorded with.
 * BUG: the rebuild posted EVERY purchase Cr 1000 Cash. Opening stock — recorded live as Dr 1200 / Cr 3100 Equity —
 * became cash spent after a reset, so the balance-sheet cash dropped by the value of the opening stock.
 * Seed (Rule 4): item Gadget opened with 5 @ 10 = 50 (no cash moved); a cash purchase 3 @ 7 = 21.
 *   live:          cash −21 · equity (3100) −50 · inventory 71
 *   after rebuild: cash −21 (bug −71) · equity −50 (bug 0) · inventory 71
 * Existing rows (Rule 8): an opening-stock row recorded before contra_code existed is recognised by its reference
 * ('Opening stock') — exercised here by clearing contra_code before the rebuild.
 */
const { run } = require('./moneyFixKit.js');

run('M54 — a ledger rebuild keeps opening stock in equity', async ({ newOwner, c, eq, r2 }) => {
  const { uid, J } = await newOwner('M54');
  const g = await J('POST', '/api/inventory', { sku: 'G', name: 'Gadget', units: 5, max_units: 100, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: g.id, type: 'purchase', quantity: 3, unit_cost: 7, date: '2026-07-05', idempotency_key: 'm54-buy' });
  const bal = async (code) => r2((await c.query(`SELECT COALESCE(SUM(ll.debit - ll.credit),0)::float AS b FROM ledger_lines ll JOIN ledger_accounts la ON la.id = ll.account_id
     JOIN ledger_entries le ON le.id = ll.entry_id WHERE ll.user_id = $1 AND la.code = $2 AND le.status = 'posted'`, [uid, code])).rows[0].b);
  eq('live: cash / equity / inventory', [await bal('1000'), await bal('3100'), await bal('1200')], [-21, -50, 71]);
  const { rows: [{ has }] } = await c.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='contra_code') AS has`);
  if (has) await c.query(`UPDATE inventory_movements SET contra_code = NULL WHERE user_id = $1`, [uid]);   // rows recorded before the column
  await J('POST', '/api/gl/backfill?reset=1', {});
  eq('after a rebuild: cash', await bal('1000'), -21, -71);
  eq('after a rebuild: opening stock stays in equity', await bal('3100'), -50, 0);
  eq('after a rebuild: inventory', await bal('1200'), 71);
});
