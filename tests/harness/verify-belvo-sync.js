'use strict';
/*
 * verify-belvo-sync.js - Belvo (LatAm bank feed) parity with Plaid: a linked Belvo bank feeds the
 * reconciliation river. Belvo is env-gated (no keys in CI), so this proves:
 *   - belvoTxnToRow maps a Belvo transaction to a personal_transactions feed row correctly:
 *     OUTFLOW -> debit, INFLOW -> credit, amount abs, date sliced, description/category fallbacks,
 *     source 'banking', belvo_txn_id set (idempotency key).
 *   - a mapped row lands in the /api/banking feed (source:'banking') with the right tx_type.
 *   - /api/belvo/sync is env-gated: clean 502 BELVO_NOT_CONFIGURED without keys (never a crash).
 *   - /api/belvo/status reports configured:false / connected:false with no keys/links.
 *   node -r ./tests/harness/clock.js tests/harness/verify-belvo-sync.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { belvoTxnToRow, belvoConfigured } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  BELVO (LatAm) - transaction import parity with Plaid (env-gated)\n' + '='.repeat(78) + '\n');

    // ── mapping unit tests ──
    const out = belvoTxnToRow({ id: 'bt_1', type: 'OUTFLOW', amount: 150.5, value_date: '2026-06-10T00:00:00Z', description: 'Cafe', category: 'Food' }, 7, 9);
    A('OUTFLOW -> debit', out.tx_type === 'debit', JSON.stringify(out));
    A('amount abs + fields (150.5, banking, key, entity, date sliced)', near(out.amount, 150.5) && out.source === 'banking' && out.belvo_txn_id === 'bt_1' && out.entity_id === 9 && out.tx_date === '2026-06-10' && out.category === 'Food' && out.description === 'Cafe', JSON.stringify(out));
    const inn = belvoTxnToRow({ id: 'bt_2', type: 'INFLOW', amount: -80, accounting_date: '2026-06-11', merchant: { name: 'ACME' } }, 7, null);
    A('INFLOW -> credit, amount abs(80)', inn.tx_type === 'credit' && near(inn.amount, 80), JSON.stringify(inn));
    A('description falls back to merchant.name; entity null ok; category default Other', inn.description === 'ACME' && inn.entity_id === null && inn.category === 'Other', JSON.stringify(inn));
    const bare = belvoTxnToRow({ id: 'bt_3', amount: 10 }, 7, null);
    A('missing type -> credit (default), missing desc -> Bank transaction', bare.tx_type === 'credit' && bare.description === 'Bank transaction', JSON.stringify(bare));

    // ── mapped row feeds the /api/banking river ──
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email: 'belvo@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'LatAm Co', currency: 'USD' }])).rows[0].id;
    const row = belvoTxnToRow({ id: 'bt_feed', type: 'OUTFLOW', amount: 42, value_date: '2026-06-12', description: 'Supplies MX', category: 'Office' }, uid, eid);
    const data = { description: row.description, amount: row.amount, tx_type: row.tx_type, tx_date: row.tx_date, category: row.category, source: row.source, belvo_txn_id: row.belvo_txn_id };
    await c.query(`INSERT INTO personal_transactions (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eid, data]);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.90' });
    A('login 200', (await http.post('/api/auth/login', { email: 'belvo@finflow.test', password: PW })).status === 200);
    const feed = JSON.parse((await http.request('GET', '/api/banking?entity_id=' + eid)).text);
    const mine = (Array.isArray(feed) ? feed : (feed.rows || feed.transactions || [])).find(r => (r.belvo_txn_id === 'bt_feed') || (r.data && r.data.belvo_txn_id === 'bt_feed') || r.description === 'Supplies MX');
    A('mapped Belvo txn appears in the /api/banking feed', !!mine, 'feed len=' + (Array.isArray(feed) ? feed.length : 'n/a'));
    A('feed row tx_type=debit, amount 42', mine && (mine.tx_type === 'debit' || (mine.data && mine.data.tx_type === 'debit')) && near(mine.amount || (mine.data && mine.data.amount), 42), JSON.stringify(mine));

    // ── env gate ──
    A('belvoConfigured() is false (no keys in CI)', belvoConfigured() === false);
    const sync = await http.post('/api/belvo/sync', {});
    A('/api/belvo/sync env-gated -> 502 BELVO_NOT_CONFIGURED', sync.status === 502 && /BELVO_NOT_CONFIGURED/.test(sync.text), 'status=' + sync.status + ' ' + (sync.text || '').slice(0, 120));
    const st = JSON.parse((await http.request('GET', '/api/belvo/status')).text);
    A('/api/belvo/status -> configured false, connected false', st.configured === false && st.connected === false, JSON.stringify(st));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED - ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (Belvo import maps + feeds the river; env-gated)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
