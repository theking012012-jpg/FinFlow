'use strict';
/**
 * verify-restore-drill-guard.js — A5 (§1.7). scripts/restore-drill.sh runs `pg_restore --clean` (DROPS objects) into
 * DEST. Its only guard refused a DEST containing "prod" — a Supabase / Railway production URL never does, so DEST =
 * the production database (a copy-paste slip) would drop and overwrite production.
 *
 * Runs the REAL script under bash with FAKE pg_dump / pg_restore / psql first on PATH. Each fake records that it was
 * called (a file in a temp dir) and succeeds, so the script's own logic runs end to end without a database:
 *   1  DEST = SRC (same host:port/db, different user/password/query, different case) → exit 2, REFUSING, and
 *      pg_dump / pg_restore NEVER called                                              bug: proceeds, both called
 *   2  DEST = a different database → guard passes: pg_dump + pg_restore called, "RESTORE DRILL PASSED"   (control)
 *   3  DEST containing "prod" → refused (existing guard — control)
 *   4  no URL / password is echoed to the output
 * NOT executed here (labelled): a real dump/restore — this machine has no pg_dump / pg_restore / psql (the bundled
 * embedded-postgres ships only the server). The real drill is the owner's step (OWNER_ACTIONS §9).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'restore-drill.sh');
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

// Git Bash on Windows (never System32\bash.exe — that is WSL, with a different filesystem view).
function findBash() {
  const cands = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
    : ['/bin/bash', '/usr/bin/bash'];
  return cands.find(p => fs.existsSync(p)) || null;
}

console.log('\nA5 — restore drill refuses DEST = SRC before touching any database\n');
const bash = findBash();
if (!bash) {
  console.log('  SKIPPED — no Git Bash / bash found; the guard could not be executed on this machine.');
  console.log('\n  ALL GREEN — 0 passed, 0 failed (SKIPPED: no bash)\n');
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finflow-harness-restoredrill-'));
const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
const calls = path.join(tmp, 'calls.log');
const toPosix = p => p.replace(/^([A-Za-z]):\\/, (_, d) => '/' + d.toLowerCase() + '/').replace(/\\/g, '/');
for (const tool of ['pg_dump', 'pg_restore', 'psql']) {
  // pg_dump -f <file>: create the file so `du` works. psql: print a count.
  fs.writeFileSync(path.join(bin, tool), `#!/usr/bin/env bash
echo "${tool}" >> "${toPosix(calls)}"
if [ "${tool}" = "pg_dump" ]; then while [ $# -gt 0 ]; do if [ "$1" = "-f" ]; then echo dump > "$2"; fi; shift; done; fi
if [ "${tool}" = "psql" ]; then echo 5; fi
exit 0
`, { mode: 0o755 });
}
const run = (env) => {
  try { fs.unlinkSync(calls); } catch (_) {}
  const r = spawnSync(bash, [toPosix(SCRIPT)], {
    encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, process.env, { PATH: toPosix(bin) + ':' + (process.platform === 'win32' ? '/usr/bin:/bin' : process.env.PATH), SRC: '', DUMP: '', DEST: '' }, env),
  });
  const called = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), called };
};

const SRC = 'postgresql://postgres.abcd:S3cretPw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require';
const SAME = 'postgresql://other_user:0therPw@AWS-0-US-EAST-1.POOLER.SUPABASE.COM:5432/postgres';
const r1 = run({ SRC, DEST: SAME });
eq('1  DEST = SRC → exit 2', r1.status, 2, 0);
eq('1  … says REFUSING', /REFUSING: DEST is the same database as SRC/.test(r1.out), true, false);
eq('1  … pg_dump / pg_restore never called', r1.called.filter(c => c !== 'psql'), [], ['pg_dump', 'pg_restore']);

const r2 = run({ SRC, DEST: 'postgresql://postgres:pw@localhost:55432/finflow_scratch' });
eq('2  DEST = a scratch database → exit 0, drill passes', [r2.status, /RESTORE DRILL PASSED/.test(r2.out)], [0, true]);
eq('2  … pg_dump then pg_restore called', r2.called.filter(c => c !== 'psql'), ['pg_dump', 'pg_restore']);

const r3 = run({ SRC, DEST: 'postgresql://u:p@prod-db.example.com:5432/app' });
eq('3  DEST containing "prod" → refused (existing guard)', [r3.status, r3.called.length], [2, 0]);

eq('4  no password echoed in any run', [r1, r2, r3].some(r => /S3cretPw|0therPw/.test(r.out)), false);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
