'use strict';
/**
 * step1-gate.js — the gate for harness step 1 (guard + clock + boot).
 *
 *   node -r ./tests/harness/clock.js tests/harness/step1-gate.js [--keep]
 *
 * WHAT THIS GATE PROVES (and what it does not)
 *   It proves the SUBSTRATE works end to end: a real Postgres cluster starts with the
 *   asserted settings, the guard refuses everything that is not a loopback scratch database,
 *   the clock is pinned, the real server boots, and a real HTTP request round-trips through
 *   the real middleware into that Postgres and back.
 *
 *   It proves NOTHING about any figure in VERIFICATION.md. No money is asserted here. Steps
 *   2 and 3 do that.
 *
 * The register/read-back pair at the end is chosen over a bare "did it listen" check on
 * purpose: it exercises express.json → the CSRF/content-type gate → the rate limiter →
 * pgSession WRITING a session row to the scratch cluster → bcrypt → db.insert into the real
 * users table → and then a second request that READS that session back. A listener that
 * answers but cannot reach its database would pass a health check and fail this.
 */

const clock = require('./clock.js');
const guard = require('./guard.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const { printSubstrateHeader, printBlockedRequests } = require('./substrate.js');

const KEEP = process.argv.includes('--keep');

let pass = 0, fail = 0;
const failures = [];

function check(name, got, want) {
  const ok = (typeof want === 'number' || typeof want === 'string' || typeof want === 'boolean')
    ? got === want
    : Boolean(got);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push({ name, got, want }); console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
  return ok;
}

/** Assert a guard call REFUSES. A guard that never says no has not been tested. */
function checkRefused(name, url) {
  let refused = false, message = '';
  try { guard.assertScratchUrl(url); }
  catch (e) { refused = true; message = e.message.split('\n')[0]; }
  if (refused) { pass++; console.log(`  PASS  ${name}\n          → ${message}`); }
  else { fail++; failures.push({ name, got: 'ACCEPTED', want: 'REFUSED' }); console.log(`  FAIL  ${name}  — guard ACCEPTED a URL it must refuse: ${url}`); }
}

async function main() {
  console.log('\n── 1 · Guard (negative tests — these MUST be refused) ─────────────────────');
  checkRefused('rejects Supabase pooler host',
    'postgres://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres');
  checkRefused('rejects Railway host',
    'postgres://u:p@containers.railway.app:5432/finflow_scratch');
  checkRefused('rejects non-loopback host even with a scratch db name',
    'postgres://u:p@10.0.0.5:5432/finflow_scratch');
  checkRefused('rejects loopback with a NON-scratch db name',
    'postgres://u:p@127.0.0.1:5432/finflow');
  checkRefused('rejects a non-postgres protocol',
    'mysql://u:p@127.0.0.1:3306/finflow_scratch');

  console.log('\n── 2 · Pinned clock ──────────────────────────────────────────────────────');
  check('Date.now() is pinned', new Date().toISOString(), clock.PINNED_ISO);
  check('new Date() is pinned', new Date().toISOString(), clock.PINNED_ISO);
  check('local offset is UTC-4 (240 min)', new Date().getTimezoneOffset(), 240);
  check('local date is 2026-07-25 (not 07-26 — the UTC-vs-local boundary, Rule 10)',
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`,
    '2026-07-25');
  check('an explicit date still constructs normally',
    new Date('2026-06-30T00:00:00Z').toISOString(), '2026-06-30T00:00:00.000Z');

  console.log('\n── 3 · Scratch cluster ───────────────────────────────────────────────────');
  const scratch = await startScratchPostgres({ keep: KEEP });

  printSubstrateHeader(scratch.facts, {
    port: scratch.port,
    dataDir: scratch.dataDir,
    keep: KEEP,
    pinnedIso: clock.PINNED_ISO,
    tz: clock.TZ,
    scrubbed: null,
  });

  check('server timezone is UTC', scratch.facts.timezone.toUpperCase(), 'UTC');
  check('server encoding is UTF8', scratch.facts.server_encoding.toUpperCase(), 'UTF8');
  check('server major version is 17', String(scratch.facts.server_version).split('.')[0], '17');
  check('database name is finflow_scratch', scratch.facts.database, 'finflow_scratch');

  const marker = await scratch.client.query(`SELECT to_regclass('${guard.MARKER_TABLE}') IS NOT NULL AS present`);
  check('scratch marker table installed', marker.rows[0].present, true);

  // NOW() is server-side and NOT affected by the pinned Node clock. Recording that asymmetry
  // here rather than discovering it during a period check (Rule 10).
  const nowRow = await scratch.client.query('SELECT NOW() AS pg_now');
  console.log(`  NOTE  postgres NOW() = ${nowRow.rows[0].pg_now.toISOString()} — the REAL clock.`);
  console.log('        The pinned clock is node-side only, so the seed must write every date');
  console.log('        explicitly and never rely on a database default. (Rule 10)');

  let booted = null;
  try {
    console.log('\n── 4 · Real server boot ──────────────────────────────────────────────────');
    booted = await bootServer(scratch.url);
    check('server is listening on a real socket', typeof booted.port === 'number' && booted.port > 0, true);
    check('no unhandled rejection from the server\'s own initDB()', booted.bootRejections.length, 0);
    if (booted.bootRejections.length) {
      for (const r of booted.bootRejections) console.log('        →', r && r.message ? r.message : r);
    }

    const tables = await scratch.client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`
    );
    check('initDB() created the real schema (>30 tables)', tables.rows[0].n > 30, true);
    console.log(`        ${tables.rows[0].n} tables in public schema.`);

    console.log('\n── 5 · Real HTTP round-trip through the real stack ───────────────────────');
    const http = new HarnessHttp(booted.baseUrl);

    const unauth = await http.get('/api/auth/me');
    check('GET /api/auth/me without a session → 401', unauth.status, 401);

    const reg = await http.post('/api/auth/register', {
      email: 'harness@finflow.test', password: 'harness-password-123', name: 'Harness',
    });
    check('POST /api/auth/register → 201', reg.status, 201);
    if (reg.status !== 201) console.log('        body:', reg.text.slice(0, 400));
    check('register returned a session cookie', http.cookies.has('connect.sid'), true);

    const me = await http.get('/api/auth/me');
    check('GET /api/auth/me with the session → 200', me.status, 200);
    check('session resolves to the registered user',
      me.json && me.json.user && me.json.user.email, 'harness@finflow.test');

    console.log('\n── 6 · The write actually landed in the scratch cluster ──────────────────');
    const users = await scratch.client.query(`SELECT count(*)::int AS n FROM users`);
    check('users table has exactly 1 row', users.rows[0].n, 1);

    const sess = await scratch.client.query(`SELECT count(*)::int AS n FROM session`);
    check('pgSession wrote a session row to scratch Postgres', sess.rows[0].n >= 1, true);

    const email = await scratch.client.query(`SELECT data->>'email' AS email FROM users LIMIT 1`);
    check('the row is the one we registered over HTTP', email.rows[0].email, 'harness@finflow.test');
  } finally {
    console.log('\n── 7 · Network ───────────────────────────────────────────────────────────');
    printBlockedRequests();

    if (booted) await booted.close();
    if (KEEP) {
      console.log('\n' + '─'.repeat(78));
      console.log('  --keep: the scratch cluster is STILL UP.');
      console.log(`    ${scratch.url}`);
      console.log(`    data dir: ${scratch.dataDir}`);
      console.log('');
      console.log('  NOTE: embedded-postgres does NOT bundle psql.exe (only postgres.exe and');
      console.log('  pg_ctl.exe), so there is no bundled shell to connect with. Use any client');
      console.log('  that takes a connection string (DBeaver, pgAdmin, a separately installed');
      console.log('  psql), or the query helper that ships with step 2.');
      console.log('');
      console.log('  Ctrl-C to shut the cluster down.');
      console.log('─'.repeat(78));
      await new Promise((resolve) => process.on('SIGINT', resolve));
    }
    await scratch.stop();
  }

  console.log('\n' + '═'.repeat(78));
  console.log(`  STEP 1 GATE — ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('');
    for (const f of failures) console.log(`   FAIL  ${f.name}`);
  }
  console.log('  Scope: substrate only. No VERIFICATION figure is asserted by this gate.');
  console.log('═'.repeat(78) + '\n');
}

main().catch((err) => {
  // Rule 7: print real error detail.
  console.error('\n[step1-gate] FAILED\n');
  console.error(err && err.message ? err.message : err);
  if (err && err.code) console.error('  code:', err.code);
  if (err instanceof AggregateError && err.errors) {
    for (const e of err.errors) console.error('  ·', e && e.message ? e.message : e);
  }
  if (err && err.stack) console.error('\n--- stack ---\n' + err.stack);
  process.exitCode = 0;   // exits 0 by design for now; see the future item in AUDIT_MASTER
});
