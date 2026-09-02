'use strict';
/**
 * verify-f88-server-date-default.js — F88/C3-server. When the client omits the date, the SERVER's
 * default for a genuine-timestamp transaction must resolve to the ENTITY's calendar "today", not UTC.
 *
 * At the pinned instant (2026-07-25T16:00Z) it is already 2026-07-26 in Australia/Sydney but still
 * 2026-07-25 in UTC. So a dateless expense posted to a Sydney entity must store 2026-07-26; the same
 * post to a no-timezone entity must store 2026-07-25 (UTC fallback — byte-identical to pre-F88).
 *
 * EXECUTED against real Postgres + the real POST /api/expenses route (entityTodayYmd in the path).
 * Discriminating (Rule 14): pre-fix the default was always UTC 2026-07-25 → the Sydney assertion is red.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f88-server-date-default.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const FD = require('../../public/finflow-dates.js');

const OWNER = { email: 'f88c3-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const AS = (n, ok, d) => A('[STRUCTURAL] ' + n, ok, d);
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const now = new Date();

    // premise
    A('UTC today = 2026-07-25', FD.resolvedToday(now) === '2026-07-25', FD.resolvedToday(now));
    A('Australia/Sydney today = 2026-07-26', FD.resolvedToday(now, 'Australia/Sydney') === '2026-07-26', FD.resolvedToday(now, 'Australia/Sydney'));

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'F88C3 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }]
    )).rows[0].id;
    const mkEnt = async (data) => (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, data]
    )).rows[0].id;
    const eidSyd = await mkEnt({ name: 'Sydney Co', currency: 'AUD', timezone: 'Australia/Sydney', is_active: 1, sort_order: 0 });
    const eidUTC = await mkEnt({ name: 'No-TZ Co', currency: 'USD', is_active: 0, sort_order: 1 });

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const dateOf = async (desc) => {
      const r = await c.query(`SELECT data->>'expense_date' AS d FROM expenses WHERE data->>'description' = $1 LIMIT 1`, [desc]);
      return r.rows[0] ? r.rows[0].d : null;
    };

    // 1) dateless expense on the Sydney entity → entity-local today 2026-07-26
    const rS = await http.post('/api/expenses', { description: 'SYD-dateless', amount: 100, entity_id: eidSyd });
    A('Sydney expense POST ok', rS.status === 200 || rS.status === 201, `status ${rS.status}`);
    A('A1: dateless Sydney expense stored 2026-07-26 (entity-local, NOT UTC 07-25)',
      (await dateOf('SYD-dateless')) === '2026-07-26', `stored ${await dateOf('SYD-dateless')}`);

    // 2) dateless expense on the no-timezone entity → UTC today 2026-07-25 (unchanged)
    const rU = await http.post('/api/expenses', { description: 'UTC-dateless', amount: 100, entity_id: eidUTC });
    A('No-TZ expense POST ok', rU.status === 200 || rU.status === 201, `status ${rU.status}`);
    A('A2: dateless no-TZ expense stored 2026-07-25 (UTC fallback — byte-identical to pre-F88)',
      (await dateOf('UTC-dateless')) === '2026-07-25', `stored ${await dateOf('UTC-dateless')}`);

    // 3) an EXPLICIT date is always respected (the default only fills when absent)
    await http.post('/api/expenses', { description: 'SYD-explicit', amount: 100, entity_id: eidSyd, expense_date: '2026-01-15' });
    A('A3: explicit expense_date is respected (not overridden by entity today)',
      (await dateOf('SYD-explicit')) === '2026-01-15', `stored ${await dateOf('SYD-explicit')}`);

    // STRUCTURAL — the helper exists and every entity-scoped date default routes through it.
    const srv = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
    AS('entityTodayYmd helper defined', /async function entityTodayYmd\(entityId\)/.test(srv));
    AS('helper falls back to UTC for null entity', /if \(entityId == null\) return FinFlowDates\.resolvedToday\(new Date\(\)\)/.test(srv));
    const defaults = (srv.match(/date[^\n]*\|\| new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/g) || [])
      .filter(l => /^\s*(date|tx_date|expense_date|edate|const edate)/.test(l) === false); // none of the recognition-surface defaults should remain raw
    AS('no entity-scoped transaction default still stamps raw UTC (expenses/journals/AR/AP/bank routed)',
      !/const edate = expense_date \|\| new Date\(\)\.toISOString/.test(srv)
      && !/^      date: date \|\| new Date\(\)\.toISOString\(\)\.slice\(0, 10\),/m.test(srv)
      && !/tx_type: type \|\| 'debit', tx_date: date \|\| new Date\(\)\.toISOString/.test(srv),
      'a recognition-surface default still uses raw UTC new Date()');

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F88/C3-server: entity-tz date defaults)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
