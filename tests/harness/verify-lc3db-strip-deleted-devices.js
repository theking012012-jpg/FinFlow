#!/usr/bin/env node
'use strict';
/**
 * verify-lc3db-strip-deleted-devices — LC3d-b (owner decision 2026-11-01): 90 days after an account is deleted, its
 * sign-in IP addresses and devices are removed from its audit rows; the record of WHAT happened stays (N18). The
 * append-only trigger allows exactly that change, for that person, inside the job — nothing else, never a delete.
 * Real Postgres with the real trigger (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc3db-strip-deleted-devices.js
 *
 * Seed: A deleted 100 days ago (due) · B deleted 30 days ago (not yet) · C a live account. Each has rows with an IP + device.
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
(async () => {
  const s = await startScratchPostgres({ keep: false }); const c = s.client;
  let server;
  try {
    server = await bootServer(s.url);
    const app = require('../../server.js');
    const now = new Date();
    const mkUser = async (e) => (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email: e, password: bcrypt.hashSync('x', 4) }])).rows[0].id;
    const ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0';
    const rows = async (uid, deletedDaysAgo) => {
      await c.query(`INSERT INTO audit_trail (user_id, table_name, action, actor_type, actor_id, ip_address, user_agent, changed_at) VALUES ($1,'users','LOGIN','user',$1,'203.0.113.5',$2,$3)`, [uid, ua, new Date(now.getTime() - 200 * 86400000)]);
      await c.query(`INSERT INTO audit_trail (user_id, table_name, action, actor_type, actor_id, ip_address, user_agent, changed_at) VALUES ($1,'invoices','CREATE','user',$1,'203.0.113.6',$2,$3)`, [uid, ua, new Date(now.getTime() - 150 * 86400000)]);
      if (deletedDaysAgo != null) await c.query(`INSERT INTO audit_trail (user_id, table_name, record_id, action, actor_type, actor_id, ip_address, user_agent, changed_at) VALUES ($1,'users',$1,'ACCOUNT_DELETED','user',$1,'203.0.113.7',$2,$3)`, [uid, ua, new Date(now.getTime() - deletedDaysAgo * 86400000)]);
    };
    const a = await mkUser('a@x.test'), b = await mkUser('b@x.test'), cc = await mkUser('c@x.test');
    await rows(a, 100); await rows(b, 30); await rows(cc, null);
    await c.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[a, b]]);
    const pii = async (uid) => (await c.query(`SELECT count(*) FILTER (WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL)::int n, count(*)::int t FROM audit_trail WHERE user_id = $1`, [uid])).rows[0];
    const r = await app.stripDeletedAccountDevices(now);
    A('the job cleared one person, 3 rows', r.people === 1 && r.rowsCleared === 3, JSON.stringify(r));
    const pa = await pii(a);
    A('A (deleted 100 days ago): no IP / device left, every row still there (+ one SECURITY_DATA_REMOVED)', pa.n === 0 && pa.t === 4, JSON.stringify(pa));
    A('…what happened is kept (LOGIN, CREATE, ACCOUNT_DELETED)', (await c.query(`SELECT array_agg(action ORDER BY id) a FROM audit_trail WHERE user_id = $1`, [a])).rows[0].a.join(',') === 'LOGIN,CREATE,ACCOUNT_DELETED,SECURITY_DATA_REMOVED');
    A('B (deleted 30 days ago): untouched', (await pii(b)).n === 3);
    A('C (live account): untouched', (await pii(cc)).n === 2);
    A('running again changes nothing', (await app.stripDeletedAccountDevices(now)).people === 0);
    const refused = async (sql, params, flag) => { const k = await s.client.query('BEGIN').then(() => flag ? s.client.query(`SELECT set_config('finflow.strip_pii', $1, true)`, [flag]) : null);
      let ok = false; try { await s.client.query(sql, params); } catch (_) { ok = true; } await s.client.query('ROLLBACK'); return ok; };
    A('without the job\'s flag, clearing an IP is refused (append-only)', await refused(`UPDATE audit_trail SET ip_address = NULL WHERE user_id = $1`, [b]));
    A('with the flag, changing anything else is refused', await refused(`UPDATE audit_trail SET action = 'X', ip_address = NULL, user_agent = NULL WHERE user_id = $1`, [b], String(b)));
    A('with the flag for SOMEONE ELSE, refused', await refused(`UPDATE audit_trail SET ip_address = NULL, user_agent = NULL WHERE user_id = $1`, [b], String(cc)));
    A('a DELETE is refused even with the flag', await refused(`DELETE FROM audit_trail WHERE user_id = $1`, [b], String(b)));
  } finally { if (server && server.close) await server.close(); await s.stop(); }
  console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (LC3d-b)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR', e && e.stack); process.exit(1); });
