'use strict';
/**
 * c2-runtime-dialog-scan.js — READ-ONLY. Boot the real SPA and introspect every LIVE window
 * function's source for native confirm()/alert(). Because it reads the function that actually won
 * at runtime (after all wiring overrides), it reports the TRUE C2 sites with no dead-code false
 * positives — the failure that just bit the grep-based enumeration (final5.js copies shadowed by
 * pages.js, which already uses notify).
 *
 *   node -r ./tests/harness/clock.js tests/harness/c2-runtime-dialog-scan.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

// confirm(/alert( NOT preceded by a dot/word char (so window.notify, .confirm props, etc. don't match)
const RE_CONFIRM = /(^|[^.\w])confirm\s*\(/;
const RE_ALERT   = /(^|[^.\w])alert\s*\(/;
// "guarded fallback" pattern: `if(typeof notify...) notify(...); else alert(...)` — benign, notify preferred
const RE_GUARDED = /typeof\s+notify[^;]*notify\s*\([^)]*\)\s*;?\s*else\s+alert/;

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(25, 25);

    const seen = new Set();
    const hits = [];
    for (const k of Object.getOwnPropertyNames(window)) {
      let v; try { v = window[k]; } catch { continue; }
      if (typeof v !== 'function' || seen.has(v)) continue;
      seen.add(v);
      let src; try { src = Function.prototype.toString.call(v); } catch { continue; }
      const c = RE_CONFIRM.test(src), a = RE_ALERT.test(src);
      if (!c && !a) continue;
      // count occurrences
      const nc = (src.match(/(^|[^.\w])confirm\s*\(/g) || []).length;
      const na = (src.match(/(^|[^.\w])alert\s*\(/g) || []).length;
      const guardedOnly = a && !c && RE_GUARDED.test(src) && na === (src.match(RE_GUARDED) ? na : na);
      hits.push({ name: k, c, a, nc, na, guarded: RE_GUARDED.test(src) });
    }
    hits.sort((x, y) => x.name.localeCompare(y.name));

    let confirmTotal = 0, alertTotal = 0;
    console.log('\n=== RUNTIME-WINNING window functions using native dialogs ===');
    console.log('  flags: [C]=confirm [A]=alert  (g)=has guarded notify-else-alert fallback\n');
    for (const h of hits) {
      confirmTotal += h.nc; alertTotal += h.na;
      const flags = (h.c ? 'C' : ' ') + (h.a ? 'A' : ' ');
      console.log(`  [${flags}] window.${h.name.padEnd(34)} confirm×${h.nc} alert×${h.na}${h.guarded ? '  (g)' : ''}`);
    }
    console.log(`\n  ${hits.length} runtime functions · confirm() occurrences=${confirmTotal} · alert() occurrences=${alertTotal}`);
    console.log('  (vs the naive grep count of 39 confirm + 15 alert across source, incl. dead copies)\n');
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
  } finally {
    try { if (boot) await boot.stop(); } catch {}
  }
})();
