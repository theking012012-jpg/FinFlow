'use strict';
/**
 * verify-b5-blocked-reports.js — B5.3: with the display-currency conversion source (/api/reports)
 * BLOCKED, every KPI card must show "—" — never a stale figure and never the NATIVE number relabelled
 * under the foreign currency (the F34/F59 honest-empty guard).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-b5-blocked-reports.js
 *
 * Base (USD) dashboard computes client-side and does NOT touch /api/reports — so blocking it leaves the
 * native cards correct (resilient by design). Switching to a foreign currency forces the server-convert
 * fetch, which is blocked here (500) → the cards must blank to "—". Single boot (server.js has a module-
 * global pool, so one bootServer per process).
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const m = String(e && e.message || e); if (/_location|pool after|terminating connection|Client was closed/.test(m)) return; throw e; });

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({ failMap: { '/api/reports': 500 } });
    const { window: w, settle, text } = boot;
    for (let i = 0; i < 250 && typeof w.updateCurrency !== 'function'; i++) await settle(1, 100);
    await settle(50, 100);

    // Base USD dashboard is resilient — it computes locally, so blocking /api/reports must NOT blank it.
    const nativeRev = text('d-rev');
    A('base USD cards still render (dashboard does not depend on /api/reports)', /\$/.test(nativeRev || '') && nativeRev !== '—', `d-rev="${nativeRev}"`);

    // Switch to EUR → forces /api/reports?display=EUR, which is blocked → honest "—".
    let sel = w.document.getElementById('s-currency');
    if (!sel) { sel = w.document.createElement('select'); sel.id = 's-currency'; w.document.body.appendChild(sel); }
    if (![...sel.options].some(o => o.value === 'EUR')) { const o = w.document.createElement('option'); o.value = 'EUR'; sel.appendChild(o); }
    sel.value = 'EUR';
    await w.updateCurrency();
    let rev = '';
    for (let i = 0; i < 100; i++) { await settle(3, 60); rev = text('d-rev') || ''; if (rev === '—') break; }

    const cards = ['d-rev', 'd-exp', 'd-profit', 'd-outstanding', 'd-invest'];
    for (const id of cards) {
      const v = text(id);
      A(`B5.3 ${id} → "—" (not a stale or native number, not a €-relabelled native figure)`,
        v === '—', `${id}="${v}"`);
    }

    console.log('\n' + (fail === 0 ? '  ALL GREEN' : '  ' + fail + ' FAILED') + ` — ${pass} passed, ${fail} failed  (B5.3 blocked reports)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
