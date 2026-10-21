'use strict';
/**
 * verify-lc1c-tools.js — A7 / LC1c (§3.4). The read-only lister (fix1-unlinked-time-entries.js) and the prepared,
 * owner-run link script (fix1-link-exact-matches.js) run as child processes against a real scratch Postgres, exactly
 * as the owner will run them (DATABASE_URL in the environment).
 *
 * Seed (pre-FIX-1 rows: a free-text label, no project_id). Business A projects: "Website", "Logo", "Logo" (duplicate).
 * Business B projects: "Website". Entries:
 *   e1 A "Website"     → link to A.Website
 *   e2 A "  website "  → link to A.Website       (a case-sensitive match would miss it)
 *   e3 A "Logo"        → NOT linked (2 matches — never guessed)
 *   e4 A "Unknown"     → NOT linked (0 matches)
 *   e5 A label "Other", ALREADY linked to A.Website → untouched
 *   e6 A ""            → NOT linked
 *   e7 B "Website"     → link to B.Website        (a cross-business match would pick A.Website)
 * Correct: 6 unlinked, 3 with exactly one match; apply links e1, e2 → A.Website and e7 → B.Website, nothing else.
 */
require('./clock.js');
const path = require('path');
const { spawnSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

const ROOT = path.join(__dirname, '..', '..');
const LIST = path.join(ROOT, 'tools', 'fix-2026-10-19', 'fix1-unlinked-time-entries.js');
const LINK = path.join(ROOT, 'tools', 'fix-2026-10-19', 'fix1-link-exact-matches.js');
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let scratch, server;
  console.log('\nLC1c — read-only lister + prepared exact-name link script\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);   // initDB: the real schema
    await server.close(); server = null;
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,'{"email":"lc1c@finflow.test"}',NOW(),NOW()) RETURNING id`)).rows[0].id;
    const ent = async n => (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name: n, currency: 'USD' }])).rows[0].id;
    const A = await ent('Business A'), B = await ent('Business B');
    const proj = async (e, n) => (await c.query(`INSERT INTO projects (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`, [uid, e, { name: n }])).rows[0].id;
    const aWeb = await proj(A, 'Website'); await proj(A, 'Logo'); await proj(A, 'Logo'); const bWeb = await proj(B, 'Website');
    const te = async (e, label, extra = {}) => (await c.query(`INSERT INTO timesheet (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, e, { employee: 'Sam', date: '2026-07-01', hours: 2, billable: 'Yes', rate: 50, project: label, ...extra }])).rows[0].id;
    const e1 = await te(A, 'Website'), e2 = await te(A, '  website '), e3 = await te(A, 'Logo'), e4 = await te(A, 'Unknown');
    const e5 = await te(A, 'Other', { project_id: aWeb }), e6 = await te(A, ''), e7 = await te(B, 'Website');

    const fp = async () => JSON.stringify((await c.query(`SELECT id, data FROM timesheet ORDER BY id`)).rows) + '|' + (await c.query(`SELECT COUNT(*) n FROM audit_trail`)).rows[0].n;
    const runTool = (file, args = []) => {
      const r = spawnSync(process.execPath, [file, ...args], { env: Object.assign({}, process.env, { DATABASE_URL: scratch.url }), encoding: 'utf8', timeout: 60000 });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
    };
    const links = async () => Object.fromEntries((await c.query(`SELECT id, (data->>'project_id')::int p FROM timesheet ORDER BY id`)).rows.map(r => [r.id, r.p]));

    // 1–2 the read-only lister
    let f0 = await fp();
    const L = runTool(LIST);
    eq('1  lister exits 0', L.status, 0);
    const m = L.out.match(/unlinked entries: (\d+) · with exactly one same-business name match: (\d+)/);
    eq('1  lister: 6 unlinked, 3 with exactly one same-business match', m ? [+m[1], +m[2]] : null, [6, 3]);
    eq('2  lister changed nothing', await fp() === f0, true);

    // 3 dry run
    const D = runTool(LINK);
    eq('3  link dry run: WOULD LINK 3', (D.out.match(/WOULD LINK: (\d+)/) || [])[1], '3');
    eq('3  dry run changed nothing', await fp() === f0, true);

    // 4–5 refusals
    const R1 = runTool(LINK, ['--apply']);
    eq('4  --apply without --expect refused (exit 2), nothing changed', [R1.status, await fp() === f0], [2, true]);
    const R2 = runTool(LINK, ['--apply', '--expect', '2']);
    eq('5  --apply --expect 2 (≠ 3) refused (exit 3), nothing changed', [R2.status, await fp() === f0], [3, true]);

    // 6 apply
    const aMark = (await c.query(`SELECT COALESCE(MAX(id),0) m FROM audit_trail`)).rows[0].m;
    const P = runTool(LINK, ['--apply', '--expect', '3']);
    eq('6  apply exits 0 and reports 3', [P.status, /APPLIED: linked 3 /.test(P.out)], [0, true]);
    const lk = await links();
    eq('6  e1, e2 → A.Website; e7 → B.Website (not A\'s)', [lk[e1], lk[e2], lk[e7]], [aWeb, aWeb, bWeb], [aWeb, null, aWeb]);
    eq('6  e3 (2 matches), e4 (none), e6 (blank) still unlinked; e5 unchanged', [lk[e3], lk[e4], lk[e6], lk[e5]], [null, null, null, aWeb]);
    const au = (await c.query(`SELECT record_id, entity_id, action, actor_type FROM audit_trail WHERE id > $1 ORDER BY record_id`, [aMark])).rows;
    eq('6  one audit row per link, on the entry\'s business, actor system', au.map(x => [x.record_id, x.entity_id, x.action, x.actor_type]),
      [[e1, A, 'UPDATE', 'system'], [e2, A, 'UPDATE', 'system'], [e7, B, 'UPDATE', 'system']]);
    eq('6  labels kept', (await c.query(`SELECT data->>'project' l FROM timesheet WHERE id = $1`, [e2])).rows[0].l, '  website ');

    // 7 idempotent
    eq('7  dry run after apply: WOULD LINK 0', (runTool(LINK).out.match(/WOULD LINK: (\d+)/) || [])[1], '0');
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (server) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
