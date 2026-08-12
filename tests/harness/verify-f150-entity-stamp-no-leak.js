'use strict';
/**
 * verify-f150-entity-stamp-no-leak.js (Rule 14, Rule 4 discriminating)
 *
 * F150: customers and items were inserted with `entity_id: b.entity_id || null` — BODY ONLY, no
 * fallback to the active entity (req.entityId). A create without an explicit body entity_id was
 * born entity_id=NULL, and the null-inclusive read filter (`entity_id == null || ...`) then showed
 * that row under EVERY entity. This is the leak the owner hit at 2 entities (and a dealbreaker at 5).
 *
 * FIX: stamp `b.entity_id || req.entityId || null`, matching every other business insert.
 *
 * DISCRIMINATOR: two entities exist. We POST a customer and an item with an ACTIVE entity = E2
 * (via ?entity_id=E2, which sets req.entityId) but NO entity_id in the body. A correct impl stamps
 * E2 → the row is invisible to E1. The bug stamps NULL → the row shows under BOTH E1 and E2.
 *   - buggy  → stored entity_id = NULL, and GET /api/customers?entity_id=E1 INCLUDES it (leak)
 *   - fixed  → stored entity_id = E2, and E1 does NOT see it
 *
 * Run like the other verify-* harnesses:
 *   node -r ./tests/harness/clock.js tests/harness/verify-f150-entity-stamp-no-leak.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({
      // business plan (cap 5) + a SECOND entity so we can test cross-entity isolation.
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

    // POST a customer with ACTIVE entity = E2 (query param) but NO entity_id in the body.
    const rc = await http.post(`/api/customers?entity_id=${E2}`, { fname: 'Leaky', lname: 'Cust', email: '' });
    A('POST /api/customers (active=E2, no body entity_id) → 2xx', rc.status >= 200 && rc.status < 300, `status=${rc.status} ${rc.text.slice(0,120)}`);
    // POST an item the same way.
    const ri = await http.post(`/api/items?entity_id=${E2}`, { name: 'Leaky Item', price: 10 });
    A('POST /api/items (active=E2, no body entity_id) → 2xx', ri.status >= 200 && ri.status < 300, `status=${ri.status} ${ri.text.slice(0,120)}`);

    await settle(4, 20);

    // The stored rows must carry E2, never NULL (the fix).
    const custEnt = (await client.query(`SELECT entity_id FROM customers WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [userId])).rows[0]?.entity_id;
    const itemEnt = (await client.query(`SELECT entity_id FROM items     WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [userId])).rows[0]?.entity_id;
    A('customer stored with entity_id = E2 (not NULL)', String(custEnt) === String(E2), `stored=${custEnt} expected=${E2}`);
    A('item stored with entity_id = E2 (not NULL)',     String(itemEnt) === String(E2), `stored=${itemEnt} expected=${E2}`);

    // Isolation: E1 must NOT see E2's new rows (pre-fix, NULL rows showed under E1).
    const custE1 = await http.get(`/api/customers?entity_id=${E1}`);
    const itemE1 = await http.get(`/api/items?entity_id=${E1}`);
    const custNames = (custE1.json || []).map(c => c.fname);
    const itemNames = (itemE1.json || []).map(i => i.name);
    A('E1 does NOT see E2 customer (no cross-entity leak)', !custNames.includes('Leaky'), `E1 customers=${JSON.stringify(custNames)}`);
    A('E1 does NOT see E2 item (no cross-entity leak)',     !itemNames.includes('Leaky Item'), `E1 items=${JSON.stringify(itemNames)}`);

    // And E2 DOES see them (scoped correctly, not lost).
    const custE2 = await http.get(`/api/customers?entity_id=${E2}`);
    const itemE2 = await http.get(`/api/items?entity_id=${E2}`);
    A('E2 sees its own customer', (custE2.json || []).some(c => c.fname === 'Leaky'));
    A('E2 sees its own item',     (itemE2.json || []).some(i => i.name === 'Leaky Item'));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F150 entity-stamp no-leak)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
