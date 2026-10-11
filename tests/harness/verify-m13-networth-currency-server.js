'use strict';
/**
 * M13 (money audit 2026-10-09), SERVER legs: personal assets / liabilities carry the currency they were entered in,
 * and every server net-worth sum adds their USD equivalents (value_usd).
 * BUG: no currency on the row; the net-worth snapshot and the accountant portal added raw values across currencies.
 * Seed (Rule 4 — three different currencies, three different USD values):
 *   Car   asset      1,000      legacy row, no currency  ⇒ USD 1,000
 *   House asset      1,000 TTD  value_usd 147.06
 *   Loan  liability    500 EUR  value_usd 540.00
 *   net worth (USD) = 1,000 + 147.06 − 540 = 607.06      (bug: 1,000 + 1,000 − 500 = 1,500)
 * Edit: House re-valued to 2,000 TTD (value_usd 294.12) ⇒ 754.12 (bug: 2,500)
 * Write guard: a non-USD value without its USD equivalent is refused (400), never stored as if USD.
 */
const bcrypt = require('bcryptjs');
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

run('M13 — personal net worth adds USD equivalents (server legs)', async ({ newOwner, c, eq, A, server, r2 }) => {
  const { uid, J, http, ids } = await newOwner('M13');
  await J('POST', '/api/personal-accounts', { name: 'Car', kind: 'asset', type: 'other', value: 1000 });
  const house = await J('POST', '/api/personal-accounts', { name: 'House', kind: 'asset', type: 'property', value: 1000, currency: 'TTD', value_usd: 147.06 });
  await J('POST', '/api/personal-accounts', { name: 'Loan', kind: 'liability', type: 'loan', value: 500, currency: 'EUR', value_usd: 540 });

  const snap = async () => r2(((await http.post('/api/snapshots/capture', { kind: 'networth' })).json || {}).value);
  eq('net-worth snapshot (USD)', await snap(), 607.06, 1500);

  const PW = 'm13-acc-pw-not-a-secret';
  const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ('m13-acc@finflow.test', $1, 'M', 'Thirteen', 'Firm', 'M13REF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
  A('owner grants personal access', (await http.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [ids[0]]: 'view' }, personal: 'view' } })).status === 200);
  const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.213' });
  A('accountant login', (await ACC.post('/api/accountants/login', { email: 'm13-acc@finflow.test', password: PW })).status === 200);
  const portalNw = async () => r2((((await ACC.get(`/api/accountants/clients/${uid}/books?period=year`)).json || {}).personal || {}).netWorth);
  eq('accountant portal net worth (USD)', await portalNw(), 607.06, 1500);

  await J('PUT', '/api/personal-accounts/' + house.id, { value: 2000, currency: 'TTD', value_usd: 294.12 });
  eq('after re-valuing House to 2,000 TTD: snapshot', await snap(), 754.12, 2500);
  eq('after re-valuing House to 2,000 TTD: portal', await portalNw(), 754.12, 2500);
  const badPut = await http.put('/api/personal-accounts/' + house.id, { value: 3000 });
  eq('re-valuing a TTD row without value_usd is refused', badPut.status, 400, 200);
  eq('…and leaves the stored figure unchanged', await snap(), 754.12, undefined);
  const bad = await http.post('/api/personal-accounts', { name: 'Boat', kind: 'asset', type: 'other', value: 900, currency: 'TTD' });
  eq('a new non-USD value without value_usd is refused', bad.status, 400, 201);
  eq('…and adds nothing to net worth', await snap(), 754.12, undefined);
});
