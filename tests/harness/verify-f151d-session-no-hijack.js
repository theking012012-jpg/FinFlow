'use strict';
/**
 * verify-f151d-session-no-hijack.js (Rule 14 — executes the real failure path)
 *
 * Root of the tab-refocus "Saige under Acme" bug: the entity middleware persisted a per-request
 * ?entity_id into session.entityId. The consolidated dashboard reads /api/reports?entity_id=<every
 * entity>, so the last one (Saige) hijacked the session; a later session-based read (/api/invoices
 * with no entity_id) then returned Saige's data under the active Acme.
 *
 * Fix: ?entity_id scopes THAT request only; the session's active entity is owned solely by
 * /api/entities/:id/activate.
 *
 * This test: activate the EMPTY E2, then issue a read scoped to E1 (as the consolidated loop does),
 * then a session-based /api/invoices (no entity_id) — which must still return E2 (empty), never E1.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f151d-session-no-hijack.js
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
          [uid, JSON.stringify({ name: 'Empty Co Two', currency: 'TTD', is_active: 0, sort_order: 1 })]
        );
      },
    });
    const { http, client, userId, settle } = boot;
    await settle(30, 60);   // let the SPA's boot fetches finish so our sequence is deterministic

    const ents = (await client.query(`SELECT id, data->>'name' AS name FROM entities WHERE user_id=$1 ORDER BY id`, [userId])).rows;
    const E1 = ents.find(e => e.name !== 'Empty Co Two');   // data-bearing
    const E2 = ents.find(e => e.name === 'Empty Co Two');   // empty
    const e1inv = Number((await client.query(`SELECT count(*) c FROM invoices WHERE user_id=$1 AND entity_id=$2`, [userId, E1.id])).rows[0].c);
    A('seed discriminates: E1 has invoices, E2 empty', e1inv > 0, `E1=${e1inv}`);

    // Make E2 the active entity in the session (the explicit switch).
    const act = await http.post(`/api/entities/${E2.id}/activate`);
    A('activate E2 → 200', act.status === 200, `status=${act.status}`);

    // A consolidated-style read scoped to E1 (this is what used to hijack the session).
    await http.get(`/api/reports?entity_id=${E1.id}`);

    // Session-based read (NO entity_id) — must reflect the ACTIVE entity E2 (empty), not hijacked E1.
    const inv = await http.get('/api/invoices');
    const n = Array.isArray(inv.json) ? inv.json.length : -1;
    A('session-based /api/invoices returns E2 (empty), not E1 (session NOT hijacked)', n === 0, `invoices returned=${n} (E1 has ${e1inv})`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F151d session no-hijack)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
