'use strict';
/**
 * fix1-link-exact-matches.js — LC1c data fix, PREPARED, OWNER-RUN (Rule 8). DRY RUN BY DEFAULT.
 *
 * Links the time entries logged before FIX-1 (no project_id) to a project ONLY where the entry's free-text project label
 * matches exactly ONE project in the SAME business (same account, same entity; case- and whitespace-insensitive) — the
 * same rule fix1-unlinked-time-entries.js shows as a "candidate". 0 or 2+ matches are never linked, never guessed.
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"
 *     node tools/fix-2026-10-19/fix1-link-exact-matches.js                  # dry run: lists, changes NOTHING
 *     node tools/fix-2026-10-19/fix1-link-exact-matches.js --apply --expect N   # N = the count the dry run printed
 *     Remove-Item Env:DATABASE_URL
 *
 * --apply refuses unless --expect equals the number of links computed NOW (so nothing is linked that you did not review).
 * One transaction: every link or none. Each link sets ONLY data.project_id (the label is kept) and writes one
 * audit_trail row (timesheet · UPDATE · actor system) on the entry's own business, so the business's Audit page shows
 * the change. Re-running after an apply links 0 (an entry with a project_id is never touched).
 * Imports only `pg` — no database.js, so no initDB DDL (Rule 7).
 */
const { Client } = require('pg');

const CANDIDATES_SQL = `
  SELECT t.id, t.user_id, t.entity_id, t.data AS old_data, m.project_id, m.project_name
    FROM timesheet t
    JOIN LATERAL (
      SELECT MIN(p.id) AS project_id, MIN(p.data->>'name') AS project_name, COUNT(*)::int AS n
        FROM projects p
       WHERE p.user_id = t.user_id AND p.entity_id IS NOT DISTINCT FROM t.entity_id
         AND lower(trim(p.data->>'name')) = lower(trim(COALESCE(t.data->>'project', '')))
    ) m ON m.n = 1
   WHERE t.data->>'project_id' IS NULL
     AND trim(COALESCE(t.data->>'project', '')) <> ''
   ORDER BY t.user_id, t.entity_id, t.id`;

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ei = args.indexOf('--expect');
  const expect = ei >= 0 ? parseInt(args[ei + 1], 10) : null;
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node fix1-link-exact-matches.js [--apply --expect N]'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    if (!apply) {
      await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');   // dry run cannot write, by construction
      const { rows } = await c.query(CANDIDATES_SQL);
      console.log('DRY RUN — nothing changed. Entries that WOULD be linked (exactly one same-business name match):');
      console.table(rows.map(r => ({ entry: r.id, account: r.user_id, business: r.entity_id, label: r.old_data.project, hours: r.old_data.hours, '→ project': r.project_id, project_name: r.project_name })));
      console.log(`WOULD LINK: ${rows.length}`);
      console.log(`To apply exactly these: node tools/fix-2026-10-19/fix1-link-exact-matches.js --apply --expect ${rows.length}`);
      return;
    }
    if (!Number.isInteger(expect)) { console.error('REFUSED: --apply needs --expect N (the WOULD LINK count from the dry run you reviewed).'); process.exitCode = 2; return; }
    await c.query('BEGIN');
    const { rows } = await c.query(CANDIDATES_SQL + ' FOR UPDATE OF t');
    if (rows.length !== expect) {
      await c.query('ROLLBACK');
      console.error(`REFUSED: ${rows.length} entries would be linked now, but --expect ${expect}. The data changed since your dry run — run the dry run again and review it.`);
      process.exitCode = 3; return;
    }
    for (const r of rows) {
      const { rows: [nu] } = await c.query(
        `UPDATE timesheet SET data = data || jsonb_build_object('project_id', $2::int), updated_at = NOW()
          WHERE id = $1 AND data->>'project_id' IS NULL RETURNING data`, [r.id, r.project_id]);
      if (!nu) throw new Error('entry ' + r.id + ' changed during the run');
      await c.query(
        `INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, old_data, new_data, actor_type, actor_id)
         VALUES ($1, $2, 'timesheet', $3, 'UPDATE', $4, $5, 'system', NULL)`,
        [r.user_id, r.entity_id, r.id, JSON.stringify(r.old_data), JSON.stringify(nu.data)]);
    }
    await c.query('COMMIT');
    console.log(`APPLIED: linked ${rows.length} time entr${rows.length === 1 ? 'y' : 'ies'} (one audit row each).`);
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    console.error('FAILED — nothing changed:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
    if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
