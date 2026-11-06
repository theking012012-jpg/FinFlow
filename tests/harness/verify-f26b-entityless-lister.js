'use strict';
/**
 * verify-f26b-entityless-lister — F26-b. The read-only lister names every business record stored with no business,
 * per account and table, with counts / amounts / dates and the account's businesses as candidates — and changes nothing.
 *
 * Executed: real initDB() schema on scratch Postgres; legacy rows seeded the way they exist in production (written
 * before the F150 constraint — it is dropped for the seed, as jsdomBoot does); the real tool in its own process.
 * Seeds discriminate (Rule 4): two accounts, receipts 50 + 70 and an expense 30 without a business in account A (two
 * businesses), one invoice 400 in account B (one business), and stamped rows that must NOT be listed.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f26b-entityless-lister.js
 */
require('./clock.js');
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'tools', 'launch', 'list-entityless-records.js');

(async () => {
  let scratch, database;
  console.log('\nF26-b — list the records that have no business (read-only)\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    ({ database } = await initSchema(scratch.url));
    const user = async (e) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: e }])).rows[0].id;
    const ua = await user('f26b-a@finflow.test'), ub = await user('f26b-b@finflow.test');
    const biz = async (u, name, cc) => (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [u, { name, country: cc }])).rows[0].id;
    const a1 = await biz(ua, 'North Shop', 'TT'); await biz(ua, 'South Shop', 'TT'); await biz(ub, 'Solo Studio', 'US');
    // Legacy rows (before F150): drop the invariant for the seed only.
    await c.query(`DO $d$ DECLARE r record; BEGIN FOR r IN SELECT conname, conrelid::regclass AS t FROM pg_constraint WHERE conname LIKE 'chk\\_%\\_entity\\_nn'
                   LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname); END LOOP; END $d$`);
    const row = (t, u, e, amt) => c.query(`INSERT INTO ${t} (user_id, entity_id, data) VALUES ($1, $2, $3)`, [u, e, { amount: amt }]);
    await row('sales_receipts', ua, null, 50); await row('sales_receipts', ua, null, 70); await row('expenses', ua, null, 30);
    await row('invoices', ub, null, 400);
    await row('sales_receipts', ua, a1, 999); await row('invoices', ub, a1, 888);   // stamped: must not be listed
    await database.initDB();   // the invariant comes back (NOT VALID), as on every boot
    const snap = async () => JSON.stringify((await c.query(`SELECT 'r' t, count(*) n, sum((data->>'amount')::numeric) s FROM sales_receipts UNION ALL SELECT 'i', count(*), sum((data->>'amount')::numeric) FROM invoices UNION ALL SELECT 'e', count(*), sum((data->>'amount')::numeric) FROM expenses`)).rows);
    const before = await snap();

    const r = spawnSync(process.execPath, [TOOL], { encoding: 'utf8', env: Object.assign({}, process.env, { DATABASE_URL: scratch.url }) });
    const out = r.stdout || '';
    A('the tool runs and exits 0', r.status === 0, out + (r.stderr || ''));
    A(`account #${ua}: sales_receipts — 2 rows, amounts 120.00 (stamped 999 excluded)`, new RegExp(`sales_receipts\\s+2 row\\(s\\) without a business · amounts 120\\.00`).test(out), out);
    A(`account #${ua}: expenses — 1 row, 30.00 (the class, not only receipts)`, /expenses\s+1 row\(s\) without a business · amounts 30\.00/.test(out), out);
    A(`account #${ua} lists both its businesses as candidates (2 — the owner decides)`, new RegExp(`account #${ua} — 2 business\\(es\\): #\\d+ North Shop \\(TT\\) · #\\d+ South Shop \\(TT\\)`).test(out), out);
    A(`account #${ub}: invoices 400.00, one business → marked as the obvious home`, new RegExp(`account #${ub} — 1 business\\(es\\): #\\d+ Solo Studio \\(US\\)  ← one business`).test(out) && /invoices\s+1 row\(s\) without a business · amounts 400\.00/.test(out), out);
    A('the total: 4 records in 2 accounts, 17 business tables checked', /17 business tables checked · 4 record\(s\) in 2 account\(s\) have no business/.test(out), out.split('\n').pop() || out.slice(-200));
    A('no e-mail address printed', !/@/.test(out));
    A('nothing changed (row counts and totals identical)', (await snap()) === before);
    // STRUCTURAL (labelled, Rule 5/7): read-only by construction — no write SQL, no transaction control, no database.js.
    const src = fs.readFileSync(TOOL, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    A('[STRUCTURAL] SELECT only — no INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE/BEGIN/COMMIT; does not import database.js',
      !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|BEGIN|COMMIT|ROLLBACK)\b/.test(src) && !/database(\.js)?['"]/.test(src));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (database) await database.pool.end(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F26-b entity-less records lister)\n`);
  process.exit(fail ? 1 : 0);
})();
