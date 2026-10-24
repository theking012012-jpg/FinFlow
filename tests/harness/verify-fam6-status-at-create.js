'use strict';
/**
 * verify-fam6-status-at-create.js — FA-M6 (full app audit M6: "a status can be hand-set at CREATE time with no money
 * behind it"). The create forms offered invoice Paid / Overdue, bill Due Soon / Overdue / Paid, credit note Applied /
 * Void, vendor credit Applied and item Low Stock; the server stored them as chosen. A "Paid" invoice got amount_paid =
 * amount (F135) but NO payment record — no cash in the ledger, nothing in Payments Received.
 * After: "Paid" at create records a REAL payment for the full amount on the issue date through the one settling writer
 * (payment row + ledger cash leg + status recalc), exactly as Record Payment would; overdue / due soon are worked out
 * from the due date, never typed, so a create that sends them is stored unpaid; a credit can only be created Open (it is
 * applied or voided afterwards); low stock is worked out from units, never typed.
 *
 * Real Postgres + real routes. EXPECTED (by hand):
 *   invoice $500 "paid", issued 10 Jul → 1 payment $500 dated 10 Jul, status paid, ledger cash +$500  (bug: 0 payments, cash $0)
 *   bill $300 "paid", issued 12 Jul    → 1 payment made $300 dated 12 Jul, status paid, ledger cash −$300 (bug: 0, $0)
 *   → ledger cash = 500 − 300 = $200   (bug: $0)
 *   invoice "overdue" → stored pending; bill "due_soon" / "overdue" → stored unpaid   (bug: stored as typed)
 *   credit note "Applied" / "Void", vendor credit "Applied", item "Low Stock" → 400   (bug: 201, stored)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam6-status-at-create.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const eq = (n, measured, expected, bug) => A(n + `  [measured ${JSON.stringify(measured)}, correct ${JSON.stringify(expected)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`, JSON.stringify(measured) === JSON.stringify(expected));
const PW = 'harness-password-not-a-secret';

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  FA-M6 — a status chosen at create has money behind it, or is not offered\n' + '='.repeat(78) + '\n');
    const email = 'm6status@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', name: 'M6 Owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.91' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const cash = async () => Number((await c.query(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
      JOIN ledger_entries e ON e.id = l.entry_id WHERE a.user_id = $1 AND a.entity_id = $2 AND a.code = '1000' AND e.status = 'posted'`, [uid, eA])).rows[0].b);

    const inv = (await http.post('/api/invoices', { client: 'Paid At Create Co', amount: 500, status: 'paid', issue_date: '2026-07-10', idempotency_key: 'm6-inv-paid' })).json || {};
    const ip = (await c.query(`SELECT amount, payment_date FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows.map(r => [Number(r.amount), String(r.payment_date).slice(0, 10)]);
    eq('1  invoice created "Paid" → one real payment of $500 dated 10 Jul (bug: none)', ip, [[500, '2026-07-10']], []);
    eq('1b …and its status is paid, worked out from that payment', ((await c.query(`SELECT data->>'status' s FROM invoices WHERE id=$1`, [inv.id])).rows[0] || {}).s, 'paid');

    const bill = (await http.post('/api/bills', { vendor: 'Paid At Create Supplies', amount: 300, status: 'paid', issue_date: '2026-07-12', idempotency_key: 'm6-bill-paid' })).json || {};
    const bp = (await c.query(`SELECT data->>'amount' a, data->>'date' d, data->>'payment_date' pd FROM payments_made WHERE data->>'bill_id' = $1::text`, [String(bill.id)])).rows.map(r => [Number(r.a), String(r.pd || r.d || '').slice(0, 10)]);
    eq('2  bill created "Paid" → one real payment made of $300 dated 12 Jul (bug: none)', bp, [[300, '2026-07-12']], []);
    eq('2b …and its status is paid', ((await c.query(`SELECT data->>'status' s FROM bills WHERE id=$1`, [bill.id])).rows[0] || {}).s, 'paid');
    eq('3  ledger cash = $500 received − $300 paid = $200 (bug: $0 — no money moved)', await cash(), 200, 0);

    const io = (await http.post('/api/invoices', { client: 'Typed Overdue Co', amount: 80, status: 'overdue', issue_date: '2026-07-01', idempotency_key: 'm6-inv-od' })).json || {};
    eq('4  invoice sent as "overdue" is stored pending — overdue comes from the due date (bug: "overdue")', ((await c.query(`SELECT data->>'status' s FROM invoices WHERE id=$1`, [io.id])).rows[0] || {}).s, 'pending', 'overdue');
    const bs = [];
    for (const st of ['due_soon', 'overdue']) {
      const b = (await http.post('/api/bills', { vendor: 'Typed ' + st, amount: 40, status: st, issue_date: '2026-07-01', idempotency_key: 'm6-bill-' + st })).json || {};
      bs.push(((await c.query(`SELECT data->>'status' s FROM bills WHERE id=$1`, [b.id])).rows[0] || {}).s);
    }
    eq('5  bills sent as "due_soon" / "overdue" are stored unpaid (bug: as typed)', bs, ['unpaid', 'unpaid'], ['due_soon', 'overdue']);

    eq('6  a credit note cannot be created "Applied" (nothing applied yet)', (await http.post('/api/credit-notes', { customer: 'Acme', amount: 50, date: '2026-07-15', status: 'Applied' })).status, 400, 201);
    eq('6b …nor "Void"', (await http.post('/api/credit-notes', { customer: 'Acme', amount: 50, date: '2026-07-15', status: 'Void' })).status, 400, 201);
    const cnOk = await http.post('/api/credit-notes', { customer: 'Acme', amount: 50, date: '2026-07-15', status: 'Open', idempotency_key: 'm6-cn-open' });
    A('6c …Open is fine', [200, 201].includes(cnOk.status), 'status ' + cnOk.status);
    const cnId = (cnOk.json || {}).id;
    eq('6d an Open credit note can be voided (PUT Void → 200)', (await http.put('/api/credit-notes/' + cnId, { status: 'Void' })).status, 200);
    eq('6e …and reopened', (await http.put('/api/credit-notes/' + cnId, { status: 'Open' })).status, 200);
    eq('6f …but never typed "Applied" (bug: 200 — any status was accepted on edit)', (await http.put('/api/credit-notes/' + cnId, { status: 'Applied' })).status, 400, 200);
    // [STRUCTURAL] the create forms no longer offer what cannot be chosen (markup; the server rules above are executed)
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
    A('[STRUCTURAL] invoice form offers no "Overdue"; bill form no "Due Soon"/"Overdue"; credit forms Open only; item form no "Low Stock"',
      !/id="inv-status">[^]*?value="overdue"[^]*?<\/select>/.test(html.slice(html.indexOf('id="inv-status"'), html.indexOf('id="inv-status"') + 400))
      && !/value="due_soon"/.test(html.slice(html.indexOf('id="bill-status"'), html.indexOf('id="bill-status"') + 400))
      && !/value="Applied"/.test(html.slice(html.indexOf('id="cn-status"'), html.indexOf('id="cn-status"') + 300))
      && !/value="Applied"/.test(html.slice(html.indexOf('id="vc-status"'), html.indexOf('id="vc-status"') + 300))
      && !/Low Stock/.test(html.slice(html.indexOf('id="item-status"'), html.indexOf('id="item-status"') + 300)));
    eq('7  a vendor credit cannot be created "Applied"', (await http.post('/api/vendor-credits', { vendor: 'AWS', amount: 20, date: '2026-07-15', status: 'Applied' })).status, 400, 201);
    eq('8  an item cannot be created "Low Stock" — that is worked out from units', (await http.post('/api/items', { name: 'Gadget', type: 'Product', price: 10, status: 'Low Stock' })).status, 400, 201);
    A('8b …Active is fine', [200, 201].includes((await http.post('/api/items', { name: 'Gizmo', type: 'Product', price: 10, status: 'Active' })).status));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (FA-M6 status at create)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
