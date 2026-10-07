#!/usr/bin/env node
'use strict';
/**
 * verify-record-commission-retired.js — N81. An accountant cannot put a payout to themselves into the
 * admin payout queue.
 *
 * Defect: POST /api/accountants/record-commission inserted a 'pending' accountant_earnings row from any
 * billedAmountCents, for any or no client, with no relationship check. 'pending' earnings ARE the admin
 * payout queue (admin "mark paid" pays them). The route is retired (410).
 *
 * Executed against the real server + Postgres. Bug value stated:
 *   record-commission for a client the accountant has no link to, $1,000,000 → 410, 0 rows   (bug: 200, 1 pending row)
 *   record-commission with no client                                        → 410, 0 rows   (bug: 200, 1 pending row)
 *   admin payout queue (pending earnings) total                              → 0             (bug: > 0)
 *   node -r ./tests/harness/clock.js tests/harness/verify-record-commission-retired.js
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
    const PW = 'rc-pw-1';
    await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('rc-acc@finflow.test', $1, 'R', 'C', 'Firm', 'RCREF1', 'verified')`, [bcrypt.hashSync(PW, 10)]);
    const stranger = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'rc-stranger@finflow.test', plan: 'business', role: 'owner' }])).rows[0].id;
    const acc = new HarnessHttp(server.baseUrl, { xff: '10.81.0.1' });
    A('accountant login', (await acc.post('/api/accountants/login', { email: 'rc-acc@finflow.test', password: PW })).status === 200);
    const pending = async () => (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount_cents),0)::bigint s FROM accountant_earnings WHERE status='pending'`)).rows[0];

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT CANNOT SELF-CREDIT A PAYOUT');
    console.log('='.repeat(78));
    const r1 = await acc.post('/api/accountants/record-commission', { userId: stranger, billedAmountCents: 100000000, description: 'not a real bill' });
    A('record-commission for an unlinked client, $1,000,000 → 410 (bug: 200)', r1.status === 410, `status ${r1.status}: ${r1.text.slice(0, 120)}`);
    const r2 = await acc.post('/api/accountants/record-commission', { billedAmountCents: 500000 });
    A('record-commission with no client → 410 (bug: 200)', r2.status === 410, `status ${r2.status}`);
    const p = await pending();
    A('admin payout queue holds nothing (bug: 2 pending rows)', p.n === 0 && Number(p.s) === 0, JSON.stringify(p));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (record-commission retired)` : `  ALL GREEN — ${pass} passed, 0 failed  (record-commission retired)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
