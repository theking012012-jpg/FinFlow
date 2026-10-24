'use strict';
/**
 * verify-fam5c-bill-numbers.js — FA-M5c (found 2026-10-24 fixing FA-M5b). Bill numbers were 'BILL-' + the last 4 digits
 * of the clock (server.js form, recurring and stock-purchase writers), so they repeated and were never sequential; a CSV
 * import read the "Bill number" column and threw it away; Codat fell back to the platform id's last 4 digits.
 * Fix: invoices' B1b assigner, shared — every bill writer numbers per BUSINESS, sequentially, never reused, prefix per
 * business (Settings "Bill prefix", default "BILL-"); an imported bill keeps its own number when it is free here.
 *
 * Real Postgres + real routes; the clock is pinned, so the bug gives the SAME number to every bill. EXPECTED (by hand):
 *   A: 3 bills → BILL-0001..0003 (bug: BILL-xxxx ×3, identical) · 5 at once → BILL-0004..0008, all distinct
 *   B: its first bill → BILL-0001 (per business)
 *   A prefix "AP-" → next AP-0009 · prefix "<b>" → 400
 *   CSV: "V-554" kept · a row numbered BILL-0001 (taken here) → next in sequence AP-0010 (bug: no number at all)
 *   recurring bill due today → AP-0011 · stock purchase on credit → its bill AP-0012
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam5c-bill-numbers.js
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
    const { runRecurringScheduler } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  FA-M5c — every bill gets a number: per business, sequential, never repeated\n' + '='.repeat(78) + '\n');
    const email = 'm5cnum@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', name: 'M5c Owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Island Traders', currency: 'TTD', timezone: 'UTC', country: 'TT', is_active: 0 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.90' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    let k = 0;
    const bill = async (vendor, amount) => (await http.post('/api/bills', { vendor, amount, status: 'unpaid', issue_date: '2026-07-10', idempotency_key: 'm5c-' + (++k) })).json || {};
    const byVendor = async (v, eid) => ((await c.query(`SELECT data->>'num' AS n FROM bills WHERE user_id=$1 AND entity_id=$2 AND data->>'vendor'=$3`, [uid, eid || eA, v])).rows[0] || {}).n;

    const first = [await bill('Acme Supply', 100), await bill('Beta Parts', 200), await bill('Gamma Ltd', 300)];
    eq('1  three bills → BILL-0001, BILL-0002, BILL-0003 (and the response carries it)', first.map(b => b.num), ['BILL-0001', 'BILL-0002', 'BILL-0003']);
    const burst = await Promise.all([1, 2, 3, 4, 5].map(i => bill('Burst ' + i, 10 * i)));
    eq('2  five created at the same moment → BILL-0004..0008, all distinct', burst.map(b => b.num).sort(), ['BILL-0004', 'BILL-0005', 'BILL-0006', 'BILL-0007', 'BILL-0008']);

    eq('3  premise: switch to Island Traders', (await http.post('/api/entities/' + eB + '/activate', {})).status, 200);
    eq('3b its first bill is BILL-0001 — numbers are per business', (await bill('TT Supplier', 1000)).num, 'BILL-0001');
    eq('3c premise: back to Northwind', (await http.post('/api/entities/' + eA + '/activate', {})).status, 200);

    eq('4  bill prefix "AP-" saved on Northwind → HTTP 200', (await http.put('/api/entities/' + eA, { bill_prefix: 'AP-' })).status, 200);
    eq('4b next bill AP-0009 (the sequence carries on)', (await bill('Prefixed', 70)).num, 'AP-0009');
    eq('4c a prefix that is not plain text is refused', (await http.put('/api/entities/' + eA, { bill_prefix: '<b>' })).status, 400, 200);

    const imp = await http.post('/api/import/csv', { type: 'bills', content: 'Bill Number,Vendor,Amount,Bill Date\nV-554,Imported Supplier,450,2026-07-12\nBILL-0001,Clash Supplier,90,2026-07-13\n' });
    eq('5  premise: CSV import → HTTP 200', imp.status, 200);
    eq('5b an imported bill keeps its own number (V-554) (bug: no number)', await byVendor('Imported Supplier'), 'V-554', null);
    eq('5c an imported number already taken here (BILL-0001) → next in sequence, never a duplicate', await byVendor('Clash Supplier'), 'AP-0010', null);

    eq('6  premise: a monthly recurring bill due today', (await http.post('/api/recurring-bills', { vendor: 'Rent Co', amount: 900, frequency: 'Monthly', next_run: '2026-07-25', status: 'active' })).status, 200);
    await runRecurringScheduler();
    eq('6b the bill the schedule makes is numbered too (AP-0011)', await byVendor('Rent Co'), 'AP-0011', null);

    const item = (await http.post('/api/inventory', { name: 'Widget', sku: 'W-1', units: 0, cost: 5, price: 9 })).json || {};
    const mv = await http.post('/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 5, date: '2026-07-20', funding: 'bill', vendor: 'Widget Wholesale', idempotency_key: 'm5c-stock' });
    eq('7  premise: a stock purchase on credit → 201', mv.status, 201);
    eq('7b its supplier bill is numbered AP-0012', await byVendor('Widget Wholesale'), 'AP-0012', null);

    const all = (await c.query(`SELECT data->>'num' AS n FROM bills WHERE user_id=$1 AND entity_id=$2`, [uid, eA])).rows.map(r => r.n);
    A('8  every Northwind bill has a number and no two are the same', all.length === 13 && all.every(n => !!n) && new Set(all).size === all.length, JSON.stringify(all));
    eq('8b the audit row for a created bill records its number', ((await c.query(`SELECT new_data->>'num' AS n FROM audit_trail WHERE user_id=$1 AND table_name='bills' AND action='CREATE' AND record_id::text=$2::text`, [uid, String(first[0].id)])).rows[0] || {}).n, 'BILL-0001');
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (FA-M5c bill numbers)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
