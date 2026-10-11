'use strict';
/**
 * M26 (money audit 2026-10-09): the accountant portal's personal-finance figures must be the owner's PERSONAL
 * rows only, for a stated window, with no row cap, and never add different currencies together.
 * BUG: a raw sum of the last 200 personal_transactions rows — all-time, INCLUDING business bank-feed rows
 * (entity_id set), mixing currencies.
 * Seed (today pinned 2026-07-25): personal income 1,000 USD (Mar) · personal expense 200 USD (Apr) ·
 *   personal expense 999 USD dated 2025-12-15 (last year) · business bank-feed debit 5,000 (entity row)
 *   correct YTD: income 1,000 · expense 200 · list has no business row
 *   bug: income 1,000 · expense 6,199 (200 + 999 + 5,000) · business row listed
 * Then a TTD 50 expense is added: expense = null (mixed), expenseByCurrency {USD 200, TTD 50}  (bug: 6,249)
 */
const bcrypt = require('bcryptjs');
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

run('M26 — portal personal finances: personal rows, YTD, per currency', async ({ newOwner, c, eq, A, server }) => {
  const { uid, J, http, ids } = await newOwner('M26');
  await J('POST', '/api/personal-transactions', { description: 'Consulting', category: 'Income', amount: 1000, tx_type: 'income', tx_date: '2026-03-02', currency: 'USD' });
  await J('POST', '/api/personal-transactions', { description: 'Groceries', category: 'Groceries', amount: 200, tx_type: 'expense', tx_date: '2026-04-03', currency: 'USD' });
  await J('POST', '/api/personal-transactions', { description: 'Old trip', category: 'Other', amount: 999, tx_type: 'expense', tx_date: '2025-12-15', currency: 'USD' });
  await J('POST', '/api/banking?entity_id=' + ids[0], { desc: 'BUSINESS SUPPLIER', amount: 5000, type: 'debit', date: '2026-05-05' });

  const PW = 'm26-acc-pw-not-a-secret';
  const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ('m26-acc@finflow.test', $1, 'M', 'TwentySix', 'Firm', 'M26REF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
  A('owner grants personal access', (await http.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [ids[0]]: 'view' }, personal: 'view' } })).status === 200);
  const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.226' });
  A('accountant login', (await ACC.post('/api/accountants/login', { email: 'm26-acc@finflow.test', password: PW })).status === 200);
  const pers = async () => ((await ACC.get(`/api/accountants/clients/${uid}/books?period=year`)).json || {}).personal || {};
  let p = await pers();
  eq('YTD personal income / expense (USD only)', [Number(p.income), Number(p.expense)], [1000, 200], [1000, 6199]);
  A('the business bank-feed row is not in the personal list', !(p.transactions || []).some(t => /BUSINESS SUPPLIER/.test(t.description || t.desc || '')), JSON.stringify((p.transactions || []).map(t => t.description)));

  await J('POST', '/api/personal-transactions', { description: 'Doubles', category: 'Dining out', amount: 50, tx_type: 'expense', tx_date: '2026-06-06', currency: 'TTD' });
  p = await pers();
  eq('mixed currencies: no single expense figure', p.expense, null, '6249.00');
  eq('expense per currency (USD, TTD)', [p.expenseByCurrency && p.expenseByCurrency.USD, p.expenseByCurrency && p.expenseByCurrency.TTD], [200, 50]);
});
