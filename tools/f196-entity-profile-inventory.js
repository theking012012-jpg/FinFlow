#!/usr/bin/env node
'use strict';
/**
 * f196-entity-profile-inventory.js — READ-ONLY enumeration for the F196 Tier-2 data move.
 * SELECT statements ONLY. No write mode, no transactions, no DDL, no --apply flag.
 *
 * WHY THIS EXISTS (CLAUDE.md Rule 8): F196 Tier 2 gives every entity its own letterhead profile.
 * The existing account-wide `user_settings` profile (business_name/address/email/phone/tax_id/website)
 * should be COPIED onto the first/active entity so nothing is lost — but that is a DATA CHANGE, and a
 * data change is owner-gated and is its OWN commit. This tool does not perform it. It ENUMERATES what
 * exists and REPORTS it, so the owner decides against real numbers rather than an assumption.
 *
 * Rule 7 compliance:
 *   - Does NOT require ../database.js. Importing that module executes it, and it exports initDB()
 *     (CREATE TABLE / ALTER TABLE DDL). A scan of this script's own SQL would not catch that, so the
 *     script opens its own pg Pool from DATABASE_URL and only ever SELECTs.
 *   - Every parameter is bound ($1). Nothing is interpolated into SQL.
 *   - Prints real error detail (message / code / stack, and AggregateError.errors), because a failure
 *     message that says nothing is as bad as a green test that proves nothing.
 *
 * WHAT IT REPORTS, per user:
 *   1) The account-wide user_settings profile — the CURRENT source of every letterhead.
 *   2) Every entity, with which profile fields it already has and which are empty.
 *   3) The proposed copy target (the ACTIVE entity, else the lowest-id entity) and, field by field,
 *      whether a copy WOULD write, WOULD SKIP (entity already has a value — never overwrite), or has
 *      nothing to copy. This is a PREVIEW of a decision, not a staged change.
 *   4) A COLLISION WARNING when an entity's existing value differs from the account value, since that
 *      is exactly the case where a naive backfill would destroy a deliberate per-entity value.
 *
 * Usage (owner runs; SELECT-only, so it cannot mutate whatever it is pointed at):
 *   DATABASE_URL="postgres://..." node tools/f196-entity-profile-inventory.js --email you@example.com
 *   DATABASE_URL="postgres://..." node tools/f196-entity-profile-inventory.js --user 42
 *   DATABASE_URL="postgres://..." node tools/f196-entity-profile-inventory.js --all
 *   (no identifier) → lists users so you can pick one.
 */
const { Pool } = require('pg');

const PROFILE_FIELDS = ['business_name', 'address', 'email', 'phone', 'tax_id', 'website'];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function has(name) { return process.argv.indexOf(name) >= 0; }
function show(v) {
  if (v == null || v === '') return '(empty)';
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 60 ? JSON.stringify(s.slice(0, 57) + '...') : JSON.stringify(s);
}

