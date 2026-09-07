'use strict';
/**
 * verify-plaid-entity-scope.js — per-entity Plaid bank links. Each business links its OWN banks:
 * business A's linked banks show only on A, B's only on B (no cross-entity bleed). A legacy
 * account-level list (entity_id NULL) still shows on a business that has not linked its own — the
 * backward-compat fallback. Unlink is per-entity and EXACT: unlinking a bank on A prunes only A's own
 * list and never mutates the shared legacy list (so Plaid's global /item/remove can't strand other
 * businesses); a business with no own list (seeing legacy only, via fallback) cannot unlink a legacy
 * bank (404), because the write path never touches the legacy row.
 *   node -r ./tests/harness/clock.js tests/harness/verify-plaid-entity-scope.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'plaid-ent-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  // no Plaid keys → unlink is a pure local op (no /item/remove call); items GET reads the blob directly
  delete process.env.PLAID_CLIENT_ID; delete process.env.PLAID_SECRET;
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const item = (id, name) => ({ item_id: id, institution_name: name, linked_at: new Date().toISOString(), access_token: 'dummy:tok:' + id, cursor: null });
  const seed = (c, uid, eid, items) => c.query(
    `INSERT INTO user_settings (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
    [uid, eid, { key: 'plaid_items', value: JSON.stringify(items) }]);
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client; server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const mkEnt = async (name, active) => (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name, currency: 'USD', is_active: active }])).rows[0].id;
    const eidA = await mkEnt('A Co', 1), eidB = await mkEnt('B Co', 0), eidC = await mkEnt('C Co', 0);
    await seed(c, uid, eidA, [item('itm_A', 'Chase_A')]);
    await seed(c, uid, eidB, [item('itm_B', 'BofA_B')]);
    await seed(c, uid, null, [item('itm_LEG', 'Republic_LEGACY')]);   // legacy account-level list

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);
    const insts = async eid => ((await http.get('/api/plaid/items?entity_id=' + eid)).json || {}).items || [];
    const names = arr => arr.map(i => i.institution_name);

    A('A sees its OWN bank', names(await insts(eidA)).includes('Chase_A'));
    A('B sees its OWN bank', names(await insts(eidB)).includes('BofA_B'));
    A('A does NOT see B\'s bank (no bleed)', !names(await insts(eidA)).includes('BofA_B'));
    A('C (no own list) falls back to the legacy bank', names(await insts(eidC)).includes('Republic_LEGACY'));
    A('A does NOT see the legacy bank (its own list shadows it)', !names(await insts(eidA)).includes('Republic_LEGACY'));

    // ── unlink is per-entity + exact ──
    const un = await http.post('/api/plaid/unlink?entity_id=' + eidA, { item_id: 'itm_A' });
    A('unlink A\'s own bank → 200', un.status === 200, 'status ' + un.status);
    A('after unlink, A\'s list is empty', names(await insts(eidA)).length === 0, JSON.stringify(names(await insts(eidA))));
    A('after unlink A, B still has its bank', names(await insts(eidB)).includes('BofA_B'));
    A('after unlink A, legacy is untouched (C still sees it)', names(await insts(eidC)).includes('Republic_LEGACY'));

    // C sees the legacy bank via fallback, but cannot unlink it — the write path never touches the legacy row
    const unC = await http.post('/api/plaid/unlink?entity_id=' + eidC, { item_id: 'itm_LEG' });
    A('C cannot unlink a fallback-only (legacy) bank → 404', unC.status === 404, 'status ' + unC.status);
    A('legacy bank still intact after the refused unlink', names(await insts(eidC)).includes('Republic_LEGACY'));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (plaid per-entity)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
