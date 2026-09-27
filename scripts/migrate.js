#!/usr/bin/env node
'use strict';
/**
 * migrate.js — owner-run schema + migration entrypoint (F202).
 *
 * Use as a deploy/release step so the WEB process can run as a least-privilege role
 * (scripts/db-app-role.sql → finflow_app, with SKIP_INIT_DDL=1). This step needs DDL rights, so run
 * it with the OWNER DATABASE_URL:
 *
 *   DATABASE_URL="$OWNER_DATABASE_URL" node scripts/migrate.js
 *
 * On Railway: set this as the service's "release"/pre-deploy command (owner creds), and the web
 * process's DATABASE_URL to finflow_app + SKIP_INIT_DDL=1. Exits non-zero if any migration fails.
 */
const { initDB, runMigrations, pool } = require('../database');

(async () => {
  console.log('[migrate] applying baseline schema (initDB)…');
  await initDB();
  console.log('[migrate] running versioned migrations…');
  const m = await runMigrations(pool);
  const applied = (m.applied || []).length;
  if (m.failed && m.failed.length) {
    console.error('[migrate] FAILED:', m.failed.map((x) => x.name).join(', '));
    await pool.end().catch(() => {});
    process.exit(1);
  }
  console.log(`[migrate] OK — schema ready, ${applied} new migration(s) applied.`);
  await pool.end().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('[migrate] error:', e && e.stack ? e.stack : e); process.exit(1); });
