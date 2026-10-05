'use strict';
/**
 * verify-entity-switch-money-clear.js — entity-switch money staleness (Rule 14, real failure path).
 *
 * BUG: switchEntity() flips the DISPLAY currency synchronously at the top, but the money collections the
 * dashboard reads — window._realInvoices + window.receipts (revenue) and window.userInvoices
 * (Outstanding/AR, app-main.js:923) — only clear/reload AFTER the async activate+load. So in the gap a
 * repaint shows the PREVIOUS entity's figures in the NEW entity's currency (e.g. Saige's USD numbers
 * rendered as TT$ on an empty TTD entity). Server isolation is correct; this is a client display defect.
 *
 * This boots the real SPA, lands on the data entity, then switches to an EMPTY TTD entity and inspects
 * the SYNCHRONOUS post-call state — before the async reload. The fix clears the money collections
 * synchronously at the currency flip, so there is never a stale-in-new-currency window.
 *
 * Discriminating: pre-fix, _realInvoices/userInvoices still hold the data entity's rows immediately after
 * the switch call → RED. Post-fix they are [] synchronously → GREEN. End-state: empty entity shows 0.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-entity-switch-money-clear.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const num = (s) => { const m = String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''); return m === '' ? NaN : parseFloat(m); };

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]);
        await c.query(
          `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
           VALUES ($1, NULL, $2, NOW(), NOW())`,
          [uid, JSON.stringify({ name: 'Empty TT Co', currency: 'TTD', is_active: 0, sort_order: 1 })]
        );
      },
    });
    const { window, settle } = boot;
    const doc = window.document;
    await settle(80, 60);

    const ents = window.ENTITIES || [];
    const emptyIdx = ents.findIndex((e) => e && e.name === 'Empty TT Co');
    const dataIdx = ents.findIndex((e) => e && e.name !== 'Empty TT Co');
    A('both entities present (data entity + Empty TT Co)', emptyIdx >= 0 && dataIdx >= 0,
      'ENTITIES=' + ents.map((e) => e && e.name).join(','));

    // Land on the data entity and let its money collections load.
    await window.switchEntity(dataIdx); await settle(50, 60);
    const real0 = (window._realInvoices || []).length;
    const user0 = (window.userInvoices || []).length;
    A('data entity has money loaded (_realInvoices + userInvoices > 0)', real0 > 0 && user0 > 0,
      `_realInvoices=${real0} userInvoices=${user0}`);

    // ── THE SWITCH ── to the empty entity. Inspect the SYNCHRONOUS state right after the call returns,
    // before awaiting the async reload: the previous entity's money must already be gone.
    const p = window.switchEntity(emptyIdx);
    const syncReal = (window._realInvoices || []).length;
    const syncUser = (window.userInvoices || []).length;
    const syncRcpt = (window.receipts || []).length;
    A('[DISCRIMINATING] _realInvoices cleared synchronously on switch (revenue source)', syncReal === 0, '_realInvoices=' + syncReal);
    A('[DISCRIMINATING] userInvoices cleared synchronously on switch (Outstanding/AR source)', syncUser === 0, 'userInvoices=' + syncUser);
    A('[DISCRIMINATING] receipts cleared synchronously on switch', syncRcpt === 0, 'receipts=' + syncRcpt);
    await p; await settle(50, 60);

    // ── END STATE ── empty entity: collections empty, dashboard reads 0 (never the data entity ×FX).
    A('after settle, _realInvoices empty for the empty entity', (window._realInvoices || []).length === 0);
    A('after settle, userInvoices empty for the empty entity', (window.userInvoices || []).length === 0);
    const drev = num((doc.getElementById('d-rev') || {}).textContent);
    A('dashboard revenue shows 0 on the empty entity (not the data entity converted)',
      drev === 0 || Number.isNaN(drev), '#d-rev="' + ((doc.getElementById('d-rev') || {}).textContent) + '"');

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (entity-switch money clear)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
