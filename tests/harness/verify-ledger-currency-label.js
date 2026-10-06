#!/usr/bin/env node
'use strict';
/**
 * verify-ledger-currency-label.js — N61. A ledger entry carries its business's currency.
 *
 * Defect: postLedgerEntry defaulted currency to 'USD' and no caller passed one, so every entity's ledger
 * — TTD, JPY, EUR alike — was labelled USD. (Consolidation converts by the ENTITY's currency, so totals
 * were unaffected; the label itself was wrong on every entry, reversal and export.)
 *
 * Executed against the real server + Postgres. Entities: TT Co (TTD), JP Co (JPY), US Co (USD).
 * An expense in each, then one deleted (reversal). Bug value stated:
 *   TT Co entry currency = TTD; JP Co = JPY    (bug: USD for both)
 *   the reversal of the TT Co entry = TTD      (bug: USD)
 *   control: US Co = USD
 *   node -r ./tests/harness/clock.js tests/harness/verify-ledger-currency-label.js
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
    const PW = 'ledger-cur-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'lc@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const ent = async (n, cur, a) => (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: n, currency: cur, is_active: a }])).rows[0].id;
    const eT = await ent('TT Co', 'TTD', 1), eJ = await ent('JP Co', 'JPY', 0), eU = await ent('US Co', 'USD', 0);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.61.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'lc@finflow.test', password: PW })).status === 200);
    const ids = {};
    for (const [k, e] of [['T', eT], ['J', eJ], ['U', eU]]) ids[k] = (await h.post('/api/expenses?entity_id=' + e, { description: 'exp ' + k, amount: 100, expense_date: '2026-07-10' })).json.id;
    const cur = async (id, rev = false) => ((await c.query(`SELECT currency FROM ledger_entries WHERE source_type='expense' AND source_id=$1 AND (reversal_of IS ${rev ? 'NOT ' : ''}NULL) LIMIT 1`, [id])).rows[0] || {}).currency;
    console.log('\n' + '='.repeat(78));
    console.log('  LEDGER ENTRY CURRENCY = THE ENTITY\'S');
    console.log('='.repeat(78));
    A('TT Co entry currency = TTD (bug: USD)', (await cur(ids.T)) === 'TTD', 'currency=' + await cur(ids.T));
    A('JP Co entry currency = JPY (bug: USD)', (await cur(ids.J)) === 'JPY', 'currency=' + await cur(ids.J));
    A('control: US Co entry currency = USD', (await cur(ids.U)) === 'USD');
    await h.del('/api/expenses/' + ids.T + '?entity_id=' + eT);
    A('reversal of the TT Co entry = TTD (bug: USD)', (await cur(ids.T, true)) === 'TTD', 'currency=' + await cur(ids.T, true));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (ledger currency label)` : `  ALL GREEN — ${pass} passed, 0 failed  (ledger currency label)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
