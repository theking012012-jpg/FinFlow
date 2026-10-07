#!/usr/bin/env node
'use strict';
/**
 * verify-team-member-money-scope.js — N8 / N32 class. Invited team members act on the ACCOUNT's books,
 * so every lock check, status recalculation and money write must key on the account (scopeId), not the
 * acting member's own user id. For an owner the two ids are equal, which is why single-user tests
 * never saw this.
 *
 * Discriminating checks (Rule 4) — an active ADMIN member of the owner's account:
 *   member writes into the owner's locked period          → 403   (bug: 201, lock ignored)
 *   member records a payment on the owner's invoice       → 201   (bug: 404)
 *   member deletes a 150 payment of 250 paid on 500       → amount_paid 100 (bug: stays 250)
 *   member pays the owner's 300 bill in full              → bill status paid (bug: stays unpaid)
 *   member records an inventory purchase                  → 201   (bug: 404)
 *   member adds an FX rate                                → visible to the account (bug: invisible)
 *   node -r ./tests/harness/clock.js tests/harness/verify-team-member-money-scope.js
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'team-scope-pw-1';
    const mkUser = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const owner = await mkUser('owner@finflow.test');
    const member = await mkUser('member@finflow.test');
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [owner, { name: 'Owner Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`,
      [owner, { email: 'member@finflow.test', name: 'Member', role: 'admin', status: 'active', member_user_id: String(member) }]);
    const O = new HarnessHttp(server.baseUrl, { xff: '10.8.3.1' });
    const M = new HarnessHttp(server.baseUrl, { xff: '10.8.3.2' });
    A('owner login', (await O.post('/api/auth/login', { email: 'owner@finflow.test', password: PW })).status === 200);
    A('member login', (await M.post('/api/auth/login', { email: 'member@finflow.test', password: PW })).status === 200);
    const acc = await M.get('/api/my-access');
    A('member session is scoped into the owner account', acc.json && acc.json.currentAccountId === owner, JSON.stringify(acc.json));

    console.log('\n' + '='.repeat(78));
    console.log('  TEAM MEMBER ACTS ON THE ACCOUNT — locks, payments, recalcs, writes');
    console.log('='.repeat(78));

    // 1 · period lock
    A('owner locks through 2026-06-30', (await O.post('/api/lock-settings', { enabled: true, lock_date: '2026-06-30' })).status === 200);
    const ol = await O.post('/api/expenses', { description: 'Owner locked', amount: 10, expense_date: '2026-06-15' });
    A('control: owner write into locked period → 403', ol.status === 403, 'status ' + ol.status);
    const ml = await M.post('/api/expenses', { description: 'Member locked', amount: 12, expense_date: '2026-06-15' });
    A('member write into locked period → 403 (bug: 201)', ml.status === 403, `status ${ml.status}: ${ml.text.slice(0, 100)}`);
    const mo = await M.post('/api/expenses', { description: 'Member open', amount: 14, expense_date: '2026-07-15' });
    A('member write in an open period → 201', mo.status === 201, 'status ' + mo.status);

    // 2 · invoice payments
    const inv = await O.post('/api/invoices', { client: 'Acme', amount: 500, due_date: '2026-08-01', issue_date: '2026-07-10', status: 'pending' });
    const invId = inv.json && inv.json.id;
    A('owner creates a 500 invoice', inv.status === 201 && invId, 'status ' + inv.status);
    const mp = await M.post('/api/invoice-payments', { invoice_id: invId, amount: 100, payment_date: '2026-07-20' });
    A('member records a payment on the owner invoice → 201 (bug: 404)', mp.status === 201, `status ${mp.status}: ${mp.text.slice(0, 100)}`);
    const st1 = (await c.query(`SELECT data->>'amount_paid' p, data->>'status' s FROM invoices WHERE id=$1`, [invId])).rows[0];
    A('invoice reflects the member payment: paid 100, partial', parseFloat(st1.p) === 100 && st1.s === 'partial', JSON.stringify(st1));
    const op = await O.post('/api/invoice-payments', { invoice_id: invId, amount: 150, payment_date: '2026-07-21' });
    A('owner records 150 → paid 250', op.status === 201 && parseFloat((await c.query(`SELECT data->>'amount_paid' p FROM invoices WHERE id=$1`, [invId])).rows[0].p) === 250);
    const del = await M.del ? await M.del('/api/invoice-payments/' + op.json.id) : await M.request('DELETE', '/api/invoice-payments/' + op.json.id);
    A('member (admin) deletes the 150 payment → 200', del.status === 200, 'status ' + del.status);
    const st2 = (await c.query(`SELECT data->>'amount_paid' p FROM invoices WHERE id=$1`, [invId])).rows[0];
    A('invoice amount_paid recalculated to 100 (bug: stays 250)', parseFloat(st2.p) === 100, 'amount_paid=' + st2.p);

    // 3 · bill payment recalc
    const bill = await O.post('/api/bills', { vendor: 'Supplier', amount: 300, due_date: '2026-08-05', issue_date: '2026-07-05', status: 'unpaid' });
    const billId = bill.json && bill.json.id;
    A('owner creates a 300 bill', !!billId, 'status ' + bill.status);
    const pm = await M.post('/api/payments-made', { vendor: 'Supplier', amount: 300, date: '2026-07-22', bill_id: billId });
    A('member pays the bill (200)', pm.status === 200, 'status ' + pm.status);
    const bs = (await c.query(`SELECT data->>'status' s, data->>'amount_paid' p FROM bills WHERE id=$1`, [billId])).rows[0];
    A('bill recalculated to paid / 300 (bug: unpaid / 0)', bs.s === 'paid' && parseFloat(bs.p) === 300, JSON.stringify(bs));

    // 4 · inventory movement
    const item = await O.post('/api/inventory', { name: 'Widget', qty: 0, cost: 5 });
    const im = await M.post('/api/inventory-movements', { inventory_id: item.json && item.json.id, type: 'purchase', quantity: 10, unit_cost: 5 });
    A('member records an inventory purchase → 201 (bug: 404)', im.status === 201, `status ${im.status}: ${im.text.slice(0, 100)}`);
    if (im.status === 201) A('movement belongs to the account', im.json.user_id === owner, 'user_id=' + im.json.user_id);

    // 5 · FX rate
    const fx = await M.post('/api/fx-rates', { from_currency: 'EUR', to_currency: 'USD', rate: 1.17, rate_date: '2026-07-20' });
    A('member adds an FX rate (201)', fx.status === 201, 'status ' + fx.status);
    const ofx = await O.get('/api/fx-rates');
    A('owner sees the member-entered rate (bug: invisible)', Array.isArray(ofx.json) && ofx.json.some(r => r.from_currency === 'EUR' && Number(r.rate) === 1.17), JSON.stringify(ofx.json));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (team member money scope)` : `  ALL GREEN — ${pass} passed, 0 failed  (team member money scope)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
