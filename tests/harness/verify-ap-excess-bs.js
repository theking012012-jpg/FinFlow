#!/usr/bin/env node
'use strict';
/**
 * verify-ap-excess-bs.js — N96. When vendor credits exceed open bills, the balance sheet still serves
 * the ledger (real cash), instead of falling back to the "cash not tracked" stub.
 *
 * Defect: the reconcile gate compared the ledger's AP (negative: credits 150 − bill 100 = −50) with the
 * canonical AP, which floors at 0 — never equal, so the balance sheet always fell back to the oracle
 * (cash null, assets = AR only) for any business holding more vendor credit than it owes.
 *
 * Executed against the real server + Postgres. Seed: bill 100 unpaid (2026-07-01), vendor credit 150
 * open (2026-07-02), invoice 400 paid on creation (gives the ledger cash). Bug value stated:
 *   balance sheet source = gl, cashTracked = true, cash = 400     (bug: source computeBooks, cash null)
 *   control: with the credit reduced to 60 (< bill) it also serves gl
 *   node -r ./tests/harness/clock.js tests/harness/verify-ap-excess-bs.js
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
    const PW = 'ap-excess-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'apx@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'APX Co', currency: 'USD', is_active: 1 }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.96.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'apx@finflow.test', password: PW })).status === 200);
    await h.post('/api/invoices', { client: 'Cust', amount: 400, status: 'paid', issue_date: '2026-07-01' });
    await h.post('/api/bills', { vendor: 'V', amount: 100, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-31' });
    const vc = await h.post('/api/vendor-credits', { vendor: 'V', amount: 150, date: '2026-07-02', status: 'Open' });
    const bs = async () => (await h.post('/api/reports/balance-sheet', {})).json || {};   // the balance-sheet REPORT (reconcile-gated: gl or the computeBooks stub)
    console.log('\n' + '='.repeat(78));
    console.log('  BALANCE SHEET WITH VENDOR CREDITS ABOVE OPEN BILLS');
    console.log('='.repeat(78));
    const b1 = await bs();
    A('serves the ledger: source gl, cash tracked, cash 400 (bug: computeBooks stub, cash null)', b1.source === 'gl' && b1.cashTracked === true && Number(b1.cash) === 400, JSON.stringify(b1).slice(0, 220));
    await h.put('/api/vendor-credits/' + vc.json.id, { amount: 60 });
    const b2 = await bs();
    A('control: credit 60 (< bill 100) also serves gl', b2.source === 'gl', JSON.stringify(b2).slice(0, 160));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (AP excess balance sheet)` : `  ALL GREEN — ${pass} passed, 0 failed  (AP excess balance sheet)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
