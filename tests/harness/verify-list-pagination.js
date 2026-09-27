#!/usr/bin/env node
'use strict';
/**
 * verify-list-pagination.js — F199: list endpoints keep their back-compat array by default, and expose
 * a correct keyset (cursor) page when the caller opts in with ?limit / ?before. Bounds the worst case
 * (an unbounded SELECT * per user) without changing the default shape or client-side aggregation.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-list-pagination.js
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    await http.post('/api/auth/register', { email: 'page@finflow.test', password: 'harness-password-not-a-secret', name: 'P' });
    const uid = (await c.query(`SELECT id FROM users WHERE lower(data->>'email')='page@finflow.test'`)).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Co', is_active: 1 }])).rows[0].id;
    const E = 'entity_id=' + eid;

    // 5 invoices in the entity, ascending created_at so id order == time order.
    for (let i = 1; i <= 5; i++) {
      await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,$4,NOW())`,
        [uid, eid, { client: 'C' + i, amount: i * 100, status: 'pending' }, `2026-06-0${i}T09:00:00Z`]);
    }

    // Default: full array, back-compat, newest-first.
    const def = await http.get('/api/invoices?'+E);
    A('default returns a bare ARRAY (back-compat)', Array.isArray(def.json), typeof def.json);
    A('default returns all 5', (def.json || []).length === 5, 'n=' + (def.json || []).length);
    A('default is newest-first (id desc)', def.json[0].id > def.json[def.json.length - 1].id);

    // Page 1: opt-in.
    const p1 = await http.get('/api/invoices?'+E+'&limit=2');
    A('paginated mode returns an OBJECT with rows/total/hasMore/nextCursor',
      p1.json && Array.isArray(p1.json.rows) && typeof p1.json.total === 'number' && typeof p1.json.hasMore === 'boolean', JSON.stringify(p1.json).slice(0,120));
    A('page 1 has 2 rows, total 5, hasMore true', p1.json.rows.length === 2 && p1.json.total === 5 && p1.json.hasMore === true, JSON.stringify({n:p1.json.rows.length,t:p1.json.total,h:p1.json.hasMore}));
    A('page 1 is newest-first (C5 then C4)', p1.json.rows[0].client === 'C5' && p1.json.rows[1].client === 'C4', p1.json.rows.map(r=>r.client).join(','));
    const cur1 = p1.json.nextCursor;
    A('page 1 exposes a nextCursor', cur1 != null);

    // Page 2 via cursor — no overlap.
    const p2 = await http.get('/api/invoices?'+E+'&limit=2&before=' + cur1);
    A('page 2 has next 2 rows (C3, C2), no overlap with page 1', p2.json.rows.map(r=>r.client).join(',') === 'C3,C2', p2.json.rows.map(r=>r.client).join(','));
    A('page 2 still reports total 5, hasMore true', p2.json.total === 5 && p2.json.hasMore === true);

    // Page 3 — last row, hasMore false, nextCursor null.
    const p3 = await http.get('/api/invoices?'+E+'&limit=2&before=' + p2.json.nextCursor);
    A('page 3 has the last row (C1)', p3.json.rows.map(r=>r.client).join(',') === 'C1', p3.json.rows.map(r=>r.client).join(','));
    A('page 3 is the end (hasMore false, nextCursor null)', p3.json.hasMore === false && p3.json.nextCursor === null, JSON.stringify({h:p3.json.hasMore,c:p3.json.nextCursor}));

    // Union of pages == the full set, exactly once each.
    const seen = [...p1.json.rows, ...p2.json.rows, ...p3.json.rows].map(r => r.client).sort().join(',');
    A('the three pages reconstruct the full set exactly once', seen === 'C1,C2,C3,C4,C5', seen);

    // limit is capped (>500 clamped) and never errors.
    const big = await http.get('/api/invoices?'+E+'&limit=99999');
    A('an over-large limit is clamped, not rejected', big.status === 200 && big.json.rows.length === 5);

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (list pagination: back-compat default + correct keyset pages)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[page] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
