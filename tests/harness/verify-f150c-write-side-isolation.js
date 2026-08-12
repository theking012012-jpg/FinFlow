'use strict';
/**
 * verify-f150c-write-side-isolation.js (Rule 14, Rule 4, Rule 13)
 *
 * The FULL write-side of the entity-isolation class. For every business table whose insert was
 * NULL-prone (body-only) or used activeEntity instead of req.entityId, POST a row with an ACTIVE
 * entity = E2 (via ?entity_id=E2) and NO entity_id in the body, then assert:
 *   1) the stored row carries entity_id = E2 (never NULL, never E1)
 *   2) E1's list does NOT contain it (no cross-entity leak)
 *   3) E2's list DOES contain it (scoped, not lost)
 *
 * Covers: customers, items, inventory, quotes, vendors, bills, recurring_bills, recurring_invoices.
 * DISCRIMINATOR: two entities; the bug stamps NULL (leaks to both) or the is_active entity (E1 here,
 * since the seed entity is is_active) — either way E1 would see the row. The fix stamps E2.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f150c-write-side-isolation.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

// [dbTable, POST path, GET path, body (no entity_id), identifying field, its value]
const CASES = [
  ['customers',          '/api/customers',          '/api/customers',          { fname: 'IsoCust', lname: 'X', email: '' },                                        'fname',  'IsoCust'],
  ['items',              '/api/items',              '/api/items',              { name: 'IsoItem', price: 5 },                                                       'name',   'IsoItem'],
  ['inventory',          '/api/inventory',          '/api/inventory',          { name: 'IsoInv', units: 3, cost: 2 },                                               'name',   'IsoInv'],
  ['quotes',             '/api/quotes',             '/api/quotes',             { client: 'IsoQuote', amount: 100, expiry_date: '2026-12-31', status: 'draft' },      'client', 'IsoQuote'],
  ['vendors',            '/api/vendors',            '/api/vendors',            { name: 'IsoVendor' },                                                                'name',   'IsoVendor'],
  ['bills',              '/api/bills',              '/api/bills',              { vendor: 'IsoBillVend', amount: 50, due_date: '2026-12-31', status: 'unpaid' },      'vendor', 'IsoBillVend'],
  ['recurring_bills',    '/api/recurring-bills',    '/api/recurring-bills',    { vendor: 'IsoRB', amount: 10, frequency: 'monthly', next_run: '2026-08-01', status: 'active' }, 'vendor', 'IsoRB'],
  ['recurring_invoices', '/api/recurring-invoices', '/api/recurring-invoices', { client: 'IsoRI', amount: 10, frequency: 'monthly', next_run: '2026-08-01', status: 'active' }, 'client', 'IsoRI'],
];

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
          [uid, JSON.stringify({ name: 'Entity Two', currency: 'TTD', is_active: 0, sort_order: 1 })]
        );
      },
    });
    const { http, client, userId, settle } = boot;
    await settle(6, 20);
    const ents = (await client.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id`, [userId])).rows.map(r => r.id);
    A('two entities exist', ents.length === 2, `ids=${ents.join(',')}`);
    const [E1, E2] = ents;

    for (const [dbTable, postPath, getPath, body, field, val] of CASES) {
      // POST with active entity = E2, NO entity_id in the body.
      const r = await http.post(`${postPath}?entity_id=${E2}`, body);
      const ok2xx = r.status >= 200 && r.status < 300;
      A(`${dbTable}: POST (active=E2, no body entity_id) → 2xx`, ok2xx, `status=${r.status} ${String(r.text).slice(0,100)}`);
      if (!ok2xx) continue;
      await settle(2, 20);

      // Stored with E2, never NULL/E1.
      const stored = (await client.query(`SELECT entity_id FROM ${dbTable} WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [userId])).rows[0]?.entity_id;
      A(`${dbTable}: stored entity_id = E2 (not NULL, not E1)`, String(stored) === String(E2), `stored=${stored} expected=${E2}`);

      // E1 must NOT see it; E2 must.
      const inE1 = ((await http.get(`${getPath}?entity_id=${E1}`)).json || []).some(x => String(x[field]) === val);
      const inE2 = ((await http.get(`${getPath}?entity_id=${E2}`)).json || []).some(x => String(x[field]) === val);
      A(`${dbTable}: E1 does NOT see E2's row (no leak)`, !inE1);
      A(`${dbTable}: E2 sees its own row`, inE2);
    }

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F150c write-side isolation, ${CASES.length} tables)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
