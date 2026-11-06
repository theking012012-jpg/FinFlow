'use strict';
/**
 * verify-f83-gates-strict — F83, decided 2026-11-06: the money gates are always strict. A gate that could not check
 * (step4: a viewer produced no fingerprint) is a failure — non-zero exit, counted "1 FAILED", red in the sweep.
 *
 * Executed: the real step4-client-gate with S4_NO_FP=1 (every viewer produces nothing), directly and through the real
 * sweep runner. Bug values (old code): it printed "0 FAILED — cannot proceed", exited 0, and the sweep counted it PASS.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f83-gates-strict.js
 */
const path = require('path');
const { spawnSync } = require('child_process');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const env = Object.assign({}, process.env, { S4_NO_FP: '1' });
console.log('\nF83 — a gate that could not check is a failure\n');
const direct = spawnSync(process.execPath, [path.join(__dirname, 'step4-client-gate.js')], { encoding: 'utf8', env, timeout: 120000 });
A('step4 with no fingerprints, run WITHOUT clock.js: exits 1 (bug: 0)', direct.status === 1, `exit ${direct.status}`);
A('…and says "1 FAILED" (bug: "0 FAILED")', /\b1 FAILED — cannot proceed/.test(direct.stdout), (direct.stdout || '').slice(-200));
const sw = spawnSync(process.execPath, ['-r', path.join(__dirname, 'clock.js'), path.join(__dirname, 'run-verification-sweep.js')], { encoding: 'utf8', env: Object.assign({}, env, { SWEEP_ONLY: 'step4-client-gate' }), timeout: 300000 });
const line = (sw.stdout.split('\n').find(l => /step4-client-gate/.test(l)) || '').trim();
A('through the sweep: step4 is red (bug: PASS "passed (exit 0)")', /^FAIL\s/.test(line) && sw.status === 1, `${line} | sweep exit ${sw.status}`);
console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F83 gates strict)\n`);
process.exitCode = fail ? 1 : 0;
