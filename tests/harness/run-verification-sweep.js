#!/usr/bin/env node
'use strict';
/**
 * run-verification-sweep.js — the FULL cold sweep (VERIFICATION.md sweep rule 1: run EVERY check
 * before fixing anything). Runs every verification harness sequentially against its own real
 * embedded-Postgres cluster, tallies PASS/FAIL, and prints a green/red map + a frozen failure list.
 *
 *   node tests/harness/run-verification-sweep.js
 *
 * Options (env):
 *   SWEEP_TIMEOUT_MS=180000   per-harness timeout (default 180s)
 *   SWEEP_ONLY=bank,f137      only run harnesses whose name contains one of these comma-sep substrings
 *
 * Exit code 0 = all green, 1 = one or more red (so CI / a pre-launch gate can consume it).
 * Sequential by design — each harness boots its own Postgres on a fresh port; running them in
 * parallel would race on shared-memory / ports.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HARNESS_DIR = path.join('tests', 'harness');
// node's `-r` resolves like require() from cwd — a bare "tests/harness/clock.js" is treated as a
// package and fails. A "./"-prefixed, forward-slash path is a relative path on Windows + POSIX both.
const CLOCK = './tests/harness/clock.js';

// Non-conforming test names (not verify-*/​-gate) that ARE real checks.
const EXTRA_TESTS = new Set([
  'tz-matrix.js', 'tz-probe.js', 'f57-cash-card.js', 'f64-money-formatter.js',
  'f120-chart-axis-currency.js', 'f123-balance-sheet-cash.js', 'f124-native-currency-surfaces.js',
  'f128-reports-canonical-source.js', 'f130-trial-expired-paywall.js', 'f145-render-smoke.js',
  'b3-payroll-nav-order.js', 'b4-2-3-payroll-pl-transition.js', 'b4-4-payroll-cash-transition.js',
  'c2-runtime-dialog-scan.js', 'finflow-dates.test.js',
]);
// Libraries / tools / this runner — never executed as a pass/fail test.
const DENY = new Set([
  'boot.js', 'clock.js', 'guard.js', 'httpClient.js', 'pgScratch.js', 'seed.js', 'seedData.js',
  'vocabulary.js', 'jsdomBoot.js', 'expected.js', 'periods.js', 'query.js', 'substrate.js',
  'drift.js', 'measure-boot-requests.js', 'verification-sync.js', 'jsdom-spike.js',
  'f145-introspect.js', 'run-verification-sweep.js',
]);

const only = (process.env.SWEEP_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const TIMEOUT = parseInt(process.env.SWEEP_TIMEOUT_MS || '180000', 10);

let tests = fs.readdirSync(HARNESS_DIR)
  .filter(f => f.endsWith('.js') && !f.startsWith('.'))
  .filter(f => (/^verify-.*\.js$/.test(f) || /-gate\.js$/.test(f) || EXTRA_TESTS.has(f)) && !DENY.has(f))
  .filter(f => !only.length || only.some(sub => f.includes(sub)))
  .sort();

console.log(`\nFinFlow verification sweep — ${tests.length} harnesses, sequential, ${TIMEOUT / 1000}s timeout each.\n`);

const results = [];
for (const f of tests) {
  const started = Date.now();
  const r = spawnSync(process.execPath, ['-r', CLOCK, path.join(HARNESS_DIR, f)], {
    encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  const exitOk = !timedOut && r.status === 0;

  // A harness reports its own verdict two ways in its LAST summary line:
  //   green →  "ALL GREEN - N passed, 0 failed"
  //   red   →  "M FAILED - K passed, M failed"  (M >= 1; the "ALL GREEN" branch never prints "0 FAILED")
  // Exit code alone is NOT trustworthy: every jsdom harness reports failure via `process.exitCode = 1`
  // (deferred), which some node/OS + jsdom-teardown combos drop back to 0 — an internally-failed harness
  // then exits 0 and slips through as green (the F83 masking hazard). So we ALSO scan the output for a
  // nonzero internal tally and a FATAL/PROBE crash, and treat EITHER as red regardless of exit code.
  const green = out.match(/ALL GREEN[^\n]*/g);
  const red = out.match(/\d+ FAILED[^\n]*/g);
  // Anchor to the two summary shapes only, so a check DESCRIPTION containing "3 failed logins" can't
  // false-red: capital "N FAILED" appears solely in failure summaries ("7 FAILED —", "7 FAILED,"),
  // and "K passed, M failed" (M>=1) is the green/red tail with a nonzero fail count.
  const nonzeroTally = /\b[1-9]\d*\s+FAILED\b/.test(out) || /\bpassed,\s*[1-9]\d*\s+failed\b/.test(out);
  const crashed = /\bFATAL:|PROBE ERROR\b/.test(out);
  const internalFail = nonzeroTally || crashed;
  const ok = exitOk && !internalFail;
  const masked = exitOk && internalFail;   // process said 0, but the harness reported failures

  const base = timedOut ? 'TIMEOUT'
    : red && !green ? red[red.length - 1].trim()
    : red && green ? red[red.length - 1].trim()          // both present → still surface the failure
    : green ? green[green.length - 1].trim()
    : crashed ? 'CRASH (FATAL / PROBE ERROR — no summary line)'
    : (exitOk ? 'passed (exit 0)' : `failed (exit ${r.status})`);
  const summary = masked ? `MASKED — exit 0 but reported: ${base}` : base;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  results.push({ f, ok, summary, out, masked });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${f.padEnd(46)} ${summary}  (${secs}s)`);
}

const failed = results.filter(r => !r.ok);
const maskedCount = results.filter(r => r.masked).length;
console.log('\n' + '='.repeat(78));
console.log(`  SWEEP COMPLETE — ${results.length - failed.length}/${results.length} GREEN, ${failed.length} RED`
  + (maskedCount ? `  (${maskedCount} of the reds were EXIT-0 MASKED — internally failed but exited 0)` : ''));
console.log('='.repeat(78));

if (failed.length) {
  console.log('\nFROZEN FAILURE LIST (sweep rule 2 — fix the whole list, then re-run every check):\n');
  for (const r of failed) {
    console.log(`──── ${r.f}  [${r.summary}] ────`);
    const lines = r.out.split('\n').filter(l => l.trim());
    console.log(lines.slice(-18).map(l => '    ' + l).join('\n') || '    (no output)');
    console.log('');
  }
}
process.exit(failed.length ? 1 : 0);
