'use strict';
/**
 * verify-new27-status-constraints-validated — NEW-27. F79 added 26 status CHECK constraints NOT VALID (new writes
 * checked, existing rows never scanned). At boot, every one whose rows all fit must become VALIDATED; one with a row that
 * does not fit must stay NOT VALID, be logged by name, change no row, and never stop boot.
 *
 * Executed: real initDB() on scratch Postgres (Rule 3). Bug value (old code): every constraint stays
 * convalidated = false after boot.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new27-status-constraints-validated.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const STATUS = `contype = 'c' AND conname LIKE 'chk\\_%\\_status'`;

(async () => {
  let scratch, database;
  console.log('\nNEW-27 — status constraints are validated at boot; a bad row leaves only its own constraint unvalidated\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    ({ database } = await initSchema(scratch.url));
    const state = async () => (await c.query(`SELECT conname, convalidated FROM pg_constraint WHERE ${STATUS} ORDER BY conname`)).rows;

    const s1 = await state();
    A('26 status constraints exist after boot', s1.length === 26, `found ${s1.length}`);
    A('every one is VALIDATED after boot (bug: all 26 NOT VALID)', s1.every(r => r.convalidated),
      'not validated: ' + s1.filter(r => !r.convalidated).map(r => r.conname).join(', '));

    // A legacy row that does not fit: drop the constraint, write "draft" (quotes have no draft), boot again.
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,'{"email":"n27@finflow.test"}') RETURNING id`)).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,'{"name":"N27 Co","currency":"USD"}') RETURNING id`, [uid])).rows[0].id;
    await c.query(`ALTER TABLE quotes DROP CONSTRAINT chk_quotes_status`);
    const qid = (await c.query(`INSERT INTO quotes (user_id,entity_id,data) VALUES ($1,$2,'{"status":"draft","amount":5}') RETURNING id`, [uid, eid])).rows[0].id;

    const warns = []; const ow = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); };
    let booted = true;
    try { await database.initDB(); } catch (e) { booted = false; warns.push('THREW ' + e.message); } finally { console.warn = ow; }
    A('boot completes with the bad row present (never blocked by it)', booted, warns.join(' | '));

    const s2 = await state();
    const q = s2.find(r => r.conname === 'chk_quotes_status');
    A('chk_quotes_status is back, left NOT VALID (the bad row does not fit)', q && q.convalidated === false, JSON.stringify(q));
    A('the other 25 stay VALIDATED', s2.filter(r => r.conname !== 'chk_quotes_status').every(r => r.convalidated) && s2.length === 26);
    A('the reason is logged, naming the constraint and the read-only lister', warns.some(w => /chk_quotes_status left NOT VALID/.test(w) && /list-status-violations/.test(w)), warns.join(' | '));
    const row = (await c.query(`SELECT data->>'status' AS s FROM quotes WHERE id = $1`, [qid])).rows[0];
    A('the bad row is unchanged (Rule 8 — nothing rewritten)', row && row.s === 'draft', JSON.stringify(row));
    let code = null;
    try { await c.query(`INSERT INTO quotes (user_id,entity_id,data) VALUES ($1,$2,'{"status":"draft"}')`, [uid, eid]); } catch (e) { code = e.code; }
    A('new writes are still checked by the NOT VALID constraint (23514)', code === '23514', `code=${code}`);

    const r3 = await database.validateStatusConstraints();
    A('a later boot retries only the unvalidated one and leaves it NOT VALID', r3.validated.length === 0 && r3.failed.length === 1 && r3.failed[0].constraint === 'chk_quotes_status', JSON.stringify(r3));
    await c.query(`UPDATE quotes SET data = jsonb_set(data, '{status}', '"pending"') WHERE id = $1`, [qid]);
    const r4 = await database.validateStatusConstraints();
    A('once the row is corrected (by the owner), the next boot validates it', r4.validated.join() === 'chk_quotes_status' && (await state()).every(r => r.convalidated), JSON.stringify(r4));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (database) await database.pool.end(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (NEW-27 status constraints validated)\n`);
  process.exit(fail ? 1 : 0);
})();
