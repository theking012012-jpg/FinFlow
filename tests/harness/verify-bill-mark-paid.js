#!/usr/bin/env node
'use strict';
/**
 * verify-bill-mark-paid.js — N33 (payables mirror of N11). Editing a bill to 'paid' records a real
 * bill-linked payment for the outstanding balance, so cash flow and the ledger see the money leave.
 *
 * Defect: PUT /api/bills/:id with status 'paid' only stamped amount_paid (and only when no linked
 * payments existed): no payments_made row → the cash-flow report never saw the outflow and the ledger
 * kept AP open; with a prior partial payment the flip left amount_paid partial.
 *
 * Executed against the real server + Postgres. Seeds: bill A 1000 unpaid; bill B 800 with a 300 linked
 * payment; bill C 450 for concurrency. Bug value stated:
 *   A → paid: linked payments Σ 1000, amount_paid 1000, cash-flow outflow +1000   (bug: Σ 0, +0)
 *   B → paid: a 500 settling payment, amount_paid 800, status paid                (bug: amount_paid 300)
 *   3 concurrent C → paid: exactly one settling payment of 450
 *   GL books balanced
 *   node -r ./tests/harness/clock.js tests/harness/verify-bill-mark-paid.js
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
    const PW = 'bill-paid-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'bp@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'BP Co', currency: 'USD', is_active: 1 }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.33.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'bp@finflow.test', password: PW })).status === 200);
    const mk = async (vendor, amount) => { const r = await h.post('/api/bills', { vendor, amount, status: 'unpaid', issue_date: '2026-07-05', due_date: '2026-08-05' }); return r.json.id || (r.json.row && r.json.row.id); };
    const ba = await mk('Alpha Supply', 1000), bb = await mk('Beta Supply', 800), bc = await mk('Gamma Supply', 450);
    A('bills created', ba && bb && bc, JSON.stringify([ba, bb, bc]));
    A('partial linked payment 300 on B', (await h.post('/api/payments-made', { bill_id: bb, amount: 300, vendor: 'Beta Supply', date: '2026-07-10' })).status === 200);
    const paid = async (id) => Number((await c.query(`SELECT COALESCE(SUM((data->>'amount')::numeric),0) s FROM payments_made WHERE data->>'bill_id'=$1`, [String(id)])).rows[0].s);
    const bill = async (id) => (await c.query(`SELECT data->>'status' st, (data->>'amount_paid')::numeric ap FROM bills WHERE id=$1`, [id])).rows[0];
    const outflow = async () => Number(((await h.post('/api/reports/cash-flow', {})).json || {}).totalOutflow) || 0;

    console.log('\n' + '='.repeat(78));
    console.log('  BILL MARK PAID BY EDIT — a real settling payment');
    console.log('='.repeat(78));
    const o0 = await outflow();
    A('A → paid → 200', (await h.put('/api/bills/' + ba, { status: 'paid' })).status === 200);
    A('  A linked payments Σ 1000 (bug: 0)', (await paid(ba)) === 1000, 'Σ=' + await paid(ba));
    const a = await bill(ba);
    A('  A status paid, amount_paid 1000', a.st === 'paid' && Number(a.ap) === 1000, JSON.stringify(a));
    const o1 = await outflow();
    A('  cash-flow outflow +1000 (bug: +0)', Math.round(o1 - o0) === 1000, `before=${o0} after=${o1}`);
    A('B → paid → 200', (await h.put('/api/bills/' + bb, { status: 'paid' })).status === 200);
    const b = await bill(bb);
    A('  B Σ 800 (a 500 settling payment), amount_paid 800, status paid (bug: amount_paid 300)', (await paid(bb)) === 800 && Number(b.ap) === 800 && b.st === 'paid', `Σ=${await paid(bb)} ${JSON.stringify(b)}`);
    await Promise.all([1, 2, 3].map(() => h.put('/api/bills/' + bc, { status: 'paid' })));
    const nC = Number((await c.query(`SELECT COUNT(*) n FROM payments_made WHERE data->>'bill_id'=$1`, [String(bc)])).rows[0].n);
    A('3 concurrent C → paid: exactly one settling payment of 450', nC === 1 && (await paid(bc)) === 450, `rows=${nC} Σ=${await paid(bc)}`);
    const v = await h.get('/api/gl/verify');
    A('GL books balanced', v.json && v.json.booksBalanced === true, JSON.stringify(v.json && v.json.entities && v.json.entities[0] && v.json.entities[0].detail));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (bill mark paid)` : `  ALL GREEN — ${pass} passed, 0 failed  (bill mark paid)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
