'use strict';
/**
 * M53 (personal/business wall, 2026-10-10): personal net-worth / portfolio HISTORY belongs to the person — stored once,
 * as personal, and read identically from any business in view.
 * BUG: POST /api/snapshots/capture stored the personal snapshot under the ACTIVE business, and GET /api/snapshots
 * returned "personal + the active business's rows": the personal series — and "change this month" — depended on the
 * business switcher, and a month captured under two businesses had two rows.
 * Seed (Rule 4): businesses A and B · personal account 3,000 · legacy June rows from the old capture: under A 2,700,
 *   under B 2,600 (B's saved later). July captured once viewing A and once viewing B.
 *   correct: July stored ONCE, personal (entity NULL) · the series from A and from B are identical:
 *            June 2,600 (the later of the two legacy rows) → July 3,000
 *   bug:     July stored twice (under A and B) · from A [2,700, 3,000] · from B [2,600, 3,000]
 */
const { run } = require('./moneyFixKit.js');

run('M53 — personal snapshots are personal', async ({ newOwner, c, eq }) => {
  const o = await newOwner('M53', [{ name: 'A Co', currency: 'USD' }, { name: 'B Co', currency: 'USD' }]);
  const [eA, eB] = o.ids;
  await o.J('POST', '/api/personal-accounts', { name: 'Savings', kind: 'asset', type: 'savings', value: 3000 });
  const legacy = (eid, value, upd) => c.query(`INSERT INTO snapshots (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [o.uid, eid, { kind: 'networth', value, date: '2026-06-30', period_key: 'networth:2026-06' }, upd]);
  await legacy(eA, 2700, '2026-06-30T10:00:00Z');
  await legacy(eB, 2600, '2026-06-30T18:00:00Z');
  await o.J('POST', '/api/snapshots/capture?entity_id=' + eA, { kind: 'networth' });
  await o.J('POST', '/api/snapshots/capture?entity_id=' + eB, { kind: 'networth' });
  const { rows: jul } = await c.query(`SELECT entity_id FROM snapshots WHERE user_id=$1 AND data->>'period_key' LIKE 'networth:2026-07%'`, [o.uid]);
  eq('July captured from two businesses: ONE personal row', jul.map(r => r.entity_id), [null], [eA, eB]);
  const series = async eid => (await o.J('GET', '/api/snapshots?kind=networth&entity_id=' + eid)).map(s => [String(s.date).slice(0, 7), Number(s.value)]);
  const fromA = await series(eA), fromB = await series(eB);
  eq('series viewed from A', fromA, [['2026-06', 2600], ['2026-07', 3000]], [['2026-06', 2700], ['2026-07', 3000]]);
  eq('series viewed from B (identical)', fromB, fromA, [['2026-06', 2600], ['2026-07', 3000]]);
});
