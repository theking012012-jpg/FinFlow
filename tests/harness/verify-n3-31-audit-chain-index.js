#!/usr/bin/env node
'use strict';
/**
 * verify-n3-31-audit-chain-index.js — N3-31 (found 2026-11-14 while chasing N3-30's slow statement import).
 * Every audit entry passes through the tamper-evidence trigger ff_audit_chain (2026-11-02-audit-at-the-write.sql), which
 * finds the account's latest entry with `user_id IS NOT DISTINCT FROM NEW.user_id … ORDER BY chain_seq DESC LIMIT 1`.
 * The index for it, idx_audit_trail_chain, is on (COALESCE(user_id, 0), chain_seq) — a form that predicate cannot use —
 * so EVERY audited write in the app first scanned and sorted the account's whole trail, and got slower for the life of
 * the account (executed: 5,000 entries took 2.7 s into an empty account, 8.1 s into one holding 5,000).
 *
 * Executed on a scratch Postgres with the production schema (initDB + every migration), counting the rows Postgres
 * ACTUALLY reads from audit_trail (pg_stat_user_tables, flushed) — not reading the SQL.
 *   EXPECTED: 200 new entries into an account holding 3,000 read < 3,000 rows in all (not even one full pass).
 *   BUG VALUE: ≈ 200 × 3,000 = 600,000 rows read (one full scan per entry).
 * And the change must not break the chain (what is hashed is unchanged):
 *   · a trail written partly by the OLD trigger and partly by the NEW one verifies end to end, numbers 1 … N unbroken;
 *   · system entries (no user) keep their own unbroken chain;
 *   · a real app write (POST /api/expenses) lands on the account's chain at the next number and the trail verifies.
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const OLD_FN = (() => {   // the trigger as the 2026-11-02 migration installs it (executed below, to build a pre-fix trail)
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'migrations', '2026-11-02-audit-at-the-write.sql'), 'utf8');
  const i = sql.indexOf('CREATE OR REPLACE FUNCTION ff_audit_chain()'); const j = sql.indexOf('LANGUAGE plpgsql;', i) + 'LANGUAGE plpgsql;'.length;
  return sql.slice(i, j);
})();
const NEW_FN = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'migrations', '2026-11-14-audit-chain-index-lookup.sql'), 'utf8');

(async () => {
  let scratch, server;
  try {
    scratch = await startScratchPostgres({ keep: false });
    server = await bootServer(scratch.url);
    const c = scratch.client;
    console.log('\n' + '='.repeat(78) + '\n  N3-31 — the audit chain finds the latest entry through its index\n' + '='.repeat(78));
    const mk = async email => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', password: bcrypt.hashSync('n331-pw-2026', 10), onboarding_done: 1 }])).rows[0].id;
    const add = (uid, n, tag) => c.query(`INSERT INTO audit_trail (user_id, table_name, action, new_data) SELECT $1, 'n331', 'EVENT', jsonb_build_object('i', g, 't', $3::text) FROM generate_series(1, $2::int) g`, [uid, n, tag]);
    const reads = async () => { await c.query('SELECT pg_stat_force_next_flush()'); const r = (await c.query(`SELECT COALESCE(seq_tup_read,0)::bigint s, COALESCE(idx_tup_fetch,0)::bigint i FROM pg_stat_user_tables WHERE relname='audit_trail'`)).rows[0]; return Number(r.s) + Number(r.i); };
    const verify = async uid => (await c.query(`SELECT * FROM ff_audit_verify($1)`, [uid])).rows[0];
    const seqs = async uid => (await c.query(`SELECT array_agg(chain_seq ORDER BY chain_seq) a FROM audit_trail WHERE user_id IS NOT DISTINCT FROM $1 AND chain_seq IS NOT NULL`, [uid])).rows[0].a || [];
    const unbroken = a => a.every((v, k) => Number(v) === k + 1);

    // 1. rows read per entry, with the trigger the app runs (production schema as booted)
    const u1 = await mk('n331-a@finflow.test');
    await add(u1, 3000, 'base');
    const r0 = await reads();
    await add(u1, 200, 'measured');
    const read = (await reads()) - r0;
    console.log(`  info  200 new entries into an account holding 3,000: ${read.toLocaleString('en-US')} rows read from audit_trail`);
    A('200 new entries read fewer rows than ONE pass over the account (< 3,000) — bug: ≈ 600,000 (a full scan per entry)', read < 3000, String(read));
    const v1 = await verify(u1);
    A('…and the account\'s trail verifies: 3,200 entries, numbered 1 … 3,200, nothing broken', v1 && Number(v1.entries) === 3200 && v1.bad_id == null && unbroken(await seqs(u1)), JSON.stringify(v1));

    // 2. a trail written partly before the fix and partly after verifies end to end
    const u2 = await mk('n331-b@finflow.test');
    await c.query(OLD_FN);
    await add(u2, 500, 'before the fix');
    await c.query(NEW_FN);
    await add(u2, 500, 'after the fix');
    const v2 = await verify(u2), s2 = await seqs(u2);
    A('a trail written 500 by the OLD trigger then 500 by the NEW one verifies end to end, numbered 1 … 1,000', v2 && Number(v2.entries) === 1000 && v2.bad_id == null && s2.length === 1000 && unbroken(s2), JSON.stringify(v2));

    // 3. system entries (no user) keep their own chain
    const sys0 = (await seqs(null)).length;
    await c.query(`INSERT INTO audit_trail (user_id, table_name, action) SELECT NULL, 'n331', 'SYSTEM' FROM generate_series(1, 3)`);
    const ss = await seqs(null), vs = await verify(null);
    A('system entries (no user) continue their own chain: 3 more, numbers unbroken, verifies', ss.length === sys0 + 3 && unbroken(ss) && vs && vs.bad_id == null, JSON.stringify({ n: ss.length, v: vs }));

    // 4. a real app write lands on the account's chain at the next number
    const h = new HarnessHttp(server.baseUrl, { xff: '10.31.0.1' });
    const u3 = await mk('n331-c@finflow.test');
    await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [u3, { name: 'C Co', currency: 'USD', country: 'US', is_active: 1 }]);
    A('sign in', (await h.post('/api/auth/login', { email: 'n331-c@finflow.test', password: 'n331-pw-2026' })).status === 200);
    const before = (await seqs(u3)).length;
    const ex = await h.post('/api/expenses', { description: 'Chain check', category: 'Rent', amount: 42, expense_date: '2026-07-11', idempotency_key: 'n331-exp' });
    const s3 = await seqs(u3), v3 = await verify(u3);
    const exRow = (await c.query(`SELECT chain_seq FROM audit_trail WHERE user_id=$1 AND table_name='expenses' AND action='CREATE' ORDER BY id DESC LIMIT 1`, [u3])).rows[0];
    A('POST /api/expenses → its CREATE entry is on the account\'s chain at the next number, and the trail verifies', ex.status < 300 && exRow && Number(exRow.chain_seq) > before && unbroken(s3) && v3 && v3.bad_id == null, JSON.stringify({ status: ex.status, before, after: s3.length, entry: exRow, v3 }));
  } catch (e) { fail++; console.log('  FATAL: ' + e.message + '\n' + e.stack); }
  finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (N3-31 audit chain index)` : `  ALL GREEN — ${pass} passed, 0 failed  (N3-31 audit chain index)`);
  process.exit(fail ? 1 : 0);
})();
