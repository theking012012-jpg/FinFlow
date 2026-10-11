'use strict';
/**
 * M59 (personal/business wall, 2026-10-10): personal assets / liabilities are the person's — the list and every
 * net-worth sum are the same whichever business is in view.
 * BUG: GET /api/personal-accounts and the net-worth snapshot read "personal + the ACTIVE business's rows". Rows the old
 * POST tagged with a business (fixed going forward by N16b; those rows stay, Rule 8) appeared only while that business
 * was selected, so the personal net worth changed with the business switcher. (The accountant portal already read all.)
 * Seed (Rule 4): businesses A and B · "Savings" 1,000 (personal) · "Car" 700 tagged with A by the old bug.
 *   viewing B: list [Car, Savings] (bug: [Savings]) · snapshot 1,700 (bug: 1,000)
 *   viewing A: list [Car, Savings] · snapshot 1,700 (control — the bug agreed here)
 */
const { run } = require('./moneyFixKit.js');

run('M59 — personal accounts do not depend on the business in view', async ({ newOwner, c, eq, r2 }) => {
  const o = await newOwner('M59', [{ name: 'A Co', currency: 'USD' }, { name: 'B Co', currency: 'USD' }]);
  const [eA, eB] = o.ids;
  await o.J('POST', '/api/personal-accounts', { name: 'Savings', kind: 'asset', type: 'savings', value: 1000 });
  await c.query(`INSERT INTO personal_accounts (user_id, entity_id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
    [o.uid, eA, { name: 'Car', kind: 'asset', type: 'other', value: 700 }]);
  const view = async eid => {
    const list = (await o.J('GET', '/api/personal-accounts?entity_id=' + eid)).map(a => a.name).sort();
    const snap = r2(((await o.http.post('/api/snapshots/capture?entity_id=' + eid, { kind: 'networth' })).json || {}).value);
    return [list, snap];
  };
  eq('viewing B: list and net worth', await view(eB), [['Car', 'Savings'], 1700], [['Savings'], 1000]);
  eq('viewing A: list and net worth (control)', await view(eA), [['Car', 'Savings'], 1700]);
});
