-- LC1c (owner decision 2026-11-01: "have code do them"): link the time entries logged before FIX-1 (no project_id) to a
-- project — ONLY where the entry's free-text project label matches exactly ONE project in the SAME business (same
-- account, same entity; case- and whitespace-insensitive). 0 or 2+ matches are never linked, never guessed. The same
-- rule as tools/fix-2026-10-19/fix1-link-exact-matches.js (verify-lc1c-link-tool), here run ONCE by the migration runner
-- on deploy, in one transaction. Each link sets only data.project_id (the label is kept) and writes one audit_trail row
-- (timesheet · UPDATE · actor system) on the entry's own business. An entry that already has a project is never touched.
WITH cand AS (
  SELECT t.id, m.project_id
    FROM timesheet t
    JOIN LATERAL (
      SELECT MIN(p.id) AS project_id, COUNT(*)::int AS n
        FROM projects p
       WHERE p.user_id = t.user_id AND p.entity_id IS NOT DISTINCT FROM t.entity_id
         AND lower(trim(p.data->>'name')) = lower(trim(COALESCE(t.data->>'project', '')))
    ) m ON m.n = 1
   WHERE t.data->>'project_id' IS NULL
     AND trim(COALESCE(t.data->>'project', '')) <> ''
),
upd AS (
  UPDATE timesheet t
     SET data = t.data || jsonb_build_object('project_id', c.project_id), updated_at = NOW()
    FROM cand c
   WHERE t.id = c.id AND t.data->>'project_id' IS NULL
  RETURNING t.id, t.user_id, t.entity_id, t.data AS new_data, (t.data - 'project_id') AS old_data
)
INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, old_data, new_data, actor_type, actor_id)
SELECT user_id, entity_id, 'timesheet', id, 'UPDATE', old_data, new_data, 'system', NULL FROM upd;
