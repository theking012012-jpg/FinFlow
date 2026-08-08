'use strict';
/**
 * verify-f90-audit-foundation.js — PROVE (Rule 14) the accounting-grade audit-trail foundation:
 *   1. APPEND-ONLY — the DB trigger blocks UPDATE and DELETE on audit_trail (immutable).
 *   2. ONE TRAIL — logAudit (was the separate audit_log table) now writes to audit_trail; audit_log
 *      receives nothing new.
 *   3. ATTRIBUTION — a user's route write is actor_type='user'; a req-less side-effect (recalc) is
 *      actor_type='system'.
 *   4. SNAPSHOTS — a CREATE records new_data (the record snapshot).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90-audit-foundation.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f90@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F90', plan: 'trial', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;

    // ── 1. APPEND-ONLY: seed one row, then UPDATE and DELETE must both throw ──
    const aid = (await c.query(
      `INSERT INTO audit_trail (user_id, table_name, record_id, action, actor_type, actor_id) VALUES ($1,'test',1,'CREATE','system',$1) RETURNING id`, [uid]
    )).rows[0].id;
    let updateBlocked = false, deleteBlocked = false;
    try { await c.query(`UPDATE audit_trail SET action='TAMPER' WHERE id=$1`, [aid]); } catch (e) { updateBlocked = /append-only/.test(e.message); }
    try { await c.query(`DELETE FROM audit_trail WHERE id=$1`, [aid]); } catch (e) { deleteBlocked = /append-only/.test(e.message); }
    A('audit_trail UPDATE is BLOCKED at the DB (append-only trigger)', updateBlocked);
    A('audit_trail DELETE is BLOCKED at the DB (append-only trigger)', deleteBlocked);
    A('the seeded audit row still exists (tamper attempts failed)', (await c.query(`SELECT 1 FROM audit_trail WHERE id=$1`, [aid])).rows.length === 1);

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', LOGIN)).status === 200);

    // ── 2 & 3 & 4: a user CREATE → audit_trail (not audit_log), actor 'user', new_data snapshot ──
    const auditLogBefore = (await c.query(`SELECT COUNT(*)::int n FROM audit_log WHERE user_id=$1`, [uid])).rows[0].n;
    const mk = await http.post('/api/invoices', { client: 'C', amount: 1000, status: 'pending', issue_date: '2026-06-10' });
    A('POST /api/invoices → 201', mk.status === 201, `status ${mk.status}`);
    const created = (await c.query(`SELECT * FROM audit_trail WHERE user_id=$1 AND table_name='invoices' AND action='CREATE'`, [uid])).rows;
    A('invoice CREATE landed in audit_trail (unified trail)', created.length === 1);
    A('CREATE is attributed actor_type=user', created[0] && created[0].actor_type === 'user' && created[0].actor_id === uid, JSON.stringify(created[0] && { at: created[0].actor_type, aid: created[0].actor_id }));
    A('CREATE stored a record snapshot in new_data', created[0] && created[0].new_data && (created[0].new_data.amount == 1000 || String(JSON.stringify(created[0].new_data)).includes('1000')), JSON.stringify(created[0] && created[0].new_data));
    const auditLogAfter = (await c.query(`SELECT COUNT(*)::int n FROM audit_log WHERE user_id=$1`, [uid])).rows[0].n;
    A('the OLD audit_log table got NO new row (logAudit no longer splits the trail)', auditLogAfter === auditLogBefore, `before ${auditLogBefore} after ${auditLogAfter}`);

    // ── side-effect recalc → actor 'system' ──
    const invId = mk.json.id ?? mk.json._dbId;
    await http.post('/api/invoice-payments', { invoice_id: invId, amount: 400, payment_date: '2026-06-20' });
    const recalc = (await c.query(`SELECT * FROM audit_trail WHERE user_id=$1 AND table_name='invoices' AND action='RECALC'`, [uid])).rows;
    A('side-effect recalc is attributed actor_type=system', recalc.length >= 1 && recalc[0].actor_type === 'system', JSON.stringify(recalc[0] && { at: recalc[0].actor_type }));

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
