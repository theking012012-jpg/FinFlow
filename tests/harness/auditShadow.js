'use strict';
/**
 * auditShadow.js — READ-ONLY MEASUREMENT INSTRUMENT for F90 (Rule 7 spirit: it changes nothing the product reads).
 *
 * Opt-in only: active when FF_AUDIT_SHADOW_OUT=<file> is set. boot.js installs it on the SCRATCH database after initDB;
 * pgScratch.stop() reports before the cluster stops. It puts an AFTER ROW trigger on every table that has a user_id
 * column and copies (table, operation, row id, account, entity, time) of every real INSERT / UPDATE / DELETE into a
 * scratch-only table, ff_shadow_changes (with the connection's pid — rows the HARNESS seeded through its own
 * connection are left out; only what the app wrote counts). At the end it compares that ground truth with audit_trail: a change with no
 * audit_trail row for the same (table, record) within ±10 s is UNRECORDED. One JSON line per run goes to the file.
 *
 * It never touches audit_trail and never runs outside a scratch cluster (pgScratch's guard has already asserted that).
 */
const fs = require('fs');

const SKIP = new Set(['audit_trail', 'audit_log', 'ff_shadow_changes']);

async function install(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS ff_shadow_changes (
    id BIGSERIAL PRIMARY KEY, tbl TEXT, op TEXT, rec TEXT, uid INTEGER, eid INTEGER, at TIMESTAMPTZ DEFAULT clock_timestamp(),
    changed_keys TEXT[], pid INTEGER DEFAULT pg_backend_pid())`);
  await client.query(`CREATE OR REPLACE FUNCTION ff_shadow_capture() RETURNS trigger AS $$
    DECLARE r JSONB; o JSONB; ks TEXT[];
    BEGIN
      r := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
      IF jsonb_typeof(r -> 'data') = 'object' THEN r := (r -> 'data') || (r - 'data'); END IF;   -- keys inside the JSONB data column count one by one
      IF TG_OP = 'UPDATE' THEN
        o := to_jsonb(OLD);
        IF jsonb_typeof(o -> 'data') = 'object' THEN o := (o -> 'data') || (o - 'data'); END IF;
        SELECT array_agg(k) INTO ks FROM jsonb_object_keys(r) k WHERE (r -> k) IS DISTINCT FROM (o -> k) AND k NOT IN ('updated_at');
        IF ks IS NULL THEN RETURN NULL; END IF;   -- a no-op UPDATE changes nothing
      END IF;
      INSERT INTO ff_shadow_changes (tbl, op, rec, uid, eid, changed_keys)
        VALUES (TG_TABLE_NAME, TG_OP, r ->> 'id', NULLIF(r ->> 'user_id','')::int,
                CASE WHEN (r ->> 'entity_id') ~ '^[0-9]+$' THEN (r ->> 'entity_id')::int END, ks);
      RETURN NULL;
    END $$ LANGUAGE plpgsql`);
  const { rows } = await client.query(`SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'user_id'`);
  for (const { table_name: t } of rows) {
    if (SKIP.has(t)) continue;
    await client.query(`DROP TRIGGER IF EXISTS ff_shadow ON "${t}"`);
    await client.query(`CREATE TRIGGER ff_shadow AFTER INSERT OR UPDATE OR DELETE ON "${t}" FOR EACH ROW EXECUTE FUNCTION ff_shadow_capture()`);
  }
}

async function report(client, label) {
  const out = process.env.FF_AUDIT_SHADOW_OUT;
  if (!out) return;
  try {
    const { rows } = await client.query(`
      SELECT s.tbl, s.op, count(*)::int AS changes,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM audit_trail a WHERE a.table_name = s.tbl AND a.record_id::text = s.rec
                 AND a.changed_at BETWEEN s.at - interval '10 seconds' AND s.at + interval '10 seconds'))::int AS unrecorded,
             (array_agg(s.changed_keys::text ORDER BY s.id) FILTER (WHERE s.op = 'UPDATE'))[1:3] AS sample_keys
        FROM ff_shadow_changes s WHERE s.pid <> pg_backend_pid()   -- the harness's own seed connection is not the app
        GROUP BY s.tbl, s.op ORDER BY s.tbl, s.op`);
    const { rows: samples } = await client.query(`
      SELECT s.tbl, s.op, s.rec, s.changed_keys FROM ff_shadow_changes s
       WHERE s.pid <> pg_backend_pid() AND NOT EXISTS (
         SELECT 1 FROM audit_trail a WHERE a.table_name = s.tbl AND a.record_id::text = s.rec
           AND a.changed_at BETWEEN s.at - interval '10 seconds' AND s.at + interval '10 seconds')
       ORDER BY s.id LIMIT 200`);
    fs.appendFileSync(out, JSON.stringify({ run: label || process.argv[1].split('/').pop(), rows, samples }) + '\n');
  } catch (e) { fs.appendFileSync(out, JSON.stringify({ run: label || process.argv[1], error: e.message }) + '\n'); }
}

module.exports = { install, report };
