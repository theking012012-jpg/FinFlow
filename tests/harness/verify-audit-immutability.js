'use strict';
/**
 * verify-audit-immutability.js — the audit trail must be APPEND-ONLY at the database. Proves the
 * DB-level trigger blocks UPDATE and DELETE (even for a superuser client) while INSERT is allowed,
 * and that a row survives an attempted tamper unchanged. This is the "attacker can't erase their
 * tracks" guarantee — locked in as a regression test.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-audit-immutability.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
async function blocked(fn) { try { await fn(); return null; } catch (e) { return e; } }

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);   // creates audit_trail + the immutability trigger

    console.log('\n' + '='.repeat(78));
    console.log('  AUDIT TRAIL IMMUTABILITY — append-only enforced at the database');
    console.log('='.repeat(78) + '\n');

    // INSERT is allowed (append).
    const ins = await c.query(
      "INSERT INTO audit_trail (user_id, table_name, record_id, action, actor_type, ip_address) VALUES (NULL, 'invoices', 1, 'CREATE', 'system', '10.0.0.1') RETURNING id",
    );
    const id = ins.rows[0].id;
    A('INSERT into audit_trail is allowed (append)', !!id);

    // UPDATE must be rejected by the trigger.
    const uErr = await blocked(() => c.query("UPDATE audit_trail SET action = 'TAMPERED' WHERE id = $1", [id]));
    A('UPDATE is rejected by the trigger', !!uErr && /append-only/i.test(uErr.message), uErr && uErr.message);

    // DELETE must be rejected by the trigger.
    const dErr = await blocked(() => c.query('DELETE FROM audit_trail WHERE id = $1', [id]));
    A('DELETE is rejected by the trigger', !!dErr && /append-only/i.test(dErr.message), dErr && dErr.message);

    // The row survives, unchanged (tamper attempts had no effect).
    const row = (await c.query('SELECT action FROM audit_trail WHERE id = $1', [id])).rows[0];
    A('row still exists after tamper attempts', !!row);
    A('row action UNCHANGED (still CREATE, not TAMPERED)', row && row.action === 'CREATE', row && row.action);

    // TRUNCATE is also a destruction path — the row-level trigger does NOT stop TRUNCATE, so document
    // reality honestly: assert whether it is blocked, and report which.
    const tErr = await blocked(() => c.query('TRUNCATE audit_trail'));
    console.log('  NOTE  TRUNCATE is ' + (tErr ? 'blocked (' + tErr.message.split('\n')[0] + ')' : 'NOT blocked by the row-level trigger (expected — needs a separate guard or restricted role; covered by the least-privilege DB role item)'));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (audit trail immutability)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
