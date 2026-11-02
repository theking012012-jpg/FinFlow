#!/usr/bin/env node
'use strict';
/**
 * verify-f79-status-domains — F79: status vocabularies are enforced by the DATABASE, on every status column and every
 * JSONB status the app writes (was 6 of 16 columns + 4 JSONB tables). Each vocabulary is the set the code WRITES
 * (read from every INSERT / UPDATE and form — Rule 11). Real schema on scratch Postgres (Rule 3), built by the real
 * initDB() and, separately, by the versioned migration on a database that had none of them.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f79-status-domains.js
 *
 * For every constraint: each listed value is ACCEPTED (also upper-case and ''), and a value the app never writes
 * ('bogus') is REFUSED with 23514. Bug value (HEAD): 'bogus' accepted on all 21. Plus the read-only tool lists a
 * pre-existing bad row (NOT VALID never scanned it) and changes nothing.
 */
require('./clock.js');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const V = [
 ['accountant_clients', 0, ['pending','active','suspended','revoked','expired','rejected']],
 ['accountant_earnings', 0, ['awaiting_payment','pending','paid','refunded']],
 ['accountant_invites', 0, ['pending','accepted','declined','expired']],
 ['accountant_proposals', 0, ['pending','accepted','declined','withdrawn']],
 ['accountant_reports', 0, ['open','dismissed','resolved']],
 ['accountant_tasks', 0, ['open','done']],
 ['accountants', 0, ['pending','verified','rejected','suspended']],
 ['auto_email_log', 0, ['claimed','sent']],
 ['bank_reconciliation', 0, ['matched']],
 ['bank_reconciliations', 0, ['complete','undone']],
 ['flagged_transactions', 0, ['open','resolved']],
 ['fx_transactions', 0, ['open','settled']],
 ['ledger_entries', 0, ['posted','reversed']],
 ['referral_payouts', 0, ['claimed','sent','failed']],
 ['quotes', 1, ['pending','accepted','declined','converted']],
 ['recurring_invoices', 1, ['active','paused','completed']],
 ['recurring_bills', 1, ['active','paused','completed']],
 ['recurring_personal_transactions', 1, ['active','paused','completed']],
 ['team_members', 1, ['pending','active']],
 ['support_requests', 1, ['open','resolved']],
 ['customers', 1, ['active','inactive','prospect']],
];
(async () => {
  const s = await startScratchPostgres({ keep: false }); const c = s.client;
  try {
    installEnv(s.url);
    const db = require('../../database.js'); await db.initDB();
    // Constraint tests: one savepoint per write so a refusal does not end the transaction. The statement is the
    // constraint's own expression evaluated on a probe row — the database decides, not this file.
    const { rows: cons } = await c.query(`SELECT conrelid::regclass::text tbl, conname, pg_get_expr(conbin, conrelid) expr, convalidated FROM pg_constraint WHERE contype='c' AND conname LIKE 'chk\\_%\\_status'`);
    const byT = Object.fromEntries(cons.map(k => [k.tbl, k]));
    for (const [t, js, vals] of V) {
      const k = byT[t];
      if (!k) { A(`${t}: has a status constraint`, false, 'missing'); continue; }
      // pg_get_expr prints the column as `(data ->> 'status'::text)` or `(status)::text` / `status`
      const probe = js ? k.expr.replace(/data ->> 'status'::text/g, '$1::text') : k.expr.replace(/\bstatus\b/g, '$1::text');
      const test = async v => (await c.query(`SELECT (${probe}) AS ok`, [v])).rows[0].ok;
      const okAll = []; for (const v of [...vals, ...vals.map(x => x.toUpperCase()), '']) okAll.push(await test(v));
      A(`${t}: accepts ${vals.join(' / ')} (any case, or none)`, okAll.every(Boolean), JSON.stringify(okAll));
      A(`${t}: refuses a value the app never writes ('bogus')`, (await test('bogus')) === false);
      A(`${t}: NOT VALID (old rows not scanned — Rule 8)`, k.convalidated === false);
    }
    // a REAL write is refused with 23514 (one end-to-end per kind: a real column and a JSONB status)
    const w = async (sql, p) => { try { await c.query(sql, p); return 'ok'; } catch (e) { return e.code; } };
    const uid = (await c.query(`INSERT INTO users (data) VALUES ('{"email":"f79@x.test"}') RETURNING id`)).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id, data) VALUES ($1, '{"name":"F79 Co"}') RETURNING id`, [uid])).rows[0].id;
    A('a real INSERT with a bogus quote status is refused (23514)', (await w(`INSERT INTO quotes (user_id, entity_id, data) VALUES ($1, $2, '{"status":"sent-ish"}')`, [uid, eid])) === '23514');
    A('…a real quote with status "Accepted" is stored', (await w(`INSERT INTO quotes (user_id, entity_id, data) VALUES ($1, $2, '{"status":"Accepted"}')`, [uid, eid])) === 'ok');
    A('a real UPDATE of accountant_tasks to a bogus status is refused (23514)', await (async () => {
      const a = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code, status) VALUES ('f79a@x.test','x','A','B','F79A','verified') RETURNING id`)).rows[0].id;
      const tk = (await c.query(`INSERT INTO accountant_tasks (accountant_id, user_id, title) VALUES ($1,$2,'t') RETURNING id`, [a, uid])).rows[0].id;
      return (await w(`UPDATE accountant_tasks SET status = 'finished' WHERE id = $1`, [tk])) === '23514';
    })());
    // the migration builds the same on a database that had none of them (prod path)
    for (const [t] of V) await c.query(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS chk_${t}_status`);
    await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'migrations', '2026-11-02-f79-status-domains.sql'), 'utf8'));
    const n = (await c.query(`SELECT count(*)::int n FROM pg_constraint WHERE contype='c' AND conname = ANY($1::text[])`, [V.map(([t]) => `chk_${t}_status`)])).rows[0].n;
    A(`the versioned migration adds all ${V.length} (and is idempotent)`, n === V.length && (await w(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'migrations', '2026-11-02-f79-status-domains.sql'), 'utf8'))) === 'ok', 'added ' + n);
    // the read-only tool: a row from before the constraint
    await c.query(`ALTER TABLE quotes DROP CONSTRAINT chk_quotes_status`);
    await c.query(`INSERT INTO quotes (user_id, entity_id, data) VALUES ($1, $2, '{"status":"sent"}')`, [uid, eid]);
    await c.query(`ALTER TABLE quotes ADD CONSTRAINT chk_quotes_status CHECK (COALESCE(data->>'status', '') = '' OR lower(data->>'status') IN ('pending','accepted','declined','converted')) NOT VALID`);
    const before = (await c.query(`SELECT md5(string_agg(id || ':' || data::text, ',' ORDER BY id)) h FROM quotes`)).rows[0].h;
    let out = ''; try { out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'tools', 'launch', 'list-status-violations.js')], { env: Object.assign({}, process.env, { DATABASE_URL: s.url }), encoding: 'utf8' }); } catch (e) { out = String(e.stdout) + String(e.stderr); }
    A('read-only tool lists the old "sent" quote and nothing else', /quotes\s+1 row\(s\)\s+e\.g\. #\d+ "sent"/.test(out) && /· 1 existing row\(s\) do not fit/.test(out), out.slice(-600));
    A('…and changed nothing', (await c.query(`SELECT md5(string_agg(id || ':' || data::text, ',' ORDER BY id)) h FROM quotes`)).rows[0].h === before);
    await db.pool.end();
  } finally { await s.stop(); }
  console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (F79 status domains)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR', e && e.stack); process.exit(1); });
