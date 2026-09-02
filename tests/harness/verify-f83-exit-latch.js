'use strict';
/**
 * verify-f83-exit-latch.js — F83. A harness that PRINTS an internal failure must exit nonzero even if
 * jsdom teardown writes process.exitCode back to 0. clock.js watches console output for the runner's
 * own failure signatures and forces a nonzero exit code in a 'exit' handler (process.exitCode is
 * non-configurable, but a set inside 'exit' is honoured).
 *
 * Drives real child processes that print a summary and mutate process.exitCode, checking actual exit
 * status. Discriminating (Rule 14): pre-fix a child that prints "N FAILED" then resets exitCode=0
 * exits 0 → A1/A2 red.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f83-exit-latch.js
 */
require('./clock.js');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const run = (code) => spawnSync(process.execPath, ['-r', './tests/harness/clock.js', '-e', code], { encoding: 'utf8', cwd: process.cwd() });

try {
  // A1 — the masking scenario: harness prints a "N FAILED" summary, then teardown resets exitCode to 0.
  const r1 = run("console.log('  3 FAILED — 5 passed, 3 failed'); setImmediate(()=>{ process.exitCode = 0; });");
  A('A1: printed "N FAILED" + exitCode reset to 0 → child still exits 1', r1.status === 1, `status=${r1.status}`);

  // A2 — the "passed, M failed" tail shape, same masking.
  const r2 = run("console.log('ALL good? no: 5 passed, 2 failed'); process.exitCode = 0;");
  A('A2: printed "passed, M failed" tail → child exits 1 despite exitCode 0', r2.status === 1, `status=${r2.status}`);

  // A3 — a FATAL crash line with no exitCode set at all → still exits 1.
  const r3 = run("console.error('  FATAL: boom');");
  A('A3: printed FATAL crash line → child exits 1', r3.status === 1, `status=${r3.status}`);

  // A4 — a genuinely GREEN harness is untouched (exits 0).
  const r4 = run("console.log('  ALL GREEN — 10 passed, 0 failed'); process.exitCode = 0;");
  A('A4: ALL GREEN → child exits 0 (no false latch)', r4.status === 0, `status=${r4.status}`);

  // A5 — a benign description containing "failed" must NOT false-latch (anchored signatures).
  const r5 = run("console.log('  PASS  rejects 3 failed logins in a row'); console.log('  ALL GREEN — 4 passed, 0 failed');");
  A('A5: "3 failed logins" description does NOT false-latch → exits 0', r5.status === 0, `status=${r5.status}`);

  const clk = fs.readFileSync(path.join(process.cwd(), 'tests', 'harness', 'clock.js'), 'utf8');
  A('[STRUCTURAL] clock.js has the output-scan fail-latch + exit handler', /__ffFailSeen/.test(clk) && /process\.on\('exit'/.test(clk));

  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F83 exit-code fail-latch)`);
  console.log('');
} catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
process.exitCode = fail === 0 ? 0 : 1;
