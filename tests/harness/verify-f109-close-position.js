'use strict';
/**
 * verify-f109-close-position — F109. A holding can be closed in full or in part; the realized gain
 * (shares × (price − average cost)) is stored on the SAME side of the personal/business wall as the holding, listed on
 * its own line, never in operating profit; two closes cannot sell the same shares; a close can be undone.
 *
 * Executed: real server + scratch Postgres (Rule 3). Hand-computed (Rule 6), seeds discriminate (Rule 4):
 *   personal AAPL 10 @ 100 → close 4 @ 150 (+200) → two simultaneous closes of 4 from 6 (one must be refused) at 120
 *   (+80) → close the last 2 @ 90 (−20): personal total 260; business MSFT 5 @ 200 → close 5 @ 260 (+300).
 *   Undo +200 → AAPL re-opened 4 @ 100; its cost edited to 130; undo −20 (2 @ 100) → 6 @ 120 in THAT holding (the
 *   original was gone — the shares rejoin the open AAPL on the same side, never a second AAPL row; bug: 2 rows).
 * Bug values (old code): no close route (404) — a realized gain could not be recorded at all.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f109-close-position.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };

(async () => {
  let scratch, server;
  console.log('\nF109 — close a position, record the realized gain\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    const mk = async (email) => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const uid = await mk('f109@finflow.test'), accUid = await mk('f109-acc@finflow.test');
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.109' });
    await http.post('/api/auth/login', { email: 'f109@finflow.test', password: PW });
    const ent = (await http.post('/api/entities', { name: 'Holdco', currency: 'USD', country: 'US', timezone: 'UTC' })).json;
    await http.post('/api/entities/' + ent.id + '/activate', {});
    await http.post('/api/invoices', { client: 'Op Co', amount: 1000, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01' });
    const aapl = (await http.post('/api/holdings', { ticker: 'AAPL', shares: 10, cost_per: 100, price: 150 })).json;
    const msft = (await http.post('/api/holdings', { ticker: 'MSFT', shares: 5, cost_per: 200, price: 260, scope: 'business' })).json;
    const hold = async (id) => { const r = (await c.query(`SELECT data FROM holdings WHERE id = $1`, [id])).rows[0]; return r ? r.data : null; };
    const profit = async () => { const r = (await http.get('/api/reports?period=year')).json || {}; return [r.revenue, r.expenses, r.profit]; };
    const close = (id, body) => http.post(`/api/holdings/${id}/close`, body);

    const p1 = await close(aapl.id, { shares: 4, price: 150, date: '2026-07-20' });
    A('close 4 of 10 AAPL at 150 (cost 100) → realized +200.00 (bug: no route)', p1.status === 201 && p1.json.realized.gain === 200, `${p1.status} ${String(p1.text).slice(0, 160)}`);
    A('…the holding keeps 6 at the same average cost 100', JSON.stringify([Number((await hold(aapl.id)).shares), Number((await hold(aapl.id)).cost_per)]) === '[6,100]');
    const over = await close(aapl.id, { shares: 7, price: 150 });
    A('closing 7 of 6 → 400 TOO_MANY_SHARES, nothing changed', over.status === 400 && over.json.code === 'TOO_MANY_SHARES' && Number((await hold(aapl.id)).shares) === 6, `${over.status}`);
    const both = await Promise.all([close(aapl.id, { shares: 4, price: 120, date: '2026-07-21' }), close(aapl.id, { shares: 4, price: 120, date: '2026-07-21' })]);
    A('two simultaneous closes of 4 from 6: exactly one succeeds, one is refused (no shares sold twice)', both.map(r => r.status).sort().join() === '201,400' && Number((await hold(aapl.id)).shares) === 2, both.map(r => r.status).join());
    const fut = await close(aapl.id, { shares: 1, price: 90, date: '2026-12-01' });
    const badp = await close(aapl.id, { shares: 1, price: -5 });
    A('a future date → 400 FUTURE_DATE; a negative price → 400 (body-shape BAD_FIELD_TYPE, or BAD_PRICE)', fut.status === 400 && fut.json.code === 'FUTURE_DATE' && badp.status === 400 && ['BAD_PRICE', 'BAD_FIELD_TYPE'].includes(badp.json.code), JSON.stringify([fut.json, badp.json]));
    const last = await close(aapl.id, { shares: 2, price: 90, date: '2026-07-22' });
    A('closing the last 2 at 90 → realized −20.00 and the position is gone', last.status === 201 && last.json.realized.gain === -20 && (await hold(aapl.id)) === null, `${last.status} ${JSON.stringify(last.json)}`);

    const before = await profit();
    const b1 = await close(msft.id, { shares: 5, price: 260, date: '2026-07-23' });
    A('business: close 5 MSFT at 260 (cost 200) → +300.00', b1.status === 201 && b1.json.realized.gain === 300, `${b1.status}`);
    A('operating revenue / expenses / profit unchanged by the close (not operating income)', JSON.stringify(await profit()) === JSON.stringify(before), JSON.stringify([before, await profit()]));
    const pers = (await http.get('/api/realized-gains?scope=personal')).json, biz = (await http.get('/api/realized-gains?scope=business')).json;
    A('personal realized total 260.00 = +200 +80 −20, AAPL only', pers.total === 260 && pers.rows.length === 3 && pers.rows.every(r => r.ticker === 'AAPL'), JSON.stringify(pers));
    A('business realized total 300.00, MSFT only (the wall, both ways)', biz.total === 300 && biz.rows.length === 1 && biz.rows[0].ticker === 'MSFT', JSON.stringify(biz));
    const sides = (await c.query(`SELECT data->>'ticker' t, entity_id FROM realized_gains ORDER BY id`)).rows;
    A('stored on the holding\'s side: AAPL with no business, MSFT under Holdco', sides.every(r => (r.t === 'AAPL' ? r.entity_id === null : r.entity_id === ent.id)), JSON.stringify(sides));
    const at = (await c.query(`SELECT count(*)::int n FROM audit_trail WHERE table_name = 'realized_gains'`)).rows[0].n;
    const ph = (await c.query(`SELECT count(*)::int n FROM personal_history WHERE kind = 'realized_gains'`)).rows[0].n;
    A('history: the business close on the audit trail (1), the personal closes in personal history (3), never crossed', at === 1 && ph === 3, `audit ${at}, personal ${ph}`);

    // A team member (accountant) closes a business holding → it is the business's, not the member's.
    await c.query(`INSERT INTO team_members (user_id,entity_id,data) VALUES ($1,NULL,$2)`, [uid, { email: 'f109-acc@finflow.test', role: 'accountant', status: 'active', member_user_id: String(accUid) }]);
    const nvda = (await http.post('/api/holdings', { ticker: 'NVDA', shares: 3, cost_per: 50, price: 70, scope: 'business' })).json;
    const acc = new HarnessHttp(server.baseUrl, { xff: '203.0.113.110' });
    await acc.post('/api/auth/login', { email: 'f109-acc@finflow.test', password: PW });
    await acc.post('/api/my-access/switch', { accountOwnerId: uid });
    const ac = await acc.post(`/api/holdings/${nvda.id}/close`, { shares: 1, price: 70, date: '2026-07-24' });
    const nv = (await c.query(`SELECT user_id, entity_id FROM realized_gains WHERE data->>'ticker' = 'NVDA'`)).rows[0];
    A('an accountant member\'s close of a business holding is the business\'s (owner\'s account, Holdco)', ac.status === 201 && nv && nv.user_id === uid && nv.entity_id === ent.id, `${ac.status} ${JSON.stringify(nv)}`);

    // Undo.
    const first = pers.rows.find(r => r.gain === 200), lastRec = pers.rows.find(r => r.gain === -20);
    const u1 = await http.request('DELETE', '/api/realized-gains/' + first.id);
    const reopened = u1.json && u1.json.holding;
    A('undo +200 → the fully closed AAPL is re-opened with 4 at cost 100', u1.status === 200 && reopened && Number(reopened.shares) === 4 && Number(reopened.cost_per) === 100, `${u1.status} ${JSON.stringify(reopened)}`);
    await http.request('PUT', '/api/holdings/' + reopened.id, { cost_per: 130 });
    const u2 = await http.request('DELETE', '/api/realized-gains/' + lastRec.id);
    A('undo −20 (2 at cost 100) into 4 at 130 → 6 at 120 (cost re-weighted; bug: 130 or 100)', u2.status === 200 && Number(u2.json.holding.shares) === 6 && Math.abs(Number(u2.json.holding.cost_per) - 120) < 1e-9, JSON.stringify(u2.json));
    const aaplRows = (await c.query(`SELECT count(*)::int n FROM holdings WHERE user_id = $1 AND entity_id IS NULL AND data->>'ticker' = 'AAPL'`, [uid])).rows[0].n;
    A('…into the one open AAPL — never a second AAPL row (bug: 2)', aaplRows === 1, `AAPL rows: ${aaplRows}`);
    A('personal realized total after both undos: 80.00', (await http.get('/api/realized-gains?scope=personal')).json.total === 80);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally {
    try { if (server) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F109 close a position)\n`);
  process.exit(fail ? 1 : 0);
})();