async function reportUser(pool, userId) {
  console.log('\n' + '='.repeat(78));
  const { rows: uRows } = await pool.query(
    `SELECT id, data->>'email' AS email, data->>'name' AS name, data->>'plan' AS plan
       FROM users WHERE id = $1 LIMIT 1`, [userId]
  );
  if (!uRows.length) { console.log(`USER ${userId} — not found.`); return; }
  const u = uRows[0];
  console.log(`USER ${u.id} — ${u.email || '(no email)'}  (${u.name || 'no name'}, plan=${u.plan || '?'})`);
  console.log('='.repeat(78));

  // ── 1. the account-wide profile: the CURRENT source of every letterhead ──────────────────────
  const { rows: sRows } = await pool.query(
    `SELECT id, data FROM user_settings
      WHERE user_id = $1 AND data->>'key' IS NULL
      ORDER BY id LIMIT 1`, [userId]
  );
  const acct = sRows.length ? (sRows[0].data || {}) : {};
  console.log('\n1) ACCOUNT-WIDE profile (user_settings, one row per account — today every entity uses this)');
  if (!sRows.length) console.log('   (no user_settings row at all)');
  else {
    console.log(`   user_settings.id = ${sRows[0].id}`);
    for (const f of PROFILE_FIELDS) console.log(`   ${f.padEnd(14)} = ${show(acct[f])}`);
  }

  // ── 2. every entity and what profile it already holds ────────────────────────────────────────
  const { rows: eRows } = await pool.query(
    `SELECT id, data FROM entities WHERE user_id = $1 ORDER BY id`, [userId]
  );
  console.log(`\n2) ENTITIES (${eRows.length})`);
  if (!eRows.length) console.log('   (none — nothing to copy onto)');
  for (const e of eRows) {
    const d = e.data || {};
    const active = String(d.is_active) === '1' || d.is_active === true;
    const held = PROFILE_FIELDS.filter(f => d[f] != null && d[f] !== '');
    console.log(`   entity ${e.id}  name=${show(d.name)}  ${active ? '[ACTIVE]' : ''}`);
    console.log(`      profile fields already set: ${held.length ? held.join(', ') : '(none)'}`);
    for (const f of held) console.log(`         ${f.padEnd(14)} = ${show(d[f])}`);
  }

  // ── 3 + 4. what a copy WOULD do — preview only, nothing is written ───────────────────────────
  if (!eRows.length || !sRows.length) {
    console.log('\n3) PROPOSED COPY — nothing to do (no entity, or no account settings row).');
    return;
  }
  const target = eRows.find(e => String((e.data || {}).is_active) === '1' || (e.data || {}).is_active === true) || eRows[0];
  const td = target.data || {};
  console.log(`\n3) PROPOSED COPY TARGET: entity ${target.id} (${show(td.name)})` +
    `${eRows.indexOf(target) === 0 ? '' : ' — the ACTIVE entity, not the lowest id'}`);
  console.log('   (PREVIEW ONLY — this tool writes nothing. The copy is a separate, owner-approved commit.)');
  let writes = 0, skips = 0, collisions = 0;
  for (const f of PROFILE_FIELDS) {
    const from = acct[f], to = td[f];
    const hasFrom = from != null && from !== '';
    const hasTo = to != null && to !== '';
    if (!hasFrom) { console.log(`   ${f.padEnd(14)} nothing to copy (account value empty)`); continue; }
    if (!hasTo) { writes++; console.log(`   ${f.padEnd(14)} WOULD WRITE  ${show(from)}`); continue; }
    skips++;
    if (String(from) !== String(to)) {
      collisions++;
      console.log(`   ${f.padEnd(14)} WOULD SKIP — entity already set, and it DIFFERS:`);
      console.log(`   ${''.padEnd(14)}    account = ${show(from)}`);
      console.log(`   ${''.padEnd(14)}    entity  = ${show(to)}   <-- a copy that overwrote this would DESTROY it`);
    } else {
      console.log(`   ${f.padEnd(14)} WOULD SKIP — entity already holds the same value`);
    }
  }
  console.log(`\n   SUMMARY: ${writes} field(s) would be written, ${skips} skipped` +
    (collisions ? `, ${collisions} DIFFERING value(s) — read those before deciding.` : '.'));

  // Entities that would still have NO profile after the copy: they fall back to the account blob,
  // which is exactly the pre-F196 behaviour. Naming them makes that consequence explicit.
  const others = eRows.filter(e => e.id !== target.id);
  if (others.length) {
    console.log(`\n4) ENTITIES NOT TARGETED (${others.length}) — these keep falling back to the account blob`);
    console.log('   (i.e. they still print the account letterhead until someone sets their profile):');
    for (const e of others) {
      const d = e.data || {};
      const held = PROFILE_FIELDS.filter(f => d[f] != null && d[f] !== '');
      console.log(`   entity ${e.id}  name=${show(d.name)}  own profile fields: ${held.length ? held.join(', ') : '(none)'}`);
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('ERROR: set DATABASE_URL (SELECT-only connection).'); process.exit(2); }
  const ssl = /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 2 });

  try {
    const email = arg('--email');
    const userArg = arg('--user');

    if (has('--all')) {
      const { rows } = await pool.query(`SELECT id FROM users ORDER BY id`);
      console.log(`Scanning ${rows.length} user(s).`);
      for (const r of rows) await reportUser(pool, r.id);
      return;
    }

    let userId = userArg ? Number(userArg) : null;
    if (!userId && email) {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [email]
      );
      if (!rows.length) { console.error(`No user with email ${email}.`); process.exit(1); }
      userId = rows[0].id;
    }
    if (!userId) {
      const { rows } = await pool.query(
        `SELECT id, data->>'email' AS email, data->>'name' AS name FROM users ORDER BY id LIMIT 50`
      );
      console.log('No --email / --user given. Users:');
      for (const r of rows) console.log(`  --user ${r.id}   ${r.email || '(no email)'}  ${r.name || ''}`);
      console.log('\nRe-run with --user <id>, --email <addr>, or --all.');
      return;
    }
    await reportUser(pool, userId);
  } catch (err) {
    console.error('\nFAILED:', err && err.message);
    if (err && err.code) console.error('  code:', err.code);
    if (err && err.errors) for (const e of err.errors) console.error('  aggregate:', e && e.message, e && e.code);
    if (err && err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
