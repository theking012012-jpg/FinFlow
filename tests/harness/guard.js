'use strict';
/**
 * guard.js — the "never test against production" rule, made mechanical.
 *
 * CLAUDE.md Rule 3 says "Scratch database only. Never test against production." That is a
 * sentence in a document; a sentence cannot stop a connection. This file can.
 *
 * THE SPECIFIC HAZARD THIS EXISTS FOR (logged as F78):
 *   `require('./server.js')` calls initDB() at import time, unawaited (server.js:4750).
 *   initDB() runs CREATE TABLE / CREATE INDEX / ALTER TABLE across ~40 tables AND a
 *   data-modifying backfill:
 *       UPDATE invoices SET data = jsonb_set(data,'{amount_paid}',data->'amount') ...
 *       (database.js:110-116)
 *   So merely importing the server WRITES to whatever DATABASE_URL is set. If a production
 *   DATABASE_URL is in the environment, that write lands on the owner's live books before a
 *   single line of harness code runs. Nothing downstream can undo it.
 *
 * THE RULE: the harness never reads DATABASE_URL. It builds its own scratch URL and
 * installs it. Any inherited DATABASE_URL is scrubbed at import, before any module that
 * might read it is loaded.
 */

const PROD_HOST_MARKERS = [
  /supabase\.(co|com|net)$/i,
  /\.pooler\./i,
  /railway\.app$/i,
  /neon\.tech$/i,
  /rds\.amazonaws\.com$/i,
  /render\.com$/i,
  /\.azure\.com$/i,
  /cloudsql/i,
];

const SCRATCH_DB_NAME = /^finflow_scratch(_[a-z0-9]+)?$/i;
const MARKER_TABLE = '__finflow_scratch_marker';

function isLoopbackHost(host) {
  if (!host) return false;
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Remove any inherited DATABASE_URL. Returns a description of what was found so the run
 * report can state it — a scrubbed production URL is worth SAYING, not silently handling.
 */
function scrubInheritedDatabaseUrl() {
  const found = process.env.DATABASE_URL;
  if (!found) return { present: false };
  delete process.env.DATABASE_URL;
  let host = '(unparseable)';
  try { host = new URL(found).host; } catch { /* keep placeholder */ }
  return { present: true, host };
}

/**
 * Refuse anything that is not a loopback scratch database.
 *
 * Loopback-only is deliberate and stricter than it needs to be for embedded Postgres, which
 * always binds 127.0.0.1. It is written this way so that pointing the harness at a REMOTE
 * database is an explicit, visible code change rather than an environment variable someone
 * sets in a hurry. The remote-scratch option was considered and rejected precisely because
 * production and scratch would then differ only by a connection string.
 */
function assertScratchUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) {
    throw new Error(`[guard] REFUSED — connection string does not parse: ${e.message}`);
  }

  if (!/^postgres(ql)?:$/i.test(u.protocol)) {
    throw new Error(`[guard] REFUSED — not a postgres URL (protocol "${u.protocol}").`);
  }

  for (const marker of PROD_HOST_MARKERS) {
    if (marker.test(u.hostname)) {
      throw new Error(
        `[guard] REFUSED — host "${u.hostname}" matches a managed-database marker (${marker}).\n`
        + `  This looks like production or another live environment. The harness only ever runs\n`
        + `  against a loopback scratch cluster it created itself.`
      );
    }
  }

  if (!isLoopbackHost(u.hostname)) {
    throw new Error(
      `[guard] REFUSED — host "${u.hostname}" is not loopback.\n`
      + `  The harness connects to 127.0.0.1 only. Running against a remote database requires an\n`
      + `  explicit change to tests/harness/guard.js, not an environment variable.`
    );
  }

  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!SCRATCH_DB_NAME.test(dbName)) {
    throw new Error(
      `[guard] REFUSED — database name "${dbName}" does not match ${SCRATCH_DB_NAME}.\n`
      + `  The harness truncates every table it touches; it will only do that to a database\n`
      + `  whose name says out loud that it is scratch.`
    );
  }

  return { host: u.hostname, port: u.port, database: dbName };
}

