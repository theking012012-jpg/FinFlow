'use strict';
/**
 * verify-f151e-refocus-dashboard.js (Rule 14 — deterministic end-to-end reproduction)
 *
 * The tab-refocus symptom: renderEntities()'s empty-entity fallback (/api/invoices) read a session
 * that the consolidated loop (/api/reports?entity_id=<every entity>) had hijacked to Saige, painting
 * Saige's data under the active empty Acme. The hijack-then-read ordering is what made it flaky in the
 * wild. Here we set the hijack precondition DETERMINISTICALLY (an explicit reports?entity_id=E1 read,
 * exactly what the loop issues), THEN drive renderEntities()'s fallback, and assert the dashboard /
 * _realInvoices stay on the empty E2 — never E1.
 *
 * Reproduces under the bug (both fixes reverted): fallback reads the hijacked session → E1 leaks.
 * Passes under the fix: ?entity_id can't hijack the session (server) AND the fallback is entity-scoped
 * (client) — either alone blocks it; both = defence in depth.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f151e-refocus-dashboard.js
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
    const { window, http, client, userId, settle } = boot;
    const doc = window.document;
    await settle(60, 60);

    const ents = (await client.query(`SELECT id, data->>'name' AS name FROM entities WHERE user_id=$1 ORDER BY id`, [userId])).rows;
    const E1 = ents.find(e => e.name !== 'Empty Co Two');
    const E2 = ents.find(e => e.name === 'Empty Co Two');
    const e1inv = Number((await client.query(`SELECT count(*) c FROM invoices WHERE user_id=$1 AND entity_id=$2`, [userId, E1.id])).rows[0].c);
    A('seed: E1 has invoices, E2 empty', e1inv > 0, `E1=${e1inv}`);

    const e2idx = (window.ENTITIES || []).findIndex(e => e && e.name === 'Empty Co Two');
    await window.switchEntity(e2idx); await settle(40, 60);
    A('on empty E2: dashboard = 0', num((doc.getElementById('d-rev')||{}).textContent) === 0, `#d-rev="${(doc.getElementById('d-rev')||{}).textContent}"`);

    // DETERMINISTIC hijack precondition: exactly the per-entity read the consolidated loop issues for
    // Saige. Under the bug this sets session.entityId = E1; under the fix it scopes that request only.
    window._realInvoices = [];   // force the empty-entity fallback path in renderEntities
    await http.get(`/api/reports?entity_id=${E1.id}`);

    // Refocus re-render → fires the empty-entity fallback /api/invoices read.
    for (let i = 0; i < 3; i++) { if (typeof window.renderEntities === 'function') window.renderEntities(); await settle(15, 60); }
    if (typeof window.updateDashboard === 'function') window.updateDashboard();
    await settle(20, 60);

    const rev = num((doc.getElementById('d-rev')||{}).textContent);
    const riLen = Array.isArray(window._realInvoices) ? window._realInvoices.length : -1;
    A('_realInvoices stayed E2 (empty), not the hijacked E1', riLen === 0, `_realInvoices len=${riLen} (E1 has ${e1inv})`);
    A('dashboard still shows E2 (0), NOT Saige under Acme', rev === 0 || Number.isNaN(rev), `#d-rev="${(doc.getElementById('d-rev')||{}).textContent}" (parsed ${rev})`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F151e refocus dashboard e2e)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
