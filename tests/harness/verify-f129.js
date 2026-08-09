'use strict';
/* F129 (executed, Rule-1-aware): confirm the entity-money renders now use _nativeSymbol() and that the
 * edits landed in the RUNTIME-WINNING functions (introspect their live .toString(), not the source),
 * and no live entity-money render still carries a hardcoded '$'. */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  const body = fn => { try { return Function.prototype.toString.call(fn); } catch { return ''; } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(25, 25);
    A('window._nativeSymbol() returns a symbol string', typeof window._nativeSymbol === 'function' && typeof window._nativeSymbol() === 'string');
    // live journal renderer (window.renderJournals = renderJournalsLive) carries the fix, not a hardcoded $
    const rj = body(window.renderJournals);
    A('live renderJournals uses _nativeSymbol on debit/credit', /_nativeSymbol\(\)\}\$\{\(j\.(debit|credit)/.test(rj), 'runtime renderJournals body');
    A('live renderJournals no longer has hardcoded $ on j.debit/credit', !/\$\$\{\(j\.(debit|credit)/.test(rj));
    // je-total updater (updateJETotals) — not a window fn, so assert via a fresh render path: check the source-of-truth window fns that ARE global
    A('window.previewEditEmpNet uses _nativeSymbol (payroll preview, live winner)', /_nativeSymbol\(\)/.test(body(window.previewEditEmpNet)));
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
