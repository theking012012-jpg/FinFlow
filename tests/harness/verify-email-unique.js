#!/usr/bin/env node
'use strict';
/**
 * verify-email-unique.js — N91. One account per email address, even under concurrent sign-ups.
 *
 * Defect: register checked "does this email exist?" and then inserted, with no lock and only a
 * NON-unique index on lower(email). Concurrent sign-ups (double-click, retry, two tabs) created duplicate
 * accounts; login then picked an arbitrary one (LIMIT 1, no ORDER BY).
 *
 * Executed against the real server + Postgres; a scratch-DB trigger slows each users INSERT by 300 ms so
 * the concurrent sign-ups genuinely overlap (failure injection). Bug value stated:
 *   10 concurrent registrations, same address in mixed case → exactly 1 × 201, 9 × 409   (bug: several 201)
 *   users with that email = 1                                                            (bug: > 1)
 *   unique index idx_users_email_ci_uniq exists; a raw duplicate INSERT → 23505          (DB backstop)
 *   pre-existing duplicates: initDB still succeeds, rows untouched, index reported+skipped (Rule 8)
 *   node -r ./tests/harness/clock.js tests/harness/verify-email-unique.js
 */
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
    console.log('\n' + '='.repeat(78));
    console.log('  ONE ACCOUNT PER EMAIL');
    console.log('='.repeat(78));
    // Failure injection (Rule 14): a scratch-DB trigger makes each users INSERT take 300 ms, holding the
    // check→insert window open so concurrent sign-ups really overlap (without it the race is luck).
    await c.query(`CREATE OR REPLACE FUNCTION _harness_slow_user_insert() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$ LANGUAGE plpgsql`);
    await c.query(`CREATE TRIGGER _harness_slow_user_insert BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION _harness_slow_user_insert()`);
    const variants = ['Dup@FinFlow.test', 'dup@finflow.test', 'DUP@finflow.TEST'];
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      new HarnessHttp(server.baseUrl, { xff: '10.91.0.' + (i + 1) }).post('/api/auth/register', { email: variants[i % 3], password: 'dup-password-1', name: 'Dup ' + i })));
    const codes = results.map(r => r.status);
    A('10 concurrent sign-ups → exactly one 201 (bug: several)', codes.filter(x => x === 201).length === 1, JSON.stringify(codes));
    A('  the rest → 409', codes.filter(x => x === 409).length === 9, JSON.stringify(codes));
    await c.query(`DROP TRIGGER _harness_slow_user_insert ON users`);
    const n = Number((await c.query(`SELECT COUNT(*) n FROM users WHERE lower(data->>'email')='dup@finflow.test'`)).rows[0].n);
    A('users with that email = 1 (bug: > 1)', n === 1, 'n=' + n);
    const idx = (await c.query(`SELECT 1 FROM pg_indexes WHERE indexname='idx_users_email_ci_uniq'`)).rows.length;
    A('unique index idx_users_email_ci_uniq exists', idx === 1);
    let code = null;
    try { await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1)`, [{ email: 'DUP@finflow.test' }]); } catch (e) { code = e.code; }
    A('raw duplicate INSERT rejected by the database (23505)', code === '23505', 'code=' + code);

    // Pre-existing duplicates (e.g. production rows created before this fix): boot must not fail and
    // must not modify them; the unique index is skipped and reported.
    await c.query(`DROP INDEX IF EXISTS idx_users_email_ci_uniq`);
    await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1)`, [{ email: 'old-dup@finflow.test' }]);
    await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1)`, [{ email: 'OLD-DUP@finflow.test' }]);
    let initErr = null; const logs = []; const origErr = console.error;
    console.error = (...a) => { logs.push(a.join(' ')); };
    try { await require('../../database.js').initDB(); } catch (e) { initErr = e; } finally { console.error = origErr; }
    A('initDB with pre-existing duplicates still succeeds', !initErr, initErr && initErr.message);
    A('  duplicate rows untouched (2)', Number((await c.query(`SELECT COUNT(*) n FROM users WHERE lower(data->>'email')='old-dup@finflow.test'`)).rows[0].n) === 2);
    A('  unique index not created; duplicates reported', (await c.query(`SELECT 1 FROM pg_indexes WHERE indexname='idx_users_email_ci_uniq'`)).rows.length === 0 && logs.some(l => /N91/.test(l) && /old-dup@finflow\.test/.test(l)), logs.join(' | ').slice(0, 200));
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (email unique)` : `  ALL GREEN — ${pass} passed, 0 failed  (email unique)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
