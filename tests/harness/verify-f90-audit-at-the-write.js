'use strict';
/**
 * verify-f90-audit-at-the-write — F90 part 1. The audit trail is written BY THE DATABASE, in the same transaction as every
 * change to a business's books, records or access (audit-trigger.js), with who did it (audit-context.js → finflow.ctx).
 *
 * BUG (measured 2026-11-02 with tests/harness/auditShadow.js over 54 harnesses): routes had to remember to call
 * recordAudit() after their write, in a separate statement whose failure was swallowed — payments, stock movements,
 * FX rates, period locks, credit-note edits and accountant access changes landed with no audit row, a failed audit
 * write still committed the change, and a change made outside the app left no trace at all.
 *
 * Real server + scratch Postgres (Rule 3), real routes. The ground truth for "what changed" is a shadow trigger
 * (auditShadow.js) on every table, independent of the code under test (Rule 6). Each check names the bug value.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90-audit-at-the-write.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const shadow = require('./auditShadow.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };

(async () => {
  let scratch, server;
  console.log('\nF90 — every change to the books is recorded at the write, with who did it\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    await shadow.install(c);   // ground truth: every row change, by connection
    const PW = 'harness-password-not-a-secret';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'f90w@finflow.test', name: 'Avery Owner', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.90' });
    if ((await http.post('/api/auth/login', { email: 'f90w@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' → ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
    const ent = await J('POST', '/api/entities', { name: 'Harbour Co', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('POST', '/api/entities/' + ent.id + '/activate', {});

    // ── the battery: one of each kind of change the measurement found unrecorded, plus the common ones ──
    const inv = await J('POST', '/api/invoices', { client: 'Pier Co', amount: 1200, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01' });
    await J('PUT', '/api/invoices/' + inv.id, { amount: 1250 });
    await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 400, payment_date: '2026-07-10', method: 'Bank' });
    const bill = await J('POST', '/api/bills', { vendor: 'Dock Supply', amount: 300, status: 'unpaid', issue_date: '2026-07-03', due_date: '2026-08-03' });
    await J('POST', '/api/payments-made', { vendor: 'Dock Supply', amount: 300, date: '2026-07-12', method: 'Bank', bill_id: bill.id });
    const cn = await J('POST', '/api/credit-notes', { customer: 'Pier Co', amount: 50, date: '2026-07-14', status: 'Open' });
    await J('PUT', '/api/credit-notes/' + cn.id, { amount: 60 });
    await J('DELETE', '/api/credit-notes/' + cn.id);
    const item = await J('POST', '/api/inventory', { name: 'Rope 10m', units: 5, unit_cost: 7 });
    await J('POST', '/api/inventory/' + item.id + '/restock', { qty: 3, unit_cost: 7 });
    await J('POST', '/api/fx-rates', { from_currency: 'EUR', to_currency: 'USD', rate: 1.08, rate_date: '2026-07-01' });
    await J('POST', '/api/lock-settings', { enabled: true, lock_date: '2026-06-30' });
    await J('PUT', '/api/entities/' + ent.id, { fiscal_year: 'April' });
    await J('POST', '/api/team/invite', { email: 'clerk@finflow.test', role: 'viewer', name: 'Casey Clerk' });

    // The app's own bookkeeping on a row is NOT a change anyone made, and is deliberately not recorded — stated here,
    // independently of the trigger (Rule 6): the timestamp, the business in view, number counters, the contact record
    // linked at creation, read receipts, the restock double-click marker. (A document's NUMBER is recorded.)
    const SYSTEM_ONLY = (tbl, keys) => (keys || []).length > 0 && keys.every(k => ['updated_at', 'is_active', 'customer_id', 'vendor_id',
      'client_last_read', 'accountant_last_read', 'last_restock_qty', 'last_restock_at', 'last_viewed_at', 'view_count'].includes(k) || /_seq$/.test(k));
    const appRows = async () => (await c.query(`
      SELECT s.tbl, s.op, s.rec, s.changed_keys, EXISTS (SELECT 1 FROM audit_trail a WHERE a.table_name = s.tbl AND a.record_id::text = s.rec
               AND a.action = CASE s.op WHEN 'INSERT' THEN 'CREATE' WHEN 'UPDATE' THEN 'UPDATE' ELSE 'DELETE' END) AS recorded
        FROM ff_shadow_changes s WHERE s.pid <> pg_backend_pid() AND s.tbl = ANY($1)`, [require('../../audit-trigger.js').AUDITED_TABLES])).rows;
    const rows = (await appRows()).filter(r => !(r.op === 'UPDATE' && SYSTEM_ONLY(r.tbl, r.changed_keys)));
    const missing = rows.filter(r => !r.recorded).map(r => r.tbl + '/' + r.op + '#' + r.rec);
    A('the battery changed rows in ≥ 10 audited tables (the seed exercises the class)', new Set(rows.map(r => r.tbl)).size >= 10, [...new Set(rows.map(r => r.tbl))].join(','));
    eq('every row the app changed in an audited table has its own audit row (CREATE / UPDATE / DELETE) — unrecorded', missing, [],
      'bug: payments, stock movements, FX rates, the period lock, credit-note edits …');

    // who did it, from where
    const pay = (await c.query(`SELECT actor_type, actor_id, ip_address, to_jsonb(audit_trail)->>'source' AS source, new_data->>'amount' AS amt FROM audit_trail WHERE table_name = 'invoice_payments' AND action = 'CREATE' ORDER BY id DESC LIMIT 1`)).rows[0] || {};
    eq('the payment\'s record: the owner, their IP, from POST /api/invoice-payments, amount 400', [pay.actor_type, pay.actor_id, pay.ip_address, pay.source, Number(pay.amt)],
      ['user', uid, '203.0.113.90', 'web POST /api/invoice-payments', 400]);
    const ed = (await c.query(`SELECT old_data->>'amount' AS o, new_data->>'amount' AS n, ARRAY(SELECT jsonb_array_elements_text(COALESCE(to_jsonb(audit_trail)->'changed_fields', '[]'))) AS changed_fields FROM audit_trail WHERE table_name = 'invoices' AND record_id = $1 AND action = 'UPDATE' ORDER BY id`, [inv.id])).rows;
    A('the invoice edit is one UPDATE row: amount 1,200 → 1,250 among its changed fields', ed.some(r => Number(r.o) === 1200 && Number(r.n) === 1250 && (r.changed_fields || []).includes('amount')), JSON.stringify(ed));
    eq('the invoice was recorded as created ONCE (no second copy from the route)', (await c.query(`SELECT count(*)::int n FROM audit_trail WHERE table_name = 'invoices' AND record_id = $1 AND action = 'CREATE'`, [inv.id])).rows[0].n, 1, 2);
    const invHist = (await http.get('/api/audit-trail?table=invoices&record_id=' + inv.id)).json || [];
    const created = invHist.filter(e => e.action === 'CREATE');
    A('the invoice\'s creation is ONE event and carries the number it was given (INV-0001), not a separate "edit"', created.length === 1 && created[0].new_data && created[0].new_data.number === 'INV-0001' && !invHist.some(e => e.action === 'UPDATE' && JSON.stringify(e.changed_fields) === '["number"]'), JSON.stringify(invHist.map(e => [e.action, e.changed_fields, e.new_data && e.new_data.number])));
    eq('switching the business in view is not a change to the books (no entities row for is_active)', (await c.query(`SELECT count(*)::int n FROM audit_trail WHERE table_name = 'entities' AND action = 'UPDATE' AND (to_jsonb(audit_trail)->'changed_fields' = '["is_active"]'::jsonb OR (field_name = 'is_active'))`)).rows[0].n, 0);
    const fy = (await c.query(`SELECT old_data->>'fiscal_year' AS o, new_data->>'fiscal_year' AS n FROM audit_trail WHERE table_name = 'entities' AND record_id = $1 AND (to_jsonb(audit_trail)->'changed_fields' ? 'fiscal_year' OR (old_data->>'fiscal_year') IS DISTINCT FROM (new_data->>'fiscal_year'))`, [ent.id])).rows[0] || {};
    eq('the business\'s fiscal year change is recorded: (none) → April', [fy.o, fy.n], [null, 'April']);
    const tm = (await c.query(`SELECT new_data FROM audit_trail WHERE table_name = 'team_members' AND action = 'CREATE' ORDER BY id DESC LIMIT 1`)).rows[0];
    A('the team invite is recorded without its secret token', !!tm && !Object.keys(tm.new_data || {}).some(k => /token|hash|secret|password/i.test(k)) && tm.new_data.email === 'clerk@finflow.test', JSON.stringify(tm && tm.new_data));

    // ── atomic: if the record cannot be written, the change does not happen ──
    await c.query(`ALTER TABLE audit_trail ADD CONSTRAINT harness_refuse_expenses CHECK (table_name IS DISTINCT FROM 'expenses') NOT VALID`);
    const before = (await c.query(`SELECT count(*)::int n FROM expenses WHERE user_id = $1`, [uid])).rows[0].n;
    const r = await http.request('POST', '/api/expenses', { description: 'Fuel', category: 'Travel', amount: 75, expense_date: '2026-07-15' });
    const after = (await c.query(`SELECT count(*)::int n FROM expenses WHERE user_id = $1`, [uid])).rows[0].n;
    await c.query(`ALTER TABLE audit_trail DROP CONSTRAINT harness_refuse_expenses`);
    eq('when its audit row cannot be written, the expense is NOT saved (status ≥ 500, no new row)', [r.status >= 500, after - before], [true, 0], [false, 1]);

    // ── a change made OUTSIDE the app (straight in the database) is recorded too ──
    await c.query(`UPDATE invoices SET data = data || '{"amount": 9999}'::jsonb WHERE id = $1`, [inv.id]);
    const ext = (await c.query(`SELECT actor_type, to_jsonb(audit_trail)->>'source' AS source, old_data->>'amount' AS o, new_data->>'amount' AS n FROM audit_trail WHERE table_name = 'invoices' AND record_id = $1 AND action = 'UPDATE' ORDER BY id DESC LIMIT 1`, [inv.id])).rows[0] || {};
    eq('a direct database edit is recorded: system / database, 1,250 → 9,999', [ext.actor_type, ext.source, Number(ext.o), Number(ext.n)], ['system', 'database', 1250, 9999]);

    // ── a background job is recorded as FinFlow (automatic), with the job's name ──
    await J('POST', '/api/recurring-invoices', { client: 'Monthly Co', amount: 80, frequency: 'Monthly', next_run: '2026-07-01' });
    const app = require('../../server.js');
    await app._jobs.recurring();
    const job = (await c.query(`SELECT actor_type, to_jsonb(audit_trail)->>'source' AS source FROM audit_trail WHERE table_name = 'invoices' AND action = 'CREATE' AND new_data->>'client' = 'Monthly Co' ORDER BY id DESC LIMIT 1`)).rows[0] || {};
    eq('the invoice the recurring job raised: system, job:recurring-scheduler', [job.actor_type, job.source], ['system', 'job:recurring-scheduler']);

    // ── erasing an account records ONE event, not a copy of every row it held ──
    const n0 = (await c.query(`SELECT count(*)::int n FROM audit_trail WHERE user_id = $1`, [uid])).rows[0].n;
    const del = await http.request('DELETE', '/api/auth/account', { password: PW });
    const n1 = (await c.query(`SELECT count(*)::int n FROM audit_trail WHERE user_id = $1`, [uid])).rows[0].n;
    eq('account deletion: 200, and the trail grows by exactly one row (ACCOUNT_DELETED)', [del.status, n1 - n0], [200, 1]);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (server) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed` : `  ALL GREEN — ${pass} passed, 0 failed  (F90 audit at the write)`);
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
