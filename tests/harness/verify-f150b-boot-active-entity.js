'use strict';
/**
 * verify-f150b-boot-active-entity.js (Rule 14 — reproduce or refute)
 *
 * F150-b: on boot the dashboard showed the WRONG entity's figures (entity 1's revenue while entity 2
 * was marked active). This harness reproduces the shape: seed the data-bearing entity (E1) but make a
 * SECOND, EMPTY entity (E2) the active one, then boot and read the dashboard revenue KPI (#d-rev).
 *
 *   correct → boot loads the ACTIVE entity (E2, empty) → #d-rev ≈ 0
 *   F150-b  → boot loads E1 (the data entity) → #d-rev = E1's large seeded revenue
 *
 * Discriminating: E1 has seeded invoices (revenue > 0), E2 has none, so the two entities give very
 * different revenue and a wrong-entity load MOVES the number.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f150b-boot-active-entity.js
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
        // Make the seeded (data-bearing) entity INACTIVE, and add an EMPTY entity that IS active.
        await c.query(`UPDATE entities SET data = data || '{"is_active":0}'::jsonb WHERE user_id = $1`, [uid]);
        await c.query(
          `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
           VALUES ($1, NULL, $2, NOW(), NOW())`,
          [uid, JSON.stringify({ name: 'Empty Active Co', currency: 'TTD', is_active: 1, sort_order: 1 })]
        );
      },
    });
    const { window, client, userId, settle } = boot;
    await settle(70, 60);
    const doc = window.document;

    const ents = (await client.query(`SELECT id, data->>'name' AS name, data->>'is_active' AS act FROM entities WHERE user_id=$1 ORDER BY id`, [userId])).rows;
    const E1 = ents.find(e => e.name !== 'Empty Active Co');
    const E2 = ents.find(e => e.name === 'Empty Active Co');
    A('E2 (empty) is the active entity', E2 && String(E2.act) === '1');

    // Confirm the seed is discriminating: E1 has invoices, E2 has none.
    const e1inv = (await client.query(`SELECT count(*) c FROM invoices WHERE user_id=$1 AND entity_id=$2`, [userId, E1.id])).rows[0].c;
    const e2inv = (await client.query(`SELECT count(*) c FROM invoices WHERE user_id=$1 AND entity_id=$2`, [userId, E2.id])).rows[0].c;
    A('seed discriminates: E1 has invoices, E2 has none', Number(e1inv) > 0 && Number(e2inv) === 0, `E1=${e1inv} E2=${e2inv}`);

    const dRev = (doc.getElementById('d-rev') || {}).textContent;
    const v = num(dRev);
    A('dashboard revenue loaded (not still "—")', !Number.isNaN(v), `#d-rev="${dRev}"`);
    // The active entity is EMPTY → revenue must be ~0. A large value = E1 loaded = F150-b.
    A('boot loaded the ACTIVE (empty) entity → #d-rev ≈ 0, not E1\'s revenue', v === 0, `#d-rev="${dRev}" (parsed ${v})`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F150-b boot active entity)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
