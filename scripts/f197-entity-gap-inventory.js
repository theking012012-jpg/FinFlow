#!/usr/bin/env node
// scripts/f197-entity-gap-inventory.js — READ-ONLY inventory for the F197 backfill decision.
//
// Dry-run ONLY. Never writes: no apply mode, no migration, no DDL, no transaction. Every
// statement is a SELECT. It READS process.env.DATABASE_URL / NODE_ENV; it assigns to neither.
// Rule 7/8: measure the affected population and HOLD for an owner decision before any backfill.
//
// WHAT F197 WAS: ffOnAuth() tore the onboarding wizard down for every authenticated user, so
// onboarding never provisioned a first entity. Every account created before the fix landed on
// an empty workspace. This tool counts who is affected, so the owner can decide whether — and
// how — to backfill (a separate, owner-gated, its-own-commit migration).
//
//   PowerShell, one session (this project does NOT use dotenv — .env is not read):
//     $env:DATABASE_URL = "<Railway PUBLIC connection string>"
//     $env:NODE_ENV     = "production"     # dbSsl() only enables TLS in production
//     node scripts/f197-entity-gap-inventory.js
//     node scripts/f197-entity-gap-inventory.js --json     # machine-readable
//     node scripts/f197-entity-gap-inventory.js --list     # print affected user ids + created_at
//     Remove-Item Env:\DATABASE_URL        # clear the credential when done
//
'use strict';

function _explainError(e) {
  const L = [];
  const msg = e && typeof e.message === 'string' ? e.message.trim() : '';
  L.push(msg || `(no message — error was ${e && e.constructor ? e.constructor.name : typeof e})`);
  if (e && e.code) L.push('code: ' + e.code);
  if (e && Array.isArray(e.errors)) for (const sub of e.errors) L.push('  · ' + (sub && sub.message ? sub.message : String(sub)));
  if (e && e.stack) L.push(e.stack.split('\n').slice(1, 4).join('\n'));
  return L.join('\n');
}

function preflight() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set, so pg would fall back to localhost and fail.');
    console.error('  PowerShell:  $env:DATABASE_URL = "<Railway PUBLIC connection string>"');
    console.error('               $env:NODE_ENV     = "production"');
    process.exit(2);
  }
  if (/railway\.internal/.test(url)) {
    console.error('DATABASE_URL points at a *.railway.internal host, which only resolves INSIDE Railway.');
    console.error('Use the PUBLIC connection string for a local run.');
    process.exit(2);
  }
}

async function main() {
  const asJson = process.argv.includes('--json');
  const doList = process.argv.includes('--list');
  preflight();                                 // before the require: database.js reads DATABASE_URL at import
  const { pool } = require('../database.js');   // import is side-effect-safe: initDB() is exported, never auto-run

  const q = async (sql) => (await pool.query(sql)).rows;

  // Column presence guards — the users table shape varies; only assume id exists.
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`))
    .map(r => r.column_name);
  const hasCreated = cols.includes('created_at');
  const hasEmail = cols.includes('email');

  const [{ total }] = await q(`SELECT COUNT(*)::int AS total FROM users`);

  // Users owning ZERO entities (entities are owned by user_id = the account/scope owner).
  const [{ no_entity }] = await q(`
    SELECT COUNT(*)::int AS no_entity
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.user_id = u.id)`);

  // STRONG F197 signal: finished onboarding (settings main row onboarding_done = 1) but 0 entities.
  const [{ onboarded_no_entity }] = await q(`
    SELECT COUNT(*)::int AS onboarded_no_entity
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.user_id = u.id)
      AND EXISTS (
        SELECT 1 FROM user_settings s
        WHERE s.user_id = u.id AND s.data->>'key' IS NULL
          AND (s.data->>'onboarding_done') = '1')`);

  // WEAKER: 0 entities and NOT flagged onboarded — brand-new / abandoned / pre-onboarding-era.
  const not_onboarded_no_entity = no_entity - onboarded_no_entity;

  const out = {
    total_users: total,
    users_with_no_entity: no_entity,
    onboarded_but_no_entity: onboarded_no_entity,   // <- the confirmed F197-affected population
    no_entity_not_onboarded: not_onboarded_no_entity,
  };

  let sample = [];
  if (doList) {
    const sel = ['u.id'];
    if (hasEmail) sel.push('u.email');
    if (hasCreated) sel.push('u.created_at');
    sample = await q(`
      SELECT ${sel.join(', ')}
      FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.user_id = u.id)
        AND EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = u.id
              AND s.data->>'key' IS NULL AND (s.data->>'onboarding_done') = '1')
      ORDER BY u.id ${hasCreated ? '' : ''} LIMIT 500`);
    out.affected_sample = sample;
  }

  if (asJson) { console.log(JSON.stringify(out, null, 2)); }
  else {
    console.log('\nF197 entity-gap inventory (READ-ONLY — nothing written)\n');
    console.log(`  total users .......................... ${total}`);
    console.log(`  users with NO entity ................. ${no_entity}`);
    console.log(`  ├─ onboarded but no entity (F197) .... ${onboarded_no_entity}   <-- confirmed affected`);
    console.log(`  └─ no entity, not onboarded .......... ${not_onboarded_no_entity}   (new/abandoned/pre-era)`);
    if (doList) {
      console.log(`\n  affected sample (${sample.length}, max 500):`);
      for (const r of sample) console.log('   ', JSON.stringify(r));
    } else {
      console.log('\n  (run with --list to print affected user ids)');
    }
    console.log('\n  NEXT: this is a MEASUREMENT. Any backfill is a separate, owner-approved migration (Rule 8).\n');
  }
  await pool.end();
}

main().catch(e => { console.error('\n[f197-inventory] FAILED:\n' + _explainError(e) + '\n'); process.exit(1); });
