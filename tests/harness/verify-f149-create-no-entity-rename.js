'use strict';
/**
 * verify-f149-create-no-entity-rename.js (Rule 14, Rule 4 discriminating)
 *
 * BUG (F149): creating a 2nd business renamed the user's EXISTING business in the DB.
 * Chain: submitCreateBusiness (app-main.js) POSTs the new entity (is_active:0), THEN PUTs
 * /api/settings with business_name=<new name>. The settings handler (server.js ~1733) renames
 * `activeEntity` from business_name — and on a 2nd business the active entity is the PREVIOUS
 * (existing) one. So "create B" overwrote existing entity A's name with "B" in the `entities`
 * table. Confirmed by reading; this test executes it.
 *
 * FIX: submitCreateBusiness writes /api/settings ONLY on the first business (isFirst). A 2nd+
 * business is fully defined by its own entity row and issues NO settings PUT — so nothing can
 * rename the existing entity.
 *
 * DISCRIMINATOR (Rule 4): the seed has exactly ONE active entity, so the in-test create is a
 * 2nd business. A correct impl leaves the existing entity's name untouched; the bug renames it to
 * the new name. The seed entity name and the new name differ, so the rename MOVES the number:
 *   - buggy  → existing entity name becomes "Second Biz Ltd"  (+ a PUT /api/settings fires)
 *   - fixed  → existing entity name unchanged                 (0 PUT /api/settings on create)
 *
 * Run it the same way as the other verify-* jsdom harnesses (real scratch Postgres):
 *   node -r ./tests/harness/clock.js tests/harness/verify-f149-create-no-entity-rename.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    // The seed user is 'trial' (entity cap 1). A 2nd business needs the business plan (cap 5) or
    // POST /api/entities is rejected 402 and submitCreateBusiness throws BEFORE the code under test —
    // making the "no rename" assertions pass for the wrong reason (Rule 4). Seed business so the 2nd
    // create actually runs. The "a new entity was created (2 total)" assertion below guards against a
    // silently-blocked create.
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => { await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]); },
    });
    const { window, settle, client, userId, wireLog } = boot;
    await settle(40, 40);
    const doc = window.document;

    // The user's existing business, straight from the DB (name lives in entities.data JSONB).
    const before = (await client.query(
      `SELECT id, data->>'name' AS name, data->>'is_active' AS act FROM entities WHERE user_id=$1 ORDER BY id`, [userId]
    )).rows;
    A('exactly one entity seeded (the existing business)', before.length === 1, `count=${before.length}`);
    const origId = before[0] && before[0].id;
    const origName = before[0] && before[0].name;
    A('seeded entity is active (so it is what activeEntity() returns)', before[0] && String(before[0].act) === '1', `act=${before[0] && before[0].act}`);

    // Drive the REAL create handler (Rule 1: window.submitCreateBusiness is the live global) for a
    // SECOND business. isFirst is false because an entity already exists.
    const NEW = 'Second Biz Ltd';
    A('new name differs from existing (seed discriminates)', NEW !== origName, `orig="${origName}"`);
    const setV = (id, v) => { const el = doc.getElementById(id); if (el) el.value = v; return !!el; };
    A('create-business name field present in DOM', setV('nb-name', NEW));
    setV('nb-currency', 'USD'); setV('nb-industry', 'Other');
    A('submitCreateBusiness is the live handler', typeof window.submitCreateBusiness === 'function');

    const wireBase = wireLog.length;
    await window.submitCreateBusiness();
    await settle(40, 60);

    // Creation still works: the new business exists as ITS OWN entity, with its own name.
    const after = (await client.query(
      `SELECT id, data->>'name' AS name FROM entities WHERE user_id=$1 ORDER BY id`, [userId]
    )).rows;
    A('a new entity was created (2 total now)', after.length === 2, `count=${after.length}`);
    A('new entity carries its own name', after.some(e => e.name === NEW), `names=[${after.map(e => e.name).join(' | ')}]`);

    // THE FIX — the pre-existing business was NOT renamed. Pre-fix this asserted false (origName→NEW).
    const origAfter = after.find(e => String(e.id) === String(origId));
    A('existing business name UNCHANGED after creating a 2nd (bug renamed it)',
      origAfter && origAfter.name === origName, `orig now="${origAfter && origAfter.name}" expected="${origName}"`);

    // No two entities collide on the same name as a result of the create.
    const names = after.map(e => e.name);
    A('no duplicate entity name introduced by the create', new Set(names).size === names.length, `names=[${names.join(' | ')}]`);

    // MECHANISM proof: the 2nd create issued the entity POST but ZERO settings PUT (the rename trigger).
    const since = wireLog.slice(wireBase);
    const entPosts = since.filter(w => w.method === 'POST' && w.path === '/api/entities');
    const setPuts  = since.filter(w => w.method === 'PUT'  && w.path === '/api/settings');
    A('2nd create issued POST /api/entities', entPosts.length === 1, `posts=${entPosts.length}`);
    A('2nd create issued ZERO PUT /api/settings (rename trigger removed)', setPuts.length === 0, `puts=${setPuts.length}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F149 create no-rename, executed in jsdom)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
