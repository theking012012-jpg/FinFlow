'use strict';
/**
 * verify-f151c-stale-load-guard.js (Rule 14 — executes the real failure path)
 *
 * Tab-refocus bug: bootDashboardWiring reads the active entity at START, fetches its invoices, then
 * writes window._realInvoices — WITHOUT re-checking. A call that started when Saige was active, whose
 * fetch was throttled while the tab was backgrounded, resolved late on refocus and painted Saige's
 * numbers under the active Acme. Fix: a switch-generation token captured at start; a result that comes
 * back after a newer switch is discarded.
 *
 * This drives window._bootDashboardWiring directly: start it while E1 (data) is active, then bump the
 * token + flip active to the empty E2 BEFORE it resolves (as a switch/refocus would). The stale E1
 * result must be discarded — the dashboard must stay 0, never flip to E1's numbers.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f151c-stale-load-guard.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const num = (s) => { const m = String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''); return m === '' ? NaN : parseFloat(m); };

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
          [uid, JSON.stringify({ name: 'Empty Co Two', currency: 'TTD', is_active: 0, sort_order: 1 })]
        );
      },
    });
    const { window, settle } = boot;
    const doc = window.document;
    await settle(70, 60);

    A('_bootDashboardWiring is callable', typeof window._bootDashboardWiring === 'function');
    const ents = window.ENTITIES || [];
    const e2idx = ents.findIndex(e => e && e.name === 'Empty Co Two');

    // Land on the empty E2 (dashboard = 0).
    await window.switchEntity(e2idx); await settle(30, 60);
    A('on empty E2: dashboard = 0', num((doc.getElementById('d-rev')||{}).textContent) === 0, `#d-rev="${(doc.getElementById('d-rev')||{}).textContent}"`);

    // RACE: make E1 active so bootDashboardWiring fetches E1's data, start it, then (before it
    // resolves) bump the token + flip active back to E2 — exactly a switch/refocus mid-flight.
    ents.forEach(e => e.active = (e && e.name !== 'Empty Co Two'));   // E1 active
    const p = window._bootDashboardWiring();
    window._entitySwitchSeq = (window._entitySwitchSeq || 0) + 1;      // newer switch
    ents.forEach(e => e.active = (e && e.name === 'Empty Co Two'));   // back to E2
    await p; await settle(30, 60);

    const after = num((doc.getElementById('d-rev')||{}).textContent);
    // Guard discards the stale write → dashboard shows 0 (E2) or the loading placeholder, NEVER E1's
    // figures. Pre-fix (neg-control) this painted E1's ~$10K. So: must not be E1's positive number.
    A('stale E1 bootDashboardWiring DISCARDED — dashboard NOT showing E1 numbers', after === 0 || Number.isNaN(after), `#d-rev="${(doc.getElementById('d-rev')||{}).textContent}" (parsed ${after})`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F151c stale-load guard)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
