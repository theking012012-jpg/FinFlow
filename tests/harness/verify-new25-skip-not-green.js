'use strict';
/**
 * verify-new25-skip-not-green — NEW-25. A harness that SKIPPED a check did not execute it, so the sweep must not count
 * it green — even when its own tally says "ALL GREEN" (restore-drill-guard without bash) or its skip is one sub-check
 * (the f94 helpers' "  SKIP  …"). A feature that is NAMED Skip ("PASS  [SKIP] …", onboarding) is not a skip.
 *
 * Executed: the real sweep runner over four throwaway harnesses (written here, removed after).
 * Bug value (old runner): the two skipping harnesses → PASS, sweep exit 0.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new25-skip-not-green.js
 */
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const DIR = __dirname;
const CASES = {
  'verify-zz-new25-a-skipped-says-green.js': `console.log('  SKIPPED — no Git Bash / bash found; the guard could not be executed on this machine.');\nconsole.log('\\n  ALL GREEN — 0 passed, 0 failed (SKIPPED: no bash)\\n');`,
  'verify-zz-new25-b-one-skip.js': `console.log('  PASS  the client part');\nconsole.log('  SKIP  server.js not loadable here — covered by the full sweep');\nconsole.log('\\n  ALL GREEN — 1 passed, 0 failed\\n');`,
  'verify-zz-new25-c-feature-named-skip.js': `console.log('  PASS  [SKIP] Skip with no country does NOT mark the user onboarded');\nconsole.log('\\n  ALL GREEN — 1 passed, 0 failed\\n');`,
  'verify-zz-new25-d-plain.js': `console.log('\\n  ALL GREEN — 3 passed, 0 failed\\n');`,
};

try {
  for (const [f, src] of Object.entries(CASES)) fs.writeFileSync(path.join(DIR, f), `'use strict';\n${src}\n`);
  const r = spawnSync(process.execPath, ['-r', path.join(DIR, 'clock.js'), path.join(DIR, 'run-verification-sweep.js')], {
    encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { SWEEP_ONLY: 'zz-new25' }) });
  const out = r.stdout || '';
  const line = (f) => (out.split('\n').find(l => l.includes(f)) || '').trim();
  A('a harness that printed SKIPPED but tallied "ALL GREEN" is NOT green (bug: PASS)', /^FAIL\s/.test(line('a-skipped-says-green')) && /SKIPPED — 1 check\(s\) not executed/.test(line('a-skipped-says-green')), line('a-skipped-says-green'));
  A('a harness with one "  SKIP  …" sub-check is NOT green (bug: PASS)', /^FAIL\s/.test(line('b-one-skip')) && /SKIPPED/.test(line('b-one-skip')), line('b-one-skip'));
  A('"PASS  [SKIP] …" (a feature named Skip) stays green', /^PASS\s/.test(line('c-feature-named-skip')), line('c-feature-named-skip'));
  A('control: a plain green harness stays green', /^PASS\s/.test(line('d-plain')), line('d-plain'));
  A('the sweep says 2/4 GREEN and exits non-zero', /SWEEP COMPLETE — 2\/4 GREEN, 2 RED/.test(out) && r.status === 1, (out.match(/SWEEP COMPLETE[^\n]*/) || [''])[0] + ' exit ' + r.status);
} catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
finally { for (const f of Object.keys(CASES)) { try { fs.unlinkSync(path.join(DIR, f)); } catch (_) {} } }
console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (NEW-25 a skipped check is not green)\n`);
process.exitCode = fail ? 1 : 0;
