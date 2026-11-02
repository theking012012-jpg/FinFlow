'use strict';
/**
 * verify-f105-ledger-guard — F105. The pre-commit ledger guard (tests/harness/ledger-sync.js) blocks the two mistakes
 * F104 made: logging a defect another finding already owns (same file:line, no mention of it), and asking a question
 * a settled Decision answers (VERIFICATION.md) without citing it. Executed against copies of the real ledger with an
 * F104-shaped row added (Rule 14: the failure path is run, not reasoned about).
 *
 *   node tests/harness/verify-f105-ledger-guard.js
 */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const G = path.join(__dirname, 'ledger-sync.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const ledger = fs.readFileSync(path.join(ROOT, 'AUDIT_MASTER.md'), 'utf8');
const run = (md) => { const f = path.join(os.tmpdir(), 'ledger-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.md'); fs.writeFileSync(f, md);
  const r = spawnSync(process.execPath, [G, '--check', '--file', f], { encoding: 'utf8' }); fs.unlinkSync(f); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
// an existing finding's anchor, taken from the ledger itself (independent of this test)
const { findings } = require('./ledger-sync.js');
const owner = findings(ledger).find(f => /\bserver\.js:\d+\b/.test(f.text) && /^F\d+$/.test(f.id));
const anchor = owner.text.match(/\bserver\.js:\d+\b/)[0];
console.log('\nF105 — the ledger guard\n');

const r0 = run(ledger);
A('the real ledger passes (status 0)', r0.status === 0, r0.out.slice(0, 300));
const dup = ledger + `\n### F999 🟠 HIGH — Expenses omit something — **NEW (test)**\nThe figure at \`${anchor}\` is wrong.\n`;
const r1 = run(dup);
A(`a new finding citing ${anchor} (owned by ${owner.id}) without mentioning it → BLOCKED, naming ${owner.id}`, r1.status === 1 && r1.out.includes('ANCHOR COLLISION') && r1.out.includes(owner.id) && r1.out.includes('F999'), r1.out.slice(0, 300));
const linked = ledger + `\n### F999 🟠 HIGH — Expenses omit something — **NEW (test)**\nThe figure at \`${anchor}\` is wrong (see ${owner.id}).\n`;
A('…the same finding citing ' + owner.id + ' → passes', run(linked).status === 0);
const q = ledger + `\n### F998 🟡 — Should a draft payroll run count? — **NEW (test)**\nOpen question: does a draft payroll run accrue as expense before it is approved?\n`;
const r2 = run(q);
A('a finding re-opening the payroll-run basis without citing it → BLOCKED, pointing at Decision 2', r2.status === 1 && r2.out.includes('UNCITED DECISION') && r2.out.includes('Decision 2'), r2.out.slice(0, 300));
const qc = ledger + `\n### F998 🟡 — Should a draft payroll run count? — **NEW (test)**\nOpen question: does a draft payroll run accrue? Decision 2 says no; this asks only about the label.\n`;
A('…citing Decision 2 → passes', run(qc).status === 0);
const hook = fs.readFileSync(path.join(ROOT, '.githooks', 'pre-commit'), 'utf8');
A('[STRUCTURAL] the pre-commit hook runs it (before the hook\'s final exit 0)', hook.indexOf('ledger-sync.js --check') > 0 && hook.indexOf('ledger-sync.js --check') < hook.search(/^exit 0/m));
console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
