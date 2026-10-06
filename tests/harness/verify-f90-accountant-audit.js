'use strict';
/**
 * verify-f90-accountant-audit.js — PROVE (Rule 14) that accountant actions on a CLIENT's books are
 * audited, ATTRIBUTED to the accountant (actor_type='accountant', actor_id=accountantId) while
 * user_id stays the client whose books changed. Pre-Phase-B accountant-routes logged nothing.
 *
 * Flow: pending client → activate → journal → lock → suspend → reactivate.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90-accountant-audit.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const ACC = { email: 'f90acc@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'f90client@finflow.test', name: 'Client', plan: 'trial', role: 'owner' }]
    )).rows[0].id;
    // F150 seed-debt fix: create an active entity so req.entityId resolves (production onboarding
    // POSTs /api/entities); without it, business-route writes stamp entity_id NULL → chk_*_entity_nn.
    await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { name: 'F90 Client Co', currency: 'USD', is_active: 1 }]);
    const accId = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code, status)
       VALUES ($1,$2,'A','B','F90ACCREF','verified') RETURNING id`, [ACC.email, bcrypt.hashSync(ACC.password, 10)]
    )).rows[0].id;
    // requested_by='client': the client asked (request-access), so the accountant may accept it (N78).
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, referral_month, referral_months_total, requested_by)
                   VALUES ($1,$2,'pending','edit',0,6,'client')`, [accId, uid]);

    const http = new HarnessHttp(server.baseUrl);
    A('accountant login 200', (await http.post('/api/accountants/login', ACC)).status === 200);

    const act = await http.post('/api/accountants/activate-client', { userId: uid });
    A('activate-client 200', act.status === 200, `status ${act.status} ${JSON.stringify(act.json)}`);
    const jr = await http.post(`/api/accountants/clients/${uid}/journal`, { date: '2026-06-10', description: 'Adj', lines: [{ account: 'Rent', debit: 10, credit: 0 }, { account: 'Cash', debit: 0, credit: 10 }] });
    A('journal 201', jr.status === 201, `status ${jr.status} ${JSON.stringify(jr.json)}`);
    const lk = await http.post(`/api/accountants/clients/${uid}/lock`, { period: '2026-06', locked: true });
    A('lock 200', lk.status === 200, `status ${lk.status}`);
    const sp = await http.post('/api/accountants/suspend-client', { userId: uid });
    A('suspend-client 200', sp.status === 200, `status ${sp.status}`);
    // N80: reactivation is the Stripe webhook's job only — the accountant route refuses and audits nothing.
    const re = await http.post('/api/accountants/reactivate-client', { userId: uid });
    A('reactivate-client (accountant) → 403 REACTIVATE_WEBHOOK_ONLY', re.status === 403, `status ${re.status}`);

    const rows = (await c.query(`SELECT table_name, action, actor_type, actor_id, user_id FROM audit_trail WHERE user_id=$1`, [uid])).rows;
    const find = (t, a) => rows.find(r => r.table_name === t && r.action === a);
    for (const [t, a] of [['accountant_clients', 'CLIENT_ACTIVATE'], ['journals', 'CREATE'], ['lock_settings', 'LOCK'], ['accountant_clients', 'CLIENT_SUSPEND']]) {
      const r = find(t, a);
      A(`${t} ${a} audited, attributed to the accountant`, !!r && r.actor_type === 'accountant' && r.actor_id === accId && r.user_id === uid,
        r ? JSON.stringify({ at: r.actor_type, aid: r.actor_id, uid: r.user_id }) : `no ${t}/${a} row; trail=${JSON.stringify(rows.map(x => x.table_name + '/' + x.action))}`);
    }

    A('no CLIENT_REACTIVATE row from the refused accountant call', !find('accountant_clients', 'CLIENT_REACTIVATE'));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
