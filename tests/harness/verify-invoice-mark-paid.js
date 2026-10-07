#!/usr/bin/env node
'use strict';
/**
 * verify-invoice-mark-paid.js — N11. Editing an invoice to 'paid' records a real payment for the
 * outstanding balance, so cash flow and the ledger see the money.
 *
 * Defect: PUT /api/invoices/:id with status 'paid' only stamped amount_paid (and only when no payments
 * existed). No invoice_payments row → the cash-flow report (reads invoice_payments) never saw the cash,
 * and the ledger kept AR open (no Dr Cash / Cr AR) while the books said paid. With a prior partial
 * payment the flip left status 'paid' with amount_paid still partial.
 *
 * Executed against the real server + Postgres. Seeds (Rule 4 — distinct numbers): invoice A 1000
 * pending; invoice B 800 with a 300 payment; invoice C 450 for the concurrency check. Bug value stated:
 *   A → paid: payments Σ 1000, amount_paid 1000, cash-flow inflow +1000      (bug: Σ 0, inflow +0)
 *   B → paid: a 500 settling payment, amount_paid 800, status paid           (bug: amount_paid 300)
 *   3 concurrent C → paid: exactly one settling payment of 450               (bug: n/a / doubles)
 *   GL: books balanced, ledger AR tied to the books                          (bug: AR open in GL)
 *   node -r ./tests/harness/clock.js tests/harness/verify-invoice-mark-paid.js
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
    const PW = 'mark-paid-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'mp@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'MP Co', currency: 'USD', is_active: 1 }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.11.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'mp@finflow.test', password: PW })).status === 200);
    const mk = async (client, amount) => (await h.post('/api/invoices', { client, amount, status: 'pending', issue_date: '2026-07-05', due_date: '2026-08-05' })).json.id;
    const ia = await mk('Alpha', 1000), ib = await mk('Beta', 800), ic = await mk('Gamma', 450);
    A('partial payment 300 on B → 201', (await h.post('/api/invoice-payments', { invoice_id: ib, amount: 300, payment_date: '2026-07-10' })).status === 201);
    const paid = async (id) => Number((await c.query(`SELECT COALESCE(SUM(amount),0) s FROM invoice_payments WHERE invoice_id=$1`, [id])).rows[0].s);
    const inv = async (id) => (await c.query(`SELECT data->>'status' st, (data->>'amount_paid')::numeric ap FROM invoices WHERE id=$1`, [id])).rows[0];
    const inflow = async () => Number(((await h.post('/api/reports/cash-flow', {})).json || {}).totalInflow) || 0;

    console.log('\n' + '='.repeat(78));
    console.log('  MARK PAID BY EDIT — a real settling payment');
    console.log('='.repeat(78));
    const in0 = await inflow();
    A('A → paid → 200', (await h.put('/api/invoices/' + ia, { status: 'paid' })).status === 200);
    A('  A payments Σ 1000 (bug: 0)', (await paid(ia)) === 1000, 'Σ=' + await paid(ia));
    const a = await inv(ia);
    A('  A status paid, amount_paid 1000', a.st === 'paid' && Number(a.ap) === 1000, JSON.stringify(a));
    const in1 = await inflow();
    A('  cash-flow inflow +1000 (bug: +0)', Math.round(in1 - in0) === 1000, `before=${in0} after=${in1}`);

    A('B → paid → 200', (await h.put('/api/invoices/' + ib, { status: 'paid' })).status === 200);
    const b = await inv(ib);
    A('  B payments Σ 800 (a 500 settling payment), amount_paid 800, status paid (bug: amount_paid 300)', (await paid(ib)) === 800 && Number(b.ap) === 800 && b.st === 'paid', `Σ=${await paid(ib)} ${JSON.stringify(b)}`);

    await Promise.all([1, 2, 3].map(() => h.put('/api/invoices/' + ic, { status: 'paid' })));
    const nC = Number((await c.query(`SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=$1`, [ic])).rows[0].n);
    A('3 concurrent C → paid: exactly one settling payment of 450', nC === 1 && (await paid(ic)) === 450, `rows=${nC} Σ=${await paid(ic)}`);

    const v = await h.get('/api/gl/verify');
    A('GL: books balanced and AR tied (bug: AR open in the ledger)', v.json && v.json.booksBalanced === true, JSON.stringify(v.json && v.json.entities && v.json.entities[0] && v.json.entities[0].detail));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (invoice mark paid)` : `  ALL GREEN — ${pass} passed, 0 failed  (invoice mark paid)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
