'use strict';
/**
 * M58 (personal/business wall, 2026-10-10): a holding is personal or business by WHAT IT IS — never by which business
 * happens to be active. Business holdings are written and read ONLY with scope=business; anything else is personal.
 * BUG: POST /api/holdings without a scope stored the holding under the ACTIVE business (a personal holding silently
 * became business data); GET /api/holdings without a scope MERGED personal and the active business's holdings.
 * Seed (Rule 4 — 3 × 100 = 300 vs 5 × 40 = 200): business A in view.
 *   business holding BIZ 3 @ 100 (scope=business) · holding PERS 5 @ 40 saved WITHOUT a scope
 *   PERS stored personal (entity NULL)                 (bug: stored under A)
 *   unscoped GET → [PERS] only                         (bug: [BIZ, PERS])
 *   scope=personal → [PERS] · scope=business → [BIZ]   (bug: personal [] · business [BIZ, PERS])
 *   personal net-worth snapshot (portfolio) = 200      (bug: 0 — PERS was filed under the business)
 */
const { run } = require('./moneyFixKit.js');

run('M58 — holdings never inherit the active business', async ({ newOwner, c, eq, r2 }) => {
  const o = await newOwner('M58');
  await o.J('POST', '/api/holdings', { scope: 'business', ticker: 'BIZ', name: 'Biz Co', shares: 3, cost_per: 100, price: 100 });
  const pers = await o.J('POST', '/api/holdings', { ticker: 'PERS', name: 'Personal Co', shares: 5, cost_per: 40, price: 40 });
  const { rows: [row] } = await c.query(`SELECT entity_id FROM holdings WHERE id = $1`, [pers.id]);
  eq('a holding saved without a scope is personal', row.entity_id, null, o.ids[0]);
  const tick = async q => (await o.J('GET', '/api/holdings' + q)).map(h => h.ticker).sort();
  eq('unscoped list = personal only', await tick(''), ['PERS'], ['BIZ', 'PERS']);
  eq('scope=personal', await tick('?scope=personal'), ['PERS'], []);
  eq('scope=business', await tick('?scope=business'), ['BIZ'], ['BIZ', 'PERS']);
  const snap = (await o.http.post('/api/snapshots/capture', { kind: 'portfolio' })).json || {};
  eq('personal portfolio snapshot', r2(snap.value), 200, 0);
});
