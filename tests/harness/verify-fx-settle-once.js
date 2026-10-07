#!/usr/bin/env node
'use strict';
/**
 * verify-fx-settle-once.js — N66. An FX position settles once; the books' realised gain/loss and the
 * ledger's always carry the same figure.
 *
 * Defect: POST /api/fx-transactions/:id/settle had no state guard. A second settle overwrote
 * realised_gain_loss and settled_at, while the ledger posting (idempotent on fx_settle:<id>) kept the
 * FIRST figure — the FX line on the dashboard and the ledger then disagreed. A junk rate stored NaN.
 *
 * Seed: EUR 1000 @ 1.10. Settle at 1.20 → realised +100 (hand-computed: (1.20 − 1.10) × 1000).
 *   second settle at 1.30 → 409 ALREADY_SETTLED, realised stays 100   (bug: 200, realised 200, ledger 100)
 *   ledger: one fx_settle entry, account 7000 credited 100
 *   two CONCURRENT settles on a fresh position → exactly one 200        (bug: both 200)
 *   rate "abc" → 400                                                     (bug: NaN stored)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fx-settle-once.js
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
    const PW = 'fx-settle-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'fx1@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { name: 'FX Co', currency: 'USD', is_active: 1 }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.66.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'fx1@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  FX POSITION SETTLES ONCE');
    console.log('='.repeat(78));
    const tx = (await h.post('/api/fx-transactions', { foreign_currency: 'EUR', foreign_amount: 1000, rate_at_transaction: 1.10 })).json;
    A('position created', tx && tx.id, JSON.stringify(tx));
    const s1 = await h.post(`/api/fx-transactions/${tx.id}/settle`, { rate_at_settlement: 1.20 });
    A('first settle at 1.20 → 200, realised +100', s1.status === 200 && Number(s1.json.realised_gain_loss) === 100, `status ${s1.status} ${s1.text.slice(0, 120)}`);
    const s2 = await h.post(`/api/fx-transactions/${tx.id}/settle`, { rate_at_settlement: 1.30 });
    A('second settle → 409 ALREADY_SETTLED (bug: 200)', s2.status === 409 && s2.json && s2.json.code === 'ALREADY_SETTLED', `status ${s2.status}`);
    const row = (await c.query(`SELECT realised_gain_loss, rate_at_settlement FROM fx_transactions WHERE id=$1`, [tx.id])).rows[0];
    A('  realised_gain_loss stays 100 (bug: 200)', Number(row.realised_gain_loss) === 100 && Number(row.rate_at_settlement) === 1.2, JSON.stringify(row));
    const gl = (await c.query(`SELECT la.code, SUM(ll.credit) - SUM(ll.debit) AS net FROM ledger_entries le JOIN ledger_lines ll ON ll.entry_id = le.id JOIN ledger_accounts la ON la.id = ll.account_id
                              WHERE le.source_type='fx_settle' AND le.source_id=$1 AND la.code='7000' GROUP BY la.code`, [tx.id])).rows[0];
    A('  ledger: 7000 FX gain credited 100 — equals the books', gl && Number(gl.net) === 100, JSON.stringify(gl));

    const tx2 = (await h.post('/api/fx-transactions', { foreign_currency: 'GBP', foreign_amount: 500, rate_at_transaction: 1.25 })).json;
    const both = await Promise.all([h.post(`/api/fx-transactions/${tx2.id}/settle`, { rate_at_settlement: 1.30 }), h.post(`/api/fx-transactions/${tx2.id}/settle`, { rate_at_settlement: 1.40 })]);
    const ok = both.filter(r => r.status === 200).length, conflict = both.filter(r => r.status === 409).length;
    A('two concurrent settles → exactly one 200 and one 409 (bug: two 200s)', ok === 1 && conflict === 1, both.map(r => r.status).join(','));

    const tx3 = (await h.post('/api/fx-transactions', { foreign_currency: 'JPY', foreign_amount: 10000, rate_at_transaction: 0.007 })).json;
    const bad = await h.post(`/api/fx-transactions/${tx3.id}/settle`, { rate_at_settlement: 'abc' });
    A('settle with rate "abc" → 400 (bug: NaN realised)', bad.status === 400, `status ${bad.status}`);
    const r3 = (await c.query(`SELECT status, realised_gain_loss FROM fx_transactions WHERE id=$1`, [tx3.id])).rows[0];
    A('  position still open', r3.status !== 'settled', JSON.stringify(r3));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (FX settle once)` : `  ALL GREEN — ${pass} passed, 0 failed  (FX settle once)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
