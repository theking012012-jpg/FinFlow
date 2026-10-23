'use strict';
/**
 * number-existing-invoices.js — B1b (2026-10-23) data step, PREPARED, OWNER-RUN (Rule 8). DRY RUN BY DEFAULT.
 *
 * Gives a number to every invoice made before numbering existed. Per business, oldest first (issue date, then id), each
 * takes the NEXT number in that business's own sequence and prefix — the same counter new invoices use — so an existing
 * invoice never takes a number already issued, and the counter only rises. A number already held in the business is
 * skipped. Invoices that already have a number are never touched; duplicate numbers are NOT changed here (list them
 * with list-invoice-numbers.js — which invoice keeps a number is the owner's decision).
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"
 *     node tools/launch/number-existing-invoices.js                  # dry run: lists, changes NOTHING
 *     node tools/launch/number-existing-invoices.js --apply --expect N   # N = the count the dry run printed
 *     Remove-Item Env:DATABASE_URL
 *
 * --apply refuses unless --expect equals the number of invoices to number NOW. One transaction: all or nothing. Each
 * invoice gets data.number and one audit_trail row (invoices · UPDATE · actor system) on its own business. Re-running
 * after an apply numbers 0. Imports only `pg` — no database.js, so no initDB DDL (Rule 7).
 */
const { Client } = require('pg');

const TODO_SQL = `
  SELECT i.id, i.user_id, i.entity_id, i.data AS old_data
    FROM invoices i JOIN entities e ON e.id = i.entity_id AND e.user_id = i.user_id
   WHERE i.data->>'number' IS NULL
   ORDER BY i.user_id, i.entity_id, COALESCE(i.data->>'issue_date', to_char(i.created_at, 'YYYY-MM-DD')), i.id`;

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ei = args.indexOf('--expect');
  const expect = ei >= 0 ? parseInt(args[ei + 1], 10) : null;
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node tools/launch/number-existing-invoices.js [--apply --expect N]'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    if (!apply) await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');   // dry run cannot write, by construction
    await c.query('BEGIN');
    const { rows } = await c.query(TODO_SQL + (apply ? ' FOR UPDATE OF i' : ''));
    if (apply && !Number.isInteger(expect)) { await c.query('ROLLBACK'); console.error('REFUSED: --apply needs --expect N (the WOULD NUMBER count from the dry run you reviewed).'); process.exitCode = 2; return; }
    if (apply && rows.length !== expect) { await c.query('ROLLBACK'); console.error(`REFUSED: ${rows.length} invoices would be numbered now, but --expect ${expect}. The data changed since your dry run — run it again and review it.`); process.exitCode = 3; return; }
    // Plan the numbers per business: continue the business's own counter, skip any number already held there.
    const ents = new Map();
    const plan = [];
    for (const r of rows) {
      const k = r.user_id + ':' + r.entity_id;
      if (!ents.has(k)) {
        const { rows: [e] } = await c.query(`SELECT COALESCE(NULLIF(data->>'invoice_prefix',''),'INV-') AS prefix, COALESCE((data->>'invoice_seq')::int,0) AS seq FROM entities WHERE id=$1 AND user_id=$2` + (apply ? ' FOR UPDATE' : ''), [r.entity_id, r.user_id]);
        const { rows: taken } = await c.query(`SELECT data->>'number' AS n FROM invoices WHERE user_id=$1 AND entity_id=$2 AND data->>'number' IS NOT NULL`, [r.user_id, r.entity_id]);
        ents.set(k, { prefix: e.prefix, seq: e.seq, taken: new Set(taken.map(t => t.n)) });
      }
      const st = ents.get(k);
      let n; do { st.seq++; n = st.prefix + String(st.seq).padStart(4, '0'); } while (st.taken.has(n));
      st.taken.add(n);
      plan.push({ r, number: n, seq: st.seq });
    }
    if (!apply) {
      await c.query('ROLLBACK');
      console.log('DRY RUN — nothing changed. Invoices that WOULD be numbered (oldest first, per business):');
      console.table(plan.map(p => ({ invoice: p.r.id, account: p.r.user_id, business: p.r.entity_id, client: p.r.old_data.client, issued: p.r.old_data.issue_date || '', amount: p.r.old_data.amount, '→ number': p.number })));
      console.log(`WOULD NUMBER: ${plan.length}`);
      console.log(`To apply exactly these: node tools/launch/number-existing-invoices.js --apply --expect ${plan.length}`);
      return;
    }
    for (const p of plan) {
      const { rows: [nu] } = await c.query(`UPDATE invoices SET data = data || jsonb_build_object('number', $2::text), updated_at = NOW() WHERE id = $1 AND data->>'number' IS NULL RETURNING data`, [p.r.id, p.number]);
      if (!nu) throw new Error('invoice ' + p.r.id + ' changed during the run');
      await c.query(`INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, field_name, old_value, new_value, actor_type, actor_id)
                     VALUES ($1, $2, 'invoices', $3, 'UPDATE', 'number', NULL, $4, 'system', NULL)`, [p.r.user_id, p.r.entity_id, p.r.id, p.number]);
    }
    for (const [k, st] of ents) {
      const [uid, eid] = k.split(':').map(Number);
      await c.query(`UPDATE entities SET data = jsonb_set(data, '{invoice_seq}', to_jsonb(GREATEST(COALESCE((data->>'invoice_seq')::int,0), $3::int))) WHERE id=$1 AND user_id=$2`, [eid, uid, st.seq]);
    }
    await c.query('COMMIT');
    console.log(`APPLIED: numbered ${plan.length} invoice${plan.length === 1 ? '' : 's'} (one audit row each).`);
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    console.error('FAILED — nothing changed:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
    if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
