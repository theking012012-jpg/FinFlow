'use strict';
/* F64 (closes the "code-read only" caveat with EXECUTION, Rule 14): window.S is the universal money
 * renderer used by every itemized row. Prove it (1) shows exact cents when #s-cents is ON, (2) rounds
 * to whole with #s-cents OFF, and (3) is NOT the abbreviated formatter ($1.2K) — the original bug. The
 * on/off contrast is the discriminator: pre-fix S abbreviated and ignored the toggle. */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(25, 25);
    const doc = window.document;
    A('window.S is the runtime money renderer', typeof window.S === 'function');
    const cb = doc.getElementById('s-cents');
    A('#s-cents toggle exists (Settings)', !!cb);

    if (cb) cb.checked = true;
    const withCents = window.S(1234.56);
    A('cents ON → itemized value shows exact cents (1,234.56)', /1,234\.56/.test(withCents), `S(1234.56)=${withCents}`);

    if (cb) cb.checked = false;
    const noCents = window.S(1234.56);
    A('cents OFF → rounded whole (1,235, no .56)', /1,235/.test(noCents) && !/\.\d/.test(noCents), `S(1234.56)=${noCents}`);

    A('S is NOT the abbreviated formatter (no "1.2K" — the original F64 bug)', !/\dK|\dM/i.test(withCents) && !/\dK|\dM/i.test(noCents), `${withCents} / ${noCents}`);
    A('toggle actually CHANGES the output (setting is live, not dead)', withCents !== noCents);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
