#!/usr/bin/env node
'use strict';
/**
 * verify-sweep-runner-timer.js — 0a (2026-10-21). The owner's sweep printed "(0.0s)" for all 576 harnesses.
 *
 * Question: is the timer display broken, or are the harnesses not executing?
 * Read: the documented command is `node -r ./tests/harness/clock.js tests/harness/run-verification-sweep.js`,
 * so clock.js pins Date.now() INSIDE THE RUNNER too — `started` and `Date.now()` are both PINNED_MS → 0.0s.
 *
 * This harness runs the REAL runner (this repo's run-verification-sweep.js, unmodified path) exactly the way the
 * owner does — under `-r ./tests/harness/clock.js` — against a scratch tests/harness/ dir of four fixture harnesses:
 *   verify-zz-slow.js    sleeps 1.5 s (real time), then reports ALL GREEN
 *   verify-zz-broken.js  reports "1 FAILED", exit 1                       (a deliberately broken harness)
 *   verify-zz-masked.js  reports "1 FAILED" but exits 0                   (F83 masking)
 *   verify-zz-crash.js   throws                                           (no summary line)
 * and asserts on the runner's executed output:
 *   - the slow harness's displayed time is >= 1.0 s        (bug: "(0.0s)")
 *   - broken / masked / crash are each reported FAIL, the summary is 1/4 GREEN, the exit code is 1
 *     (proves the sweep reports a broken harness RED — i.e. harnesses really execute and are graded)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO, 'tests', 'harness', 'run-verification-sweep.js');

let pass = 0, fail = 0;
const A = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finflow-harness-sweeptimer-'));
const hdir = path.join(tmp, 'tests', 'harness');
fs.mkdirSync(hdir, { recursive: true });
// clock.js + the seed it cross-checks (pure data) — the same pinned clock the owner's command loads.
fs.copyFileSync(path.join(REPO, 'tests', 'harness', 'clock.js'), path.join(hdir, 'clock.js'));
fs.copyFileSync(path.join(REPO, 'tests', 'harness', 'seedData.js'), path.join(hdir, 'seedData.js'));

const fixtures = {
  'verify-zz-slow.js':
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);\n"
    + "console.log('  ALL GREEN — 1 passed, 0 failed');\n",
  'verify-zz-broken.js':
    "console.log('  FAIL  deliberately broken');\nconsole.log('  1 FAILED — 0 passed, 1 failed');\nprocess.exitCode = 1;\n",
  'verify-zz-masked.js':
    "console.log('  1 FAILED — 0 passed, 1 failed');\nprocess.on('exit', () => { process.exitCode = 0; });\n",
  'verify-zz-crash.js':
    "throw new Error('deliberate crash');\n",
};
for (const [f, src] of Object.entries(fixtures)) fs.writeFileSync(path.join(hdir, f), src);

const r = spawnSync(process.execPath, ['-r', './tests/harness/clock.js', RUNNER], {
  cwd: tmp, encoding: 'utf8', timeout: 120000,
  // The outer sweep's SWEEP_ONLY would filter the fixtures out (0/0) — the inner run must see all four.
  env: Object.assign({}, process.env, { SWEEP_ONLY: '' }),
});
const out = (r.stdout || '') + (r.stderr || '');

const line = (name) => out.split('\n').find(l => l.includes(name)) || '';
const secsOf = (l) => { const m = l.match(/\((\d+(?:\.\d+)?)s\)\s*$/); return m ? parseFloat(m[1]) : NaN; };

// Echo only verdict + displayed time per fixture — never the fixtures' own "1 FAILED" tallies: both clock.js's F83
// fail-latch and the OUTER sweep grade this harness by scanning its output, and those lines would false-red it.
console.log('\n── runner verdicts (fixture sweep) ──');
for (const f of Object.keys(fixtures).sort()) {
  const l = line(f);
  console.log('    ' + ((l.match(/^\s*(PASS|FAIL)/) || [, '?'])[1]) + '  ' + f.padEnd(22) + ' displayed ' + secsOf(l) + 's');
}
console.log('\n── assertions ──');

const slow = line('verify-zz-slow.js');
A('slow harness (1.5 s real) is reported PASS', /^\s*PASS\s/.test(slow), slow.trim());
A('slow harness displayed time >= 1.0 s (bug: "(0.0s)" — runner Date.now() pinned by clock.js)',
  secsOf(slow) >= 1.0, 'displayed ' + secsOf(slow) + 's');
A('deliberately broken harness reported FAIL', /^\s*FAIL\s/.test(line('verify-zz-broken.js')), line('verify-zz-broken.js').trim());
A('exit-0 masked harness reported FAIL (MASKED)', /^\s*FAIL\s.*MASKED/.test(line('verify-zz-masked.js')), line('verify-zz-masked.js').trim());
A('crashing harness reported FAIL', /^\s*FAIL\s/.test(line('verify-zz-crash.js')), line('verify-zz-crash.js').trim());
A('summary says 1/4 GREEN, 3 RED', /SWEEP COMPLETE — 1\/4 GREEN, 3 RED/.test(out), (out.match(/SWEEP COMPLETE[^\n]*/) || ['(none)'])[0]);
A('runner exit code is 1', r.status === 1, 'status ' + r.status);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }

console.log('\n' + (fail === 0 ? '  ALL GREEN' : '  ' + fail + ' FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exitCode = fail ? 1 : 0;
