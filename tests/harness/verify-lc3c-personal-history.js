'use strict';
/**
 * verify-lc3c-personal-history.js — LC3c (owner decision 2026-10-20: a SEPARATE personal history, never on the business
 * trail — "hard yes").
 *
 * The bug: 17 personal routes (and the personal bank feed, the scheduler's recurring personal rows, the owner's salary
 * from a paid run) changed the person's records and left no history at all. The audit trail cannot hold them — it is
 * shown on a business page (the wall). Fix: personal_history (personal-history.js) — no business column, the person's
 * own, shown on the Personal page, exported, erased with the account, append-only otherwise.
 *
 * Real scratch Postgres, real server, real routes (Rule 3). Business "Northwind" is IN VIEW throughout, so a route that
 * took its scope from req.entityId would show here (the wall). For every case: the personal_history rows written
 * (kind, action, the identifying value), AND that audit_trail gained nothing personal.
 *   bug: no personal_history table at all → every "history" assertion reads [] .
 *
 *   P1  personal transaction  CREATE 41.10 · UPDATE 41.10 → 43.20 · DELETE
 *   P2  personal account      CREATE "Car" 9,000 · UPDATE → 8,500 · DELETE
 *   P3  goal                  CREATE "Trip" target 3,000 · UPDATE current 0 → 250 · DELETE
 *   P4  personal holding      CREATE AAPL 3 · UPDATE shares 3 → 5 · DELETE
 *   P5  recurring personal    CREATE "Gym" 55 · UPDATE → 60 · DELETE
 *   P6  snapshot capture      CAPTURE networth
 *   P7  personal bank         PUT /api/personal-bank currency → USD (bank_settings UPDATE)
 *   P8  personal bank line    POST /api/banking scope=personal 12.34 (bank_lines CREATE) · DELETE
 *   P9  statement import      scope=personal CSV, 2 lines → bank_import IMPORT {imported: 2}
 *   P10 Plaid unlink          scope=personal (no provider call: Plaid not configured) → bank_link UNLINK, no token stored
 *   P11 scheduler             a due recurring personal row materialises → personal_transactions CREATE, actor system
 *   P12 owner salary          run marked PAID → owner_salary CREATE (net 1,800) · run VOIDED → owner_salary DELETE
 *   P13 the wall              audit_trail gained 0 rows of any personal kind across P1–P12; business holding
 *                             (scope=business) → audit_trail holdings CREATE on Northwind, NOT personal history
 *   P14 GET /api/personal-history: the person's rows, newest first, whichever business is in view
 *   P15 append-only           UPDATE / DELETE refused by the database
 *   P16 data export           includes personal_history
 *   P17 account deleted       personal_history rows for the person: 0 (erased); audit_trail rows kept (N18)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc3c-personal-history.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const PERSONAL_KINDS = ['personal_transactions', 'personal_accounts', 'goals', 'recurring_personal_transactions', 'snapshots',
  'personal_bank', 'bank_settings', 'bank_import', 'bank_sync', 'bank_link', 'owner_salary', 'personal_history'];

(async () => {
  let scratch, server;
  console.log('\nLC3c — a separate personal history, never on the business trail\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'lc3c@finflow.test', name: 'Pat Person', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.77' });
    if ((await http.post('/api/auth/login', { email: 'lc3c@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 300)); return r.json; };
    const ent = await J('POST', '/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('POST', '/api/entities/' + ent.id + '/activate', {});
    const eid = ent.id;

    // personal_history may not exist (the bug) → read as [].
    let mark = 0, aMark = 0;
    const hist = async () => { try { return (await c.query(`SELECT * FROM personal_history WHERE id > $1 ORDER BY id`, [mark])).rows; } catch (_) { return []; } };
    const since = async () => {
      try { mark = (await c.query(`SELECT COALESCE(MAX(id),0) m FROM personal_history`)).rows[0].m; } catch (_) { mark = 0; }
    };
    aMark = (await c.query(`SELECT COALESCE(MAX(id),0) m FROM audit_trail`)).rows[0].m;
    const ka = r => r.map(x => [x.kind, x.action]);

    // ── P1 personal transaction ──
    await since();
    const pt = await J('POST', '/api/personal-transactions', { description: 'Groceries LC3c', amount: 41.10, currency: 'USD', category: 'Groceries', tx_type: 'expense', tx_date: '2026-07-20' });
    await J('PUT', '/api/personal-transactions/' + pt.id, { amount: 43.20 });
    await J('DELETE', '/api/personal-transactions/' + pt.id);
    let h = await hist();
    eq('P1 personal transaction: CREATE · UPDATE · DELETE', ka(h), [['personal_transactions', 'CREATE'], ['personal_transactions', 'UPDATE'], ['personal_transactions', 'DELETE']], []);
    eq('P1 the change is recorded (41.10 → 43.20), on the person', h.filter(x => x.action === 'UPDATE').map(x => [x.user_id === uid, Number(x.before_data.amount), Number(x.after_data.amount)]), [[true, 41.1, 43.2]], []);

    // ── P2 personal account ──
    await since();
    const pa = await J('POST', '/api/personal-accounts', { name: 'Car', kind: 'asset', type: 'vehicle', value: 9000 });
    await J('PUT', '/api/personal-accounts/' + pa.id, { value: 8500 });
    await J('DELETE', '/api/personal-accounts/' + pa.id);
    h = await hist();
    eq('P2 personal account: CREATE · UPDATE 9,000 → 8,500 · DELETE', h.map(x => [x.kind, x.action, x.action === 'UPDATE' ? [Number(x.before_data.value), Number(x.after_data.value)] : null]),
      [['personal_accounts', 'CREATE', null], ['personal_accounts', 'UPDATE', [9000, 8500]], ['personal_accounts', 'DELETE', null]], []);

    // ── P3 goal ──
    await since();
    const g = await J('POST', '/api/goals', { name: 'Trip', target_val: 3000, current_val: 0 });
    await J('PUT', '/api/goals/' + g.id, { current_val: 250 });
    await J('DELETE', '/api/goals/' + g.id);
    h = await hist();
    eq('P3 goal: CREATE · UPDATE current 0 → 250 · DELETE', h.map(x => [x.kind, x.action, x.action === 'UPDATE' ? [Number(x.before_data.current_val), Number(x.after_data.current_val)] : null]),
      [['goals', 'CREATE', null], ['goals', 'UPDATE', [0, 250]], ['goals', 'DELETE', null]], []);

    // ── P4 personal holding ──
    await since();
    const ho = await J('POST', '/api/holdings', { ticker: 'AAPL', shares: 3, cost_per: 150, scope: 'personal' });
    await J('PUT', '/api/holdings/' + ho.id, { shares: 5 });
    await J('DELETE', '/api/holdings/' + ho.id);
    h = await hist();
    eq('P4 personal holding: CREATE · UPDATE shares 3 → 5 · DELETE', h.map(x => [x.kind, x.action, x.action === 'UPDATE' ? [Number(x.before_data.shares), Number(x.after_data.shares)] : null]),
      [['holdings', 'CREATE', null], ['holdings', 'UPDATE', [3, 5]], ['holdings', 'DELETE', null]], []);

    // ── P5 recurring personal ──
    await since();
    const rp = await J('POST', '/api/recurring-personal-transactions', { description: 'Gym', amount: 55, currency: 'USD', category: 'Health', tx_type: 'expense', frequency: 'Monthly', status: 'active', next_run: '2026-09-01' });
    await J('PUT', '/api/recurring-personal-transactions/' + rp.id, { amount: 60 });
    await J('DELETE', '/api/recurring-personal-transactions/' + rp.id);
    h = await hist();
    eq('P5 recurring personal: CREATE · UPDATE 55 → 60 · DELETE', h.map(x => [x.kind, x.action, x.action === 'UPDATE' ? [Number(x.before_data.amount), Number(x.after_data.amount)] : null]),
      [['recurring_personal_transactions', 'CREATE', null], ['recurring_personal_transactions', 'UPDATE', [55, 60]], ['recurring_personal_transactions', 'DELETE', null]], []);

    // ── P6 snapshot ──
    await since();
    await J('POST', '/api/snapshots/capture', { kind: 'networth' });
    h = await hist();
    eq('P6 snapshot capture → snapshots CAPTURE (networth)', h.map(x => [x.kind, x.action, x.after_data && x.after_data.kind]), [['snapshots', 'CAPTURE', 'networth']], []);

    // ── P7 personal bank settings ──
    await since();
    await J('PUT', '/api/personal-bank', { currency: 'USD' });
    h = await hist();
    eq('P7 personal bank currency set → bank_settings UPDATE (— → USD)', h.map(x => [x.kind, x.action, x.before_data && x.before_data.currency, x.after_data && x.after_data.currency]), [['bank_settings', 'UPDATE', null, 'USD']], []);

    // ── P8 personal bank line ──
    await since();
    const bl = await J('POST', '/api/banking?scope=personal', { desc: 'ATM LC3c', amount: 12.34, type: 'debit', date: '2026-07-21', scope: 'personal' });
    await J('DELETE', '/api/banking/' + bl.id + '?scope=personal');
    h = await hist();
    eq('P8 personal bank line: CREATE 12.34 · DELETE', h.map(x => [x.kind, x.action, Number((x.after_data || x.before_data || {}).amount)]), [['bank_lines', 'CREATE', 12.34], ['bank_lines', 'DELETE', 12.34]], []);

    // ── P9 statement import ──
    await since();
    const csv = 'Date,Description,Amount\n2026-07-10,COFFEE LC3c,-4.50\n2026-07-11,REFUND LC3c,20.00\n';
    const imp = await J('POST', '/api/banking/import?scope=personal', { format: 'csv', content: csv, scope: 'personal' });
    h = await hist();
    eq('P9 statement import → ONE bank_import IMPORT row {imported: 2}', [imp.imported, h.map(x => [x.kind, x.action, x.after_data && x.after_data.imported])], [2, [['bank_import', 'IMPORT', 2]]], [2, []]);

    // ── P10 Plaid unlink (personal) — Plaid unconfigured in the harness, so no provider call is made ──
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { key: 'plaid_items', value: JSON.stringify([{ item_id: 'item-lc3c', access_token: 'enc:not-a-real-token', institution_name: 'First Harness Bank', cursor: 'c1' }]) }]);
    await since();
    await J('POST', '/api/plaid/unlink?scope=personal', { item_id: 'item-lc3c', scope: 'personal' });
    h = await hist();
    eq('P10 Plaid unlink (personal) → bank_link UNLINK "First Harness Bank"', h.map(x => [x.kind, x.action, x.before_data && x.before_data.institution]), [['bank_link', 'UNLINK', 'First Harness Bank']], []);
    eq('P10 no token / cursor in the history row', h.filter(x => /not-a-real-token|"cursor"/.test(JSON.stringify(x))).length, 0);

    // ── P11 scheduler ──
    const app = require('../../server.js');
    await J('POST', '/api/recurring-personal-transactions', { description: 'Rent LC3c', amount: 900, currency: 'USD', category: 'Housing', tx_type: 'expense', frequency: 'Monthly', status: 'active', next_run: '2026-07-25' });
    await since();
    await app.runRecurringScheduler();
    h = await hist();
    eq('P11 scheduler materialises the due row → personal_transactions CREATE 900, actor system',
      h.map(x => [x.kind, x.action, Number(x.after_data && x.after_data.amount), x.actor_type]), [['personal_transactions', 'CREATE', 900, 'system']], []);

    // ── P12 owner salary from a paid run (and removed on void) ──
    await J('POST', '/api/payroll', { fname: 'Pat', lname: 'Person', gross: 2000, is_owner: true, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
    const run = await J('POST', '/api/payroll-runs', { period: 'July 2026', idempotency_key: 'lc3c-run' });
    await J('PUT', '/api/payroll-runs/' + run.id + '/approve', {});
    await since();
    await J('PUT', '/api/payroll-runs/' + run.id + '/mark-paid', {});
    h = await hist();
    eq('P12 run marked paid → owner_salary CREATE net 1,800', h.map(x => [x.kind, x.action, Number(x.after_data && x.after_data.amount)]), [['owner_salary', 'CREATE', 1800]], []);
    await since();
    await J('PUT', '/api/payroll-runs/' + run.id + '/void', {});
    h = await hist();
    eq('P12 run voided → owner_salary DELETE 1,800', h.map(x => [x.kind, x.action, Number(x.before_data && x.before_data.amount)]), [['owner_salary', 'DELETE', 1800]], []);

    // ── P13 the wall ──
    const leaked = (await c.query(`SELECT table_name, action FROM audit_trail WHERE id > $1 AND (table_name = ANY($2) OR (table_name = 'bank_lines' AND entity_id IS NULL) OR (table_name = 'holdings' AND entity_id IS NULL))`,
      [aMark, PERSONAL_KINDS])).rows;
    eq('P13 audit_trail gained NO personal row across P1–P12', leaked.map(x => [x.table_name, x.action]), []);
    await since();
    const aBefore = (await c.query(`SELECT COALESCE(MAX(id),0) m FROM audit_trail`)).rows[0].m;
    const bh = await J('POST', '/api/holdings', { ticker: 'MSFT', shares: 2, cost_per: 300, scope: 'business' });
    const bizAud = (await c.query(`SELECT table_name, action, entity_id, record_id FROM audit_trail WHERE id > $1 AND table_name = 'holdings'`, [aBefore])).rows;
    eq('P13 business holding → audit_trail holdings CREATE on Northwind', bizAud.map(x => [x.action, x.entity_id === eid, x.record_id === bh.id]), [['CREATE', true, true]], []);
    eq('P13 business holding → nothing in personal history', (await hist()).length, 0);

    // ── P14 the Personal page read ──
    const ph = await http.get('/api/personal-history');
    const phRows = Array.isArray(ph.json) ? ph.json : [];
    eq('P14 GET /api/personal-history → 200', ph.status, 200, 404);
    eq('P14 newest first: the last row is the owner salary removal', phRows.length ? [phRows[0].kind, phRows[0].action] : null, ['owner_salary', 'DELETE'], null);
    eq('P14 no business row in it (no business holding MSFT)', phRows.filter(x => /MSFT/.test(JSON.stringify(x))).length, 0);

    // ── P15 append-only ──
    let upd = 'allowed', del = 'allowed';
    try { await c.query(`UPDATE personal_history SET action = 'X' WHERE user_id = $1`, [uid]); } catch (e) { upd = 'refused'; }
    try { await c.query(`DELETE FROM personal_history WHERE user_id = $1`, [uid]); } catch (e) { del = 'refused'; }
    // On the buggy code there is no table — the statements fail for that reason; require the table to exist too.
    const exists = (await c.query(`SELECT to_regclass('personal_history') IS NOT NULL AS e`)).rows[0].e;
    eq('P15 append-only: UPDATE and DELETE refused (table exists)', [exists, upd, del], [true, 'refused', 'refused'], [false, 'refused', 'refused']);

    // ── P16 export ──
    const ex = await http.get('/api/auth/export');
    const exp = ex.json || {};
    eq('P16 data export includes personal_history (rows > 0)', !!(exp.data && Array.isArray(exp.data.personal_history) && exp.data.personal_history.length > 0), true, false);

    // ── P17 account deletion erases it ──
    const nAud = (await c.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE user_id = $1`, [uid])).rows[0].n;
    const del2 = await http.request('DELETE', '/api/auth/account', { password: PW });
    let left = -1; try { left = (await c.query(`SELECT COUNT(*)::int n FROM personal_history WHERE user_id = $1`, [uid])).rows[0].n; } catch (_) { left = -1; }
    eq('P17 account deleted → 200', del2.status, 200);
    eq('P17 personal history erased (0 rows left)', left, 0, -1);
    eq('P17 audit_trail kept (N18 — the business record outlives the account)', (await c.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE user_id = $1`, [uid])).rows[0].n >= nAud, true);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (server) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