/**
 * Verify the LIVE connection is what the URL claimed, and capture the substrate facts.
 *
 * A URL is an intention; current_database() is a fact. They can disagree — a pooler or a
 * search_path can land you somewhere other than where the string said.
 *
 * The timezone assertion is not defensive padding. This codebase's live date defects
 * (Rule 10; run_date stamped NOW() in UTC vs period windows computed in local time) are
 * month-boundary bugs. A scratch cluster running in host-local time against a UTC production
 * would produce confidently wrong results on exactly the checks most worth trusting — and it
 * would look green. So: UTC is required, and a mismatch is fatal.
 */
async function assertScratchDatabase(client) {
  // One query, explicit aliases.
  //
  // Two traps avoided here, both hit while building this:
  //   · `SHOW lc_collate` does NOT exist from PostgreSQL 15 onwards — collation became a
  //     per-database property (pg_database.datcollate), not a runtime GUC. `SHOW` throws 42704.
  //   · `SHOW timezone` returns a column named "TimeZone", not "timezone", so reading the
  //     result by a lower-cased key yields undefined — which would have made the UTC
  //     assertion compare against `undefined` and pass or fail for the wrong reason.
  // Aliasing every column removes both classes of guesswork.
  const { rows: [row] } = await client.query(`
    SELECT current_database()                  AS database,
           current_user                        AS usr,
           current_setting('server_version')   AS server_version,
           current_setting('TimeZone')         AS timezone,
           current_setting('server_encoding')  AS server_encoding,
           current_setting('DateStyle')        AS datestyle,
           d.datcollate                        AS lc_collate,
           d.datctype                          AS lc_ctype
      FROM pg_database d
     WHERE d.datname = current_database()
  `);

  if (!row) {
    throw new Error('[guard] REFUSED — could not read pg_database for the current database.');
  }
  if (!SCRATCH_DB_NAME.test(row.database)) {
    throw new Error(
      `[guard] REFUSED — connected database is "${row.database}", which is not a scratch name.\n`
      + `  The URL and the live connection disagree. Refusing to touch it.`
    );
  }

  const facts = {
    database: row.database,
    user: row.usr,
    server_version: row.server_version,
    timezone: row.timezone,
    lc_collate: row.lc_collate,
    lc_ctype: row.lc_ctype,
    server_encoding: row.server_encoding,
    datestyle: row.datestyle,
  };

  if (String(facts.timezone).toUpperCase() !== 'UTC') {
    throw new Error(
      `[guard] REFUSED — scratch cluster timezone is "${facts.timezone}", expected UTC.\n`
      + `  Production stamps run_date/created_at via NOW() in UTC. A scratch cluster in a\n`
      + `  different zone shifts every row across month boundaries and would make the period\n`
      + `  checks report wrong numbers while looking green. Start the cluster with\n`
      + `  postgresFlags: ['-c','timezone=UTC'].`
    );
  }

  if (String(facts.server_encoding).toUpperCase() !== 'UTF8') {
    throw new Error(`[guard] REFUSED — server_encoding is "${facts.server_encoding}", expected UTF8.`);
  }

  return facts;
}

/**
 * Stamp the database as harness-owned. Nothing destructive may run unless this exists.
 * Written only AFTER the URL and live-connection checks pass.
 */
async function installScratchMarker(client, note) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (
      id          SERIAL PRIMARY KEY,
      note        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`INSERT INTO ${MARKER_TABLE} (note) VALUES ($1)`, [note || 'finflow verification harness']);
}

/**
 * The precondition for any TRUNCATE. Called by the seed step (step 2), not by boot.
 */
async function assertMarkerPresent(client) {
  const { rows } = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`, [MARKER_TABLE]
  );
  if (!rows[0] || !rows[0].present) {
    throw new Error(
      `[guard] REFUSED — no ${MARKER_TABLE} table in this database.\n`
      + `  Destructive operations are only permitted on a database the harness created and stamped.`
    );
  }
}

module.exports = {
  MARKER_TABLE,
  SCRATCH_DB_NAME,
  isLoopbackHost,
  scrubInheritedDatabaseUrl,
  assertScratchUrl,
  assertScratchDatabase,
  installScratchMarker,
  assertMarkerPresent,
};
