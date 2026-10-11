'use strict';
/**
 * M32 (money audit 2026-10-09; Rule 10): a stock movement — and so its COGS — is dated by the BUSINESS's day.
 * BUG: moved_at = NOW() (the server's real instant) and readers take its UTC day; any date the user gave was
 * ignored, so COGS could land in a different month from the sale's revenue.
 * Seed (JS clock pinned 2026-07-25; New York business): buy 10 @ 5 (date 2026-07-01) · sell 4 dated 2026-07-20 ·
 *   sell 2 with no date (⇒ the entity's today, 2026-07-25)
 *   correct: movement days 07-01 / 07-20 / 07-25 · July COGS (month view) = 30
 *   bug: every movement on the server's real day (outside July) · July COGS 0
 */
const { run } = require('./moneyFixKit.js');

run('M32 — stock movements carry the business day', async ({ newOwner, c, eq }) => {
  const { uid, J } = await newOwner('M32', [{ name: 'NY Co', currency: 'USD', timezone: 'America/New_York', country: 'US' }]);
  const item = await J('POST', '/api/inventory', { sku: 'D', name: 'Dated', units: 0, max_units: 100, cost: 5 });
  const buy = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 5, date: '2026-07-01', idempotency_key: 'm32-b' });
  const s1 = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 4, date: '2026-07-20', idempotency_key: 'm32-s1' });
  const s2 = await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'sale', quantity: 2, idempotency_key: 'm32-s2' });
  // The business day the books read: movement_date, else (pre-column rows / the bug) the UTC day of moved_at.
  // On the unfixed schema the column does not exist — the UTC day of moved_at is then exactly how it dates a sale.
  const { rows: [{ has }] } = await c.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='movement_date') AS has`);
  const dayExpr = has ? `COALESCE(movement_date, (moved_at AT TIME ZONE 'UTC')::date)` : `(moved_at AT TIME ZONE 'UTC')::date`;
  const day = async id => (await c.query(`SELECT ${dayExpr}::text AS d FROM inventory_movements WHERE id = $1`, [id])).rows[0].d;
  const { rows: [{ today }] } = await c.query(`SELECT to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD') AS today`);
  eq('movement days (purchase / dated sale / undated sale)', [await day(buy.id), await day(s1.id), await day(s2.id)], ['2026-07-01', '2026-07-20', '2026-07-25'], [today, today, today]);
  const { rows: [gl] } = await c.query(`SELECT entry_date::text AS d FROM ledger_entries WHERE user_id=$1 AND source_type='inventory_movement' AND source_id=$2`, [uid, s1.id]);
  eq('the sale\'s COGS ledger entry is on its business day', gl && gl.d, '2026-07-20', today);
  const july = await J('GET', '/api/reports?period=month&monthIdx=6');
  eq('July COGS (4 + 2 units @ 5)', july.cogs, 30, 0);
});
