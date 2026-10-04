'use strict';
/**
 * verify-creds-connectors-entity-scope.js — per-scope generic credential connectors (dLocal, Mercado
 * Pago, Wise). Each business connects its OWN merchant account: A's connection shows only on A, not on
 * B (no cross-entity bleed). FULL INDEPENDENCE: a business with no connection of its own is NOT connected —
 * it never falls back to the personal/account-level (entity_id NULL) connection. The personal (NULL) scope
 * keeps its own connection, reachable via ?entity_id=all. Disconnect is per-scope and exact: disconnecting A
 * never touches B or the personal blob; a business cannot disconnect a connection it does not own (404).
 *   node -r ./tests/harness/clock.js tests/harness/verify-creds-connectors-entity-scope.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'creds-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client; server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const mkEnt = async (name, active) => (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name, currency: 'USD', is_active: active }])).rows[0].id;
    const eidA = await mkEnt('A Co', 1), eidB = await mkEnt('B Co', 0), eidC = await mkEnt('C Co', 0);
    // legacy account-level Mercado Pago connection (entity_id NULL) — pre-per-entity single connection
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { key: 'mercadopago_conn', value: JSON.stringify({ connected: true, provider: 'Mercado Pago' }) }]);

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);
    const connected = async (prov, eid) => !!(((await http.get('/api/' + prov + '/status?entity_id=' + eid)).json) || {}).connected;

    // ── dLocal: per-entity isolation + disconnect isolation (no legacy) ──
    A('dLocal connect@A → 201', (await http.post('/api/dlocal/connect?entity_id=' + eidA, { x_login: 'L', x_trans_key: 'T', secret_key: 'S' })).status === 201);
    A('dLocal A is connected', await connected('dlocal', eidA));
    A('dLocal B is NOT connected (no bleed, no legacy)', !(await connected('dlocal', eidB)));
    A('dLocal connect@B → 201', (await http.post('/api/dlocal/connect?entity_id=' + eidB, { x_login: 'L2', x_trans_key: 'T2', secret_key: 'S2' })).status === 201);
    A('dLocal B now connected', await connected('dlocal', eidB));
    A('dLocal disconnect@A → 200', (await http.post('/api/dlocal/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after disconnect, dLocal A is cleared', !(await connected('dlocal', eidA)));
    A('after disconnect A, dLocal B still connected', await connected('dlocal', eidB));

    // ── Mercado Pago: personal (NULL) scope independent, no fallback to businesses ──
    A('[DISCRIMINATING] MP C (no own) is NOT connected — no fallback to personal/legacy', !(await connected('mercadopago', eidC)));
    A('MP personal (NULL, via ?entity_id=all) keeps its own connection', await connected('mercadopago', 'all'));
    A('MP connect@A its own → 201', (await http.post('/api/mercadopago/connect?entity_id=' + eidA, { access_token: 'tokA' })).status === 201);
    A('MP A connected (own)', await connected('mercadopago', eidA));
    const dcC = await http.post('/api/mercadopago/disconnect?entity_id=' + eidC, {});
    A('MP C cannot disconnect a connection it does not own → 404', dcC.status === 404, 'status ' + dcC.status);
    A('MP personal connection (via ?entity_id=all) still intact after C\'s refused disconnect', await connected('mercadopago', 'all'));

    // ── Wise: per-entity, no bleed ──
    A('Wise connect@A → 201', (await http.post('/api/wise/connect?entity_id=' + eidA, { api_token: 'wtok' })).status === 201);
    A('Wise A connected', await connected('wise', eidA));
    A('Wise B NOT connected (no bleed)', !(await connected('wise', eidB)));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (creds connectors per-entity)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
