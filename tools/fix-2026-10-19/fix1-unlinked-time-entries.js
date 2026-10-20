'use strict';
/**
 * fix1-unlinked-time-entries.js — READ-ONLY (Rule 7 / Rule 8). FIX-1, live check 2026-10-19.
 *
 * Before FIX-1 a time entry named its project only as free text (`timesheet.data.project`); nothing linked it to a
 * project row, so no project ever showed logged hours. FIX-1 links NEW entries by `project_id`. Existing entries stay
 * unlinked — whether (and how) to link them is the owner's decision, in its own commit. This lists what exists:
 *   1. per business: linked vs unlinked entries, with hours and billable value
 *   2. every unlinked entry, with the project in the SAME business whose name matches its label exactly
 *      (case- and whitespace-insensitive) — a CANDIDATE only; 0 or 2+ matches are shown as such, never guessed
 *
 *   PowerShell (a NEW window; never paste the URL into chat):
 *     $env:DATABASE_URL="<prod url>"; node tools/fix-2026-10-19/fix1-unlinked-time-entries.js; Remove-Item Env:DATABASE_URL
 *
 * SELECT statements only, no transaction control, no write mode. Imports only `pg` (no database.js — no initDB DDL).
 */
const { Client } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node fix1-unlinked-time-entries.js'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const { rows: summary } = await c.query(
      `SELECT t.user_id, t.entity_id, e.data->>'name' AS business,
              COUNT(*) FILTER (WHERE t.data->>'project_id' IS NOT NULL)::int AS linked,
              COUNT(*) FILTER (WHERE t.data->>'project_id' IS NULL)::int AS unlinked,
              COALESCE(SUM((t.data->>'hours')::numeric) FILTER (WHERE t.data->>'project_id' IS NULL), 0) AS unlinked_hours,
              COALESCE(SUM((t.data->>'hours')::numeric * COALESCE((t.data->>'rate')::numeric, 0))
                FILTER (WHERE t.data->>'project_id' IS NULL AND t.data->>'billable' = 'Yes'), 0) AS unlinked_billable_value
         FROM timesheet t LEFT JOIN entities e ON e.id = t.entity_id
        GROUP BY 1, 2, 3 ORDER BY 1, 2`);
    console.log('1. TIME ENTRIES PER BUSINESS'); console.table(summary);
    const { rows: detail } = await c.query(
      `SELECT t.id, t.user_id, t.entity_id, t.data->>'employee' AS employee, t.data->>'date' AS date,
              t.data->>'hours' AS hours, t.data->>'billable' AS billable, t.data->>'rate' AS rate,
              t.data->>'project' AS label,
              (SELECT COUNT(*)::int FROM projects p WHERE p.user_id = t.user_id AND p.entity_id IS NOT DISTINCT FROM t.entity_id
                  AND lower(trim(p.data->>'name')) = lower(trim(COALESCE(t.data->>'project', '')))) AS name_matches,
              (SELECT MIN(p.id) FROM projects p WHERE p.user_id = t.user_id AND p.entity_id IS NOT DISTINCT FROM t.entity_id
                  AND lower(trim(p.data->>'name')) = lower(trim(COALESCE(t.data->>'project', '')))) AS candidate_project_id
         FROM timesheet t
        WHERE t.data->>'project_id' IS NULL
        ORDER BY t.user_id, t.entity_id, t.id`);
    console.log('2. UNLINKED ENTRIES (candidate_project_id is shown only as a candidate; name_matches ≠ 1 means no safe match)');
    console.table(detail.map(r => Object.assign(r, { candidate_project_id: r.name_matches === 1 ? r.candidate_project_id : null })));
    console.log(`unlinked entries: ${detail.length} · with exactly one same-business name match: ${detail.filter(r => r.name_matches === 1).length}`);
  } catch (err) {
    console.error('FAILED:', err && err.message, '\n code:', err && err.code, '\n', err && err.stack);
    if (err instanceof AggregateError) err.errors.forEach(e => console.error(' -', e && e.message));
    process.exitCode = 1;
  } finally { try { await c.end(); } catch (_) {} }
})();
