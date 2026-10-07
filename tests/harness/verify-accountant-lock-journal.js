#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-lock-journal.js — N77 + N76. An accountant's period lock actually closes the period,
 * and an accountant's journal obeys the same rules as the owner's (balanced, not into a closed period).
 *
 * Defects:
 *   N77 — the accountant lock route wrote lock_settings { period, locked }, but isLocked() reads
 *         { enabled, lock_date }: the lock had NO effect on any write.
 *   N76 — the accountant journal route had no debit = credit check, no line check and no lock check
 *         (the owner's POST /api/journals enforces all three).
 *
 * Executed against the real server + Postgres (accountant session + owner session). Bug value stated:
 *   accountant locks 2026-06 → owner expense dated 2026-06-15 → 403   (bug: 201)
 *   control: owner expense dated 2026-07-02 → 201
 *   accountant journal dated 2026-06-20 (balanced) → 403              (bug: 201)
 *   accountant journal 100 Dr / 50 Cr → 400                           (bug: 201)
 *   accountant journal with no lines → 400                            (bug: 201)
 *   control: balanced July journal → 201
 *   accountant unlocks 2026-06 → lock_date 2026-05-31; owner June expense → 201 (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-lock-journal.js
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
    const PW = 'lockjournal-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'lj-owner@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'LJ Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('lj-acc@finflow.test', $1, 'L', 'J', 'Firm', 'LJREF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','filing','client')`, [accId, uid]);
    const O = new HarnessHttp(server.baseUrl, { xff: '10.77.1.1' });
    const ACC = new HarnessHttp(server.baseUrl, { xff: '10.77.1.2' });
    A('owner login', (await O.post('/api/auth/login', { email: 'lj-owner@finflow.test', password: PW })).status === 200);
    A('accountant login', (await ACC.post('/api/accountants/login', { email: 'lj-acc@finflow.test', password: PW })).status === 200);
    const J = (date, lines) => ACC.post(`/api/accountants/clients/${uid}/journal`, { date, description: 'Adj ' + date, lines });
    const bal = [{ account: 'Rent', debit: 100, credit: 0 }, { account: 'Cash', debit: 0, credit: 100 }];

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT PERIOD LOCK + JOURNAL RULES');
    console.log('='.repeat(78));
    const lk = await ACC.post(`/api/accountants/clients/${uid}/lock`, { period: '2026-06', locked: true });
    A('accountant locks 2026-06 → 200, lock_date 2026-06-30', lk.status === 200 && lk.json.lock_date === '2026-06-30', `status ${lk.status}: ${lk.text.slice(0, 120)}`);
    const e1 = await O.post('/api/expenses', { description: 'June expense', amount: 50, expense_date: '2026-06-15' });
    A('owner expense dated 2026-06-15 → 403 (bug: 201)', e1.status === 403, `status ${e1.status}`);
    const e2 = await O.post('/api/expenses', { description: 'July expense', amount: 60, expense_date: '2026-07-02' });
    A('control: owner expense dated 2026-07-02 → 201', e2.status === 201, `status ${e2.status}`);

    const j1 = await J('2026-06-20', bal);
    A('accountant journal into the locked June → 403 (bug: 201)', j1.status === 403, `status ${j1.status}`);
    const j2 = await J('2026-07-05', [{ account: 'Rent', debit: 100, credit: 0 }, { account: 'Cash', debit: 0, credit: 50 }]);
    A('accountant journal 100 Dr / 50 Cr → 400 (bug: 201)', j2.status === 400, `status ${j2.status}`);
    const j3 = await J('2026-07-05', []);
    A('accountant journal with no lines → 400 (bug: 201)', j3.status === 400, `status ${j3.status}`);
    const j4 = await J('2026-07-05', bal);
    A('control: balanced July journal → 201', j4.status === 201, `status ${j4.status}: ${j4.text.slice(0, 100)}`);

    const ul = await ACC.post(`/api/accountants/clients/${uid}/lock`, { period: '2026-06', locked: false });
    A('accountant unlocks 2026-06 → lock_date 2026-05-31', ul.status === 200 && ul.json.lock_date === '2026-05-31', ul.text.slice(0, 120));
    const e3 = await O.post('/api/expenses', { description: 'June expense again', amount: 50, expense_date: '2026-06-15' });
    A('control: owner June expense after unlock → 201', e3.status === 201, `status ${e3.status}`);
    const e4 = await O.post('/api/expenses', { description: 'May expense', amount: 50, expense_date: '2026-05-15' });
    A('May stays closed after reopening June → 403', e4.status === 403, `status ${e4.status}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (accountant lock + journal)` : `  ALL GREEN — ${pass} passed, 0 failed  (accountant lock + journal)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
