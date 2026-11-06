'use strict';
/**
 * verify-new28-renamed-lister — NEW-28's read-only lister. It must report every recorded business rename and, on
 * accounts with 2+ businesses, the businesses named exactly like the account-wide business name — and change nothing.
 *
 * Executed: real initDB() on scratch Postgres (so the F90 trigger records the rename exactly as production does); the
 * real tool in its own process. Seeds discriminate (Rule 4): account A (2 businesses, account name "Layout Co"; "January
 * Co" renamed to "Layout Co" → listed in both parts); account B (ONE business also called "Layout Co", same account name
 * → NOT a candidate: the bug needs a second business).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new28-renamed-lister.js
 */
require('./clock.js');
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const TOOL = path.join(__dirname, '..', '..', 'tools', 'launch', 'list-renamed-businesses.js');

(async () => {
  let scratch, database;
  console.log('\nNEW-28 — list businesses the Settings bug may have renamed (read-only)\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    ({ database } = await initSchema(scratch.url));
    const user = async (e) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: e }])).rows[0].id;
    const ua = await user('n28-a@finflow.test'), ub = await user('n28-b@finflow.test');
    for (const u of [ua, ub]) await c.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1, NULL, '{"business_name":"Layout Co"}')`, [u]);
    const biz = async (u, name) => (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [u, { name, country: 'US' }])).rows[0].id;
    const a1 = await biz(ua, 'Layout Co'), a2 = await biz(ua, 'January Co'); await biz(ub, 'Layout Co');
    await c.query(`UPDATE entities SET data = data || '{"name":"Layout Co","country":"CA"}' WHERE id = $1`, [a2]);   // what the bug did
    const before = JSON.stringify((await c.query(`SELECT id, data FROM entities ORDER BY id`)).rows);

    const r = spawnSync(process.execPath, [TOOL], { encoding: 'utf8', env: Object.assign({}, process.env, { DATABASE_URL: scratch.url }) });
    const out = r.stdout || '';
    A('the tool runs and exits 0', r.status === 0, out + (r.stderr || ''));
    A(`the recorded rename: account #${ua} business #${a2} "January Co" → "Layout Co"`, new RegExp(`account #${ua}\\s+business #${a2}\\s+"January Co" → "Layout Co"`).test(out), out);
    A(`both of account #${ua}'s "Layout Co" businesses are candidates`, new RegExp(`account #${ua}\\s+business #${a1}\\s+"Layout Co"`).test(out.split('\n2.')[1] || '') && new RegExp(`account #${ua}\\s+business #${a2}\\s+"Layout Co"`).test(out.split('\n2.')[1] || ''), out);
    A(`account #${ub} (ONE business) is not a candidate`, !new RegExp(`account #${ub}\\s`).test(out.split('\n2.')[1] || ''), out);
    A('totals: 1 recorded rename · 2 candidates', /1 recorded rename\(s\) · 2 candidate business\(es\)\. Nothing was changed\./.test(out), out.split('\n').filter(Boolean).pop());
    A('no e-mail address printed', !/@/.test(out));
    A('nothing changed', JSON.stringify((await c.query(`SELECT id, data FROM entities ORDER BY id`)).rows) === before);
    const src = fs.readFileSync(TOOL, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    A('[STRUCTURAL] SELECT only — no write SQL, no transaction control, no database.js import',
      !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|BEGIN|COMMIT|ROLLBACK)\b/.test(src) && !/database(\.js)?['"]/.test(src));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (database) await database.pool.end(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (NEW-28 renamed-business lister)\n`);
  process.exit(fail ? 1 : 0);
})();
