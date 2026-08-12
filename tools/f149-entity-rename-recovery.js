#!/usr/bin/env node
'use strict';
/**
 * f149-entity-rename-recovery.js — READ-ONLY recovery aid for F149 (create-2nd-business renamed the
 * existing business in the DB). SELECT statements ONLY. No write mode, no transactions, no DDL.
 *
 * Rule 7 compliance:
 *   - Does NOT require ../database.js (importing it runs initDB() → CREATE/ALTER DDL at prod). It
 *     opens its own pg Pool from DATABASE_URL and only ever SELECTs.
 *   - All parameters are bound ($1). Prints real error detail (message/code/stack + Aggregate).
 *
 * What it shows, for one user:
 *   1) Current entities (id, name, active) — what the books look like NOW.
 *   2) business_name change history from audit_trail (table_name='settings') — old → new → when →
 *      by whom. The EARLIEST entry's old value is the original name before F149 overwrote it.
 *   3) Any entities-table UPDATE audits (if a name was also changed via /api/entities/:id).
 *
 * Recovery itself (restoring a name) is a SEPARATE, owner-approved data change (Rule 8) — this tool
 * does not perform it.
 *
 * Usage (owner runs against their own DB; NEVER production per Rule 3 unless the owner explicitly
 * chooses to READ prod here — this is SELECT-only so it cannot mutate):
 *   DATABASE_URL="postgres://..." node tools/f149-entity-rename-recovery.js --email you@example.com
 *   DATABASE_URL="postgres://..." node tools/f149-entity-rename-recovery.js --user 42
 *   (no identifier) → lists users so you can pick one.
 */
const { Pool } = require('pg');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('ERROR: set DATABASE_URL (SELECT-only connection).'); process.exit(2); }
  // Supabase/Railway typically need SSL; allow it without pinning a CA for a read-only probe.
  const ssl = /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 2 });

  try {
    const email = arg('--email');
    const userArg = arg('--user');

    let userId = userArg ? Number(userArg) : null;
    if (!userId && email) {
      const r = await pool.query(
        `SELECT id, data->>'email' AS email FROM users WHERE lower(data->>'email') = lower($1) LIMIT 1`, [email]);
      if (!r.rows.length) { console.error(`No user with email ${email}.`); return; }
      userId = r.rows[0].id;
    }
    if (!userId) {
      const r = await pool.query(
        `SELECT id, data->>'email' AS email, data->>'name' AS name FROM users ORDER BY id LIMIT 50`);
      console.log('\nNo --user/--email given. Users (pick one and re-run with --user <id>):\n');
      for (const u of r.rows) console.log(`  id=${u.id}  ${u.email || '(no email)'}  ${u.name || ''}`);
      console.log('');
      return;
    }

    console.log(`\n=== F149 recovery report — user_id=${userId} (READ-ONLY) ===\n`);

    // 1) Current entities.
    const ents = await pool.query(
      `SELECT id, data->>'name' AS name, data->>'is_active' AS is_active, data->>'sort_order' AS sort_order
         FROM entities WHERE user_id = $1 ORDER BY (data->>'sort_order')::int NULLS LAST, id`, [userId]);
    console.log('1) CURRENT ENTITIES');
    if (!ents.rows.length) console.log('   (none)');
    for (const e of ents.rows) {
      console.log(`   entity ${e.id}: "${e.name}"  ${String(e.is_active) === '1' ? '[ACTIVE]' : ''}  sort=${e.sort_order ?? ''}`);
    }
    const dupNames = ents.rows.map(e => e.name);
    const dups = dupNames.filter((n, i) => dupNames.indexOf(n) !== i);
    if (dups.length) console.log(`   ⚠ duplicate entity name(s) present: ${[...new Set(dups)].map(n => `"${n}"`).join(', ')} — a symptom of the F149 rename.`);

    // 2) business_name change history from the settings audit (this is where the F149 rename shows up).
    console.log('\n2) business_name CHANGE HISTORY (audit_trail, table_name=\'settings\')');
    const hist = await pool.query(
      `SELECT changed_at, actor_type, actor_id,
              COALESCE(old_data->>'value', old_value) AS old_v,
              COALESCE(new_data->>'value', new_value) AS new_v
         FROM audit_trail
        WHERE user_id = $1 AND table_name = 'settings'
          AND (old_data->>'field' = 'business_name' OR new_data->>'field' = 'business_name'
               OR field_name = 'business_name')
        ORDER BY changed_at ASC`, [userId]);
    if (!hist.rows.length) {
      console.log('   (no business_name audit rows — F90 audit may not have been deployed when the rename happened;');
      console.log('    the original name may not be recoverable from the DB. Check any pre-incident backup/export.)');
    } else {
      for (const h of hist.rows) {
        console.log(`   ${new Date(h.changed_at).toISOString()}  "${h.old_v ?? ''}"  →  "${h.new_v ?? ''}"  (by ${h.actor_type || 'user'}${h.actor_id ? '#' + h.actor_id : ''})`);
      }
      console.log(`   → EARLIEST "old" value above is your original business name before F149 overwrote it.`);
    }

    // 3) Direct entities-table UPDATE audits (renames via /api/entities/:id, if any).
    console.log('\n3) ENTITIES-TABLE UPDATE AUDITS (renames via the entity endpoint, if any)');
    const entAudit = await pool.query(
      `SELECT changed_at, record_id, old_data->>'name' AS old_name, new_data->>'name' AS new_name, actor_type
         FROM audit_trail
        WHERE user_id = $1 AND table_name = 'entities' AND action = 'UPDATE'
          AND (old_data ? 'name' OR new_data ? 'name')
        ORDER BY changed_at ASC`, [userId]);
    if (!entAudit.rows.length) console.log('   (none)');
    for (const a of entAudit.rows) {
      console.log(`   ${new Date(a.changed_at).toISOString()}  entity ${a.record_id}: "${a.old_name ?? ''}" → "${a.new_name ?? ''}"  (${a.actor_type || 'user'})`);
    }

    console.log('\nRestoring a name is a separate, owner-approved data change (Rule 8). This tool only reports.\n');
  } catch (err) {
    console.error('\nDB ERROR:', err && err.message);
    if (err && err.code) console.error('  code:', err.code);
    if (err && err.errors) for (const e of err.errors) console.error('  sub:', e && e.message);
    if (err && err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
