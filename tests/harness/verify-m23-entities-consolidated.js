'use strict';
/**
 * M23 (money audit 2026-10-09): the Entities page "Consolidated" figures are the server's consolidation.
 * BUG: a plain sum of the per-entity views — each view includes the account's legacy entity-less rows (pre-F150
 * shape), so such a row counted once PER ENTITY.
 * Seed: clientMoneyKit (Business A, Year revenue 1,820) + Business B (no documents) + a legacy entity-less sales
 *   receipt of 120 (the NOT VALID chk_sales_receipts_entity_nn constraint is dropped in this scratch DB only, to
 *   reproduce rows that predate it).
 *   correct consolidated revenue: 1,820 + 0 + 120 once = 1,940 ("$1.9K")   bug: (1,820 + 120) + (0 + 120) = 2,060 ("$2.1K")
 */
const { run } = require('./clientMoneyKit.js');

run('M23 — consolidated figures come from the server consolidation', async ({ w, settle, text, eq, http }) => {
  const all = JSON.parse((await http.get('/api/reports?entity_id=all')).text);
  eq('server consolidated revenue (control)', all.revenue, 1940);
  w.showPage('entities'); await settle(40, 80);
  if (typeof w.renderEntities === 'function') w.renderEntities(); await settle(40, 80);
  eq('Entities page consolidated revenue card', text('ent-consol-rev'), '$1.9K', '$2.1K');
}, { extraSeed: async ({ http, client, userId }) => {
  await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);   // a 2nd entity needs the business plan
  const r = await http.request('POST', '/api/entities', { name: 'Business B', currency: 'USD', timezone: 'UTC', country: 'US' });
  if (r.status >= 300) throw new Error('entity B ' + r.status);
  await client.query(`ALTER TABLE sales_receipts DROP CONSTRAINT IF EXISTS chk_sales_receipts_entity_nn`);
  await client.query(`INSERT INTO sales_receipts (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
    [userId, { customer: 'Legacy walk-in', amount: 120, date: '2026-05-05', method: 'Cash' }]);
} });
