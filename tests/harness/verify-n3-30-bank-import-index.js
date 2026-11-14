#!/usr/bin/env node
'use strict';
/**
 * verify-n3-30-bank-import-index.js — N3-30 (owner's sweep 2026-11-14: verify-import-size 120 s of a 180 s limit).
 * The time was the PRODUCT, not the test: POST /api/banking/import of a 1.2 MB statement (19,563 lines) took 113 s.
 * Its per-line "already imported?" check was `… data->>'import_key'=$2 AND entity_id IS NOT DISTINCT FROM $3`, a form
 * the unique index idx_bank_line_import_key (user_id, COALESCE(entity_id,0), import_key) cannot serve — so each NEW line
 * read every line already in the business, and an import grew with the square of the file. Same form in the Plaid and
 * Belvo feed writers.
 *
 * And each line cost THREE round trips (duplicate check, insert, audit entry): 3.2 ms a line on a local database, more on a
 * remote one — linear, but 100 s for that file on its own.
 *
 * Executed: real server + scratch Postgres (production schema). The test counts every query the route sends (wrapping
 * pg's Client in-process — not read from the source), captures its duplicate check and asks Postgres how it runs it.
 *   EXPECTED: round trips per imported line well under 1 (batched); an Index Scan on idx_bank_line_import_key, no rows
 *   read and thrown away; one audit entry per business line, as before.
 *   BUG VALUE (round trips): 3 per line (3.00).
 *   BUG VALUE (executed on the old code): a Seq Scan of personal_transactions that reads and discards every line in the
 *   business (4,502).
 * Behaviour the change must NOT alter (Rule 4: each would move if the scope or key rule changed):
 *   re-importing the same statement into the same business → 0 imported, all skipped;
 *   the same statement into ANOTHER business → all imported (scopes are separate);
 *   two genuine identical lines in one file → both kept (M33).
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const stmt = (from, n, tag) => { let s = 'date,description,amount\n'; for (let i = from; i < from + n; i++) s += `2026-0${1 + (i % 6)}-1${i % 9},${tag} line ${i},-${(i % 97) + 1}.25\n`; return s; };

(async () => {
  let scratch, server;
  try {
    scratch = await startScratchPostgres({ keep: false });
    server = await bootServer(scratch.url);
    const c = scratch.client;
    const PW = 'n330-pw-2026';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'n330@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10), onboarding_done: 1 }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', country: 'US', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', country: 'US' }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.33.0.1' });
    A('sign in', (await h.post('/api/auth/login', { email: 'n330@finflow.test', password: PW })).status === 200);
    const imp = async (eid, csv) => { const t = performance.now(); const r = await h.post(`/api/banking/import?entity_id=${eid}`, { format: 'csv', content: csv }); return { r, ms: Math.round(performance.now() - t) }; };

    console.log('\n' + '='.repeat(78) + '\n  N3-30 — a bank statement import checks duplicates through the index\n' + '='.repeat(78));
    const S1 = stmt(0, 3000, 'S1') + '2026-07-01,Coffee,-4.50\n2026-07-01,Coffee,-4.50\n';   // + two GENUINE identical lines
    const a1 = await imp(eA, S1);
    A('statement 1 → business A: 3,002 lines imported (incl. both identical coffees, M33)', a1.r.status === 201 && a1.r.json && a1.r.json.imported === 3002, a1.r.status + ' ' + a1.r.text.slice(0, 160));

    // count every query the import sends, and capture its duplicate check
    const pg = require('pg'); const oq = pg.Client.prototype.query;
    const seen = []; let sent = 0;
    pg.Client.prototype.query = function (text, params) {
      const t = typeof text === 'string' ? text : (text && text.text) || '';
      sent++;
      if (/FROM personal_transactions/.test(t) && /data->>'import_key'\s*(=\s*\$2|=\s*ANY)/.test(t) && /^\s*SELECT/.test(t)) seen.push({ text: t, params: Array.isArray(params) ? params : (text && text.values) });
      return oq.apply(this, arguments);
    };
    const auditBefore = (await c.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE table_name='bank_lines' AND entity_id=$1`, [eA])).rows[0].n;
    const a2 = await imp(eA, stmt(10000, 1500, 'S2'));
    pg.Client.prototype.query = oq;
    const auditAfter = (await c.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE table_name='bank_lines' AND entity_id=$1`, [eA])).rows[0].n;
    A('statement 2 (new lines) → business A: 1,500 imported', a2.r.status === 201 && a2.r.json && a2.r.json.imported === 1500, a2.r.status + ' ' + a2.r.text.slice(0, 160));
    const per = sent / 1500;
    console.log(`  info  ${sent} queries for 1,500 lines (sign-in check and session included) = ${per.toFixed(3)} per line`);
    A('round trips per imported line well under 1 (bug: 3.00 — check, insert, audit, each line)', per < 0.1, per.toFixed(3));
    A('one audit entry per imported business line, as before (1,500)', auditAfter - auditBefore === 1500, String(auditAfter - auditBefore));
    const au = (await c.query(`SELECT action, actor_type, (new_data->>'import_key') IS NOT NULL k, record_id IS NOT NULL r FROM audit_trail WHERE table_name='bank_lines' AND entity_id=$1 ORDER BY id DESC LIMIT 1`, [eA])).rows[0];
    A('…each a CREATE by the user, holding the line (import_key) and its record id', au && au.action === 'CREATE' && au.actor_type === 'user' && au.k && au.r, JSON.stringify(au));

    if (seen.length) {
      const q = seen[0];
      await c.query('ANALYZE personal_transactions');
      const isBatch = /ANY/.test(q.text);
      const sql = isBatch ? q.text : q.text.replace(/\$3(?!::)/g, '$3::int');
      await c.query(`PREPARE n330 AS ${sql}`);
      const args = isBatch ? `${Number(uid)}, ${Number(eA)}, ARRAY['csv:not-yet-imported-1','csv:not-yet-imported-2']` : `${Number(uid)}, 'csv:not-yet-imported', ${Number(eA)}`;
      const plan = (await c.query(`EXPLAIN (ANALYZE, FORMAT JSON) EXECUTE n330(${args})`)).rows[0]['QUERY PLAN'][0].Plan;
      const flat = []; (function walk(n) { flat.push(n); (n.Plans || []).forEach(walk); })(plan);
      const scans = flat.filter(n => /Scan/.test(n['Node Type']));
      const removed = flat.reduce((s, n) => s + (n['Rows Removed by Filter'] || 0), 0);
      console.log('  info  duplicate check: ' + scans.map(n => n['Node Type'] + ' on ' + (n['Index Name'] || n['Relation Name'])).join(' → ') + ` · rows read and discarded ${removed} (business A holds 4,502 lines)`);
      A('the duplicate check is an Index Scan on idx_bank_line_import_key (bug: a Seq Scan of the table)', scans.length === 1 && scans[0]['Index Name'] === 'idx_bank_line_import_key', JSON.stringify(scans.map(n => n['Index Name'] || n['Node Type'])));
      A('…and reads no line it then discards (bug: every line in the business, 4,502)', removed === 0, String(removed));
      await c.query('DEALLOCATE n330');
    } else A('captured the duplicate check', false, 'none seen');

    const a3 = await imp(eA, S1);
    A('statement 1 again → business A: 0 imported, 3,002 skipped (re-imports still dedupe)', a3.r.status === 201 && a3.r.json && a3.r.json.imported === 0 && a3.r.json.skipped === 3002, a3.r.text.slice(0, 160));
    const b1 = await imp(eB, S1);
    A('statement 1 → business B: 3,002 imported (another business is a separate scope)', b1.r.status === 201 && b1.r.json && b1.r.json.imported === 3002, b1.r.text.slice(0, 160));
    const ov = await imp(eA, stmt(10000, 1500, 'S2') + stmt(20000, 10, 'S3'));
    A('an overlapping statement (1,500 already in A + 10 new) → 10 imported, 1,500 skipped', ov.r.status === 201 && ov.r.json && ov.r.json.imported === 10 && ov.r.json.skipped === 1500, ov.r.text.slice(0, 160));
    const rows = (await c.query(`SELECT COALESCE(entity_id,0) e, COUNT(*)::int n FROM personal_transactions WHERE user_id=$1 GROUP BY 1 ORDER BY 1`, [uid])).rows;
    A('stored: A 4,512 lines, B 3,002, nothing in Personal', JSON.stringify(rows) === JSON.stringify([{ e: eA, n: 4512 }, { e: eB, n: 3002 }]), JSON.stringify(rows));
    console.log(`  info  import times (local, information only): A 3,002 lines ${a1.ms} ms · A +1,500 ${a2.ms} ms · A re-import ${a3.ms} ms · B ${b1.ms} ms`);
  } catch (e) { fail++; console.log('  FATAL: ' + e.message + '\n' + e.stack); }
  finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (N3-30 bank import index)` : `  ALL GREEN — ${pass} passed, 0 failed  (N3-30 bank import index)`);
  process.exit(fail ? 1 : 0);
})();
