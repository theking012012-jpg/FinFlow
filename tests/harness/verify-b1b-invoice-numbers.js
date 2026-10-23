'use strict';
/**
 * verify-b1b-invoice-numbers.js — B1b (gap investigation 2026-10-22: invoices had NO number; Payments Received showed
 * "Invoice # —"; the Settings "Invoice prefix" was read by nothing).
 * Fix (better than standard): a number per BUSINESS, assigned at creation by every invoice writer (form, recurring,
 * CSV import, Codat import), sequential, never reused (a deleted number leaves a gap, never a repeat), unique in the
 * database, prefix per business; an imported invoice keeps its own number when it is free.
 *
 * Real Postgres + real routes. EXPECTED (by hand):
 *   A: 3 invoices → INV-0001..0003 · 5 at once → INV-0004..0008, all distinct · delete 0008 → next INV-0009 (not 0008)
 *   B: its first invoice → INV-0001 (per business)
 *   A prefix "NW-" → next NW-0010 · prefix "<b>" → 400
 *   CSV: "Q-778" kept · a row numbered INV-0001 (taken) → next in sequence NW-0011, never a duplicate
 *   recurring invoice due today → NW-0012 · a direct duplicate INSERT is refused by the database (unique index)
 *   bug: no number anywhere
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-b1b-invoice-numbers.js
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
    console.log('\n' + '='.repeat(78) + '\n  B1b — every invoice gets a number: per business, sequential, unique, never reused\n' + '='.repeat(78) + '\n');
    const email = 'b1bnum@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', name: 'B1b Owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Island Traders', currency: 'TTD', timezone: 'UTC', country: 'TT', is_active: 0 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.89' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    let k = 0;
    const inv = async (client, amount) => (await http.post('/api/invoices', { client, amount, status: 'pending', issue_date: '2026-07-10', idempotency_key: 'b1b-' + (++k) })).json || {};
    const num = async id => (await c.query(`SELECT data->>'number' AS n FROM invoices WHERE id=$1`, [id])).rows[0].n;

    const first = [await inv('Acme', 100), await inv('Beta', 200), await inv('Gamma', 300)];
    eq('1  three invoices → INV-0001, INV-0002, INV-0003 (and the response carries it)', first.map(i => i.number), ['INV-0001', 'INV-0002', 'INV-0003'], [undefined, undefined, undefined]);
    const burst = await Promise.all([1, 2, 3, 4, 5].map(i => inv('Burst ' + i, 10 * i)));
    const bn = burst.map(i => i.number).sort();
    eq('2  five created at the same moment → INV-0004..0008, all distinct', bn, ['INV-0004', 'INV-0005', 'INV-0006', 'INV-0007', 'INV-0008'], []);
    const last = burst.find(i => i.number === 'INV-0008');
    eq('3  delete INV-0008 → HTTP 200', last ? (await http.request('DELETE', '/api/invoices/' + last.id)).status : 'none', 200);
    eq('3b the next invoice is INV-0009 — a deleted number is never handed out again', (await inv('After delete', 50)).number, 'INV-0009', 'INV-0008');

    eq('4  premise: switch to Island Traders', (await http.post('/api/entities/' + eB + '/activate', {})).status, 200);
    eq('4b its first invoice is INV-0001 — numbers are per business', (await inv('TT Client', 1000)).number, 'INV-0001');
    eq('4c premise: back to Northwind', (await http.post('/api/entities/' + eA + '/activate', {})).status, 200);

    eq('5  prefix "NW-" saved on Northwind → HTTP 200', (await http.put('/api/entities/' + eA, { invoice_prefix: 'NW-' })).status, 200);
    eq('5b next invoice NW-0010 (the sequence carries on)', (await inv('Prefixed', 70)).number, 'NW-0010');
    eq('5c a prefix that is not plain text is refused', (await http.put('/api/entities/' + eA, { invoice_prefix: '<b>' })).status, 400, 200);

    const imp = await http.post('/api/import/csv', { type: 'invoices', content: 'Invoice Number,Customer,Amount,Invoice Date\nQ-778,Imported Co,450,2026-07-12\nINV-0001,Clash Co,90,2026-07-13\n' });
    eq('6  premise: CSV import → HTTP 200', imp.status, 200);
    const byClient = async n => (await c.query(`SELECT data->>'number' AS n FROM invoices WHERE user_id=$1 AND entity_id=$2 AND data->>'client'=$3`, [uid, eA, n])).rows[0];
    eq('6b an imported invoice keeps its own number (Q-778)', (await byClient('Imported Co') || {}).n, 'Q-778', null);
    eq('6c an imported number already taken here (INV-0001) → next in sequence, never a duplicate', (await byClient('Clash Co') || {}).n, 'NW-0011', null);

    await http.post('/api/recurring-invoices', { client: 'Retainer Co', amount: 500, frequency: 'Monthly', next_run: '2026-07-25', status: 'active' });
    await runRecurringScheduler();
    eq('7  an invoice made by the recurring schedule is numbered too (NW-0012)', (await byClient('Retainer Co') || {}).n, 'NW-0012', null);

    let dbRefused = false;
    try { await c.query(`INSERT INTO invoices (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eA, { client: 'Dup', amount: 1, status: 'pending', number: 'NW-0010' }]); }
    catch (e) { dbRefused = e.code === '23505'; }
    A('8  the database itself refuses a second NW-0010 in Northwind (unique index)', dbRefused);
    const all = (await c.query(`SELECT data->>'number' AS n FROM invoices WHERE user_id=$1 AND entity_id=$2`, [uid, eA])).rows.map(r => r.n);
    A('8b no Northwind invoice is without a number', all.length > 0 && all.every(n => !!n), JSON.stringify(all));
    eq('8c the audit row for a created invoice records its number', ((await c.query(`SELECT new_data->>'number' AS n FROM audit_trail WHERE user_id=$1 AND table_name='invoices' AND action='CREATE' AND record_id::text=$2::text`, [uid, String(first[0].id)])).rows[0] || {}).n, 'INV-0001', null);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (B1b invoice numbers)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
