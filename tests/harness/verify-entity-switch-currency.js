'use strict';
/**
 * verify-entity-switch-currency.js — the DISPLAY currency must follow the active entity across a
 * switchEntity() call, exactly as it does on a fresh boot.
 *
 * The bug (prod, reported 2026-08): switchEntity() relabelled the sidebar badge to the new entity's
 * currency but never reset `activeCurrency` (boot does, app-main.js:1320). S() → _fmtMoneyExact reads
 * CURRENCIES[activeCurrency] LIVE, so after switching TTD→USD every figure kept the PREVIOUS entity's
 * symbol (Saige/USD rendered as TT$207.7K) until a manual refresh re-ran boot. App-wide, not
 * dashboard-only. Reproduces under the bug (fix reverted): the round-trip label/symbol stays TTD.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-entity-switch-currency.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]);
        await c.query(
          `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
           VALUES ($1, NULL, $2, NOW(), NOW())`,
          [uid, JSON.stringify({ name: 'Trinidad Co', currency: 'TTD', is_active: 0, sort_order: 1 })]
        );
      },
    });
    const { window, settle } = boot;
    const doc = window.document;
    await settle(60, 60);

    const label = () => (doc.getElementById('currency-code-label') || {}).textContent || '';
    const rev = () => (doc.getElementById('d-rev') || {}).textContent || '';
    const idxOf = (name) => (window.ENTITIES || []).findIndex(e => e && e.name === name);
    const usdIdx = (window.ENTITIES || []).findIndex(e => e && e.currency === 'USD');
    const ttdIdx = idxOf('Trinidad Co');

    // Boot state: the default seed entity (USD) is active.
    A('boot: two entities, one USD one TTD', usdIdx >= 0 && ttdIdx >= 0, `usdIdx=${usdIdx} ttdIdx=${ttdIdx}`);
    A('boot: display currency label = USD', label() === 'USD', `label="${label()}"`);

    // Switch to the TTD entity → the display currency must become TTD.
    await window.switchEntity(ttdIdx); await settle(40, 60);
    A('after switch to TTD entity: label = TTD', label() === 'TTD', `label="${label()}"`);
    A('after switch to TTD: revenue KPI carries the TT$ symbol', /TT\$/.test(rev()), `#d-rev="${rev()}"`);

    // Switch BACK to the USD entity → the display currency must return to USD (THE BUG: it stayed TTD).
    await window.switchEntity(usdIdx); await settle(40, 60);
    A('round-trip to USD entity: label back to USD (not stuck on TTD)', label() === 'USD', `label="${label()}"`);
    A('round-trip to USD: revenue KPI shows $, NOT TT$ (the reported symptom)', /\$/.test(rev()) && !/TT\$/.test(rev()), `#d-rev="${rev()}"`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (display currency follows the active entity)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
