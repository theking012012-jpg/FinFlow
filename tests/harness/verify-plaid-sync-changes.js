#!/usr/bin/env node
'use strict';
/**
 * verify-plaid-sync-changes.js — N44. A Plaid sync applies modified and removed transactions, not only added
 * ones; a transaction already reconciled into the books is flagged, never silently changed or deleted.
 *
 * Defect: /api/plaid/sync processed only sync.added. When a pending transaction posted, Plaid sent `removed`
 * for the pending id and `added` for the posted one — the pending line stayed, so the bank feed showed the
 * spend twice; amount/date corrections (`modified`) never arrived. iso_currency_code was dropped.
 * Executed: real server + Postgres; Plaid mocked only at its HTTP boundary (sandbox.plaid.com).
 *   sync 1: added P1 (pending, 12.00), T2 (40.00), T3 (9.00, then reconciled as an expense)
 *   sync 2: removed P1, added T1 (posted 12.50, pending_transaction_id P1), modified T2 → 45.00, removed T3
 *     P1 gone (bug: stays → duplicate)        T2 = 45.00 (bug: 40.00)
 *     T3 still there, flagged plaid_removed — the booked expense is untouched (control)
 *     currency recorded (USD)
 *   node -r ./tests/harness/clock.js tests/harness/verify-plaid-sync-changes.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const T = (id, amt, extra = {}) => Object.assign({ transaction_id: id, amount: amt, date: '2026-07-20', name: 'Txn ' + id, iso_currency_code: 'USD', pending: false }, extra);
const PAGES = [
  { added: [T('P1', 12, { pending: true }), T('T2', 40), T('T3', 9)], modified: [], removed: [], next_cursor: 'c1', has_more: false },
  { added: [T('T1', 12.5, { pending_transaction_id: 'P1' })], modified: [T('T2', 45)], removed: [{ transaction_id: 'P1' }, { transaction_id: 'T3' }], next_cursor: 'c2', has_more: false },
];

(async () => {
  let scratch, server;
  const realFetch = global.fetch;
  let page = 0;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    process.env.PLAID_CLIENT_ID = 'cid-harness'; process.env.PLAID_SECRET = 'secret-harness';
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (/plaid\.com\/transactions\/sync/.test(u)) { const p = PAGES[Math.min(page, PAGES.length - 1)]; page++; return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(p)) }; }
      return realFetch(url, opts);
    };
    const app = require('../../server.js');
    const PW = 'plaid-changes-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'pc@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'PC Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { key: 'plaid_items', value: JSON.stringify([{ item_id: 'it1', access_token: app._encTok('access-sandbox-1'), institution_name: 'Test Bank', cursor: null }]) }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.44.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'pc@finflow.test', password: PW })).status === 200);
    const row = async id => (await c.query(`SELECT id, data FROM personal_transactions WHERE user_id=$1 AND data->>'plaid_txn_id'=$2`, [uid, id])).rows[0];
    const s1 = await h.post(`/api/plaid/sync?entity_id=${eA}`, {});
    A('sync 1 → 3 added', s1.status === 200 && s1.json && s1.json.added === 3, `status ${s1.status} ${s1.text.slice(0, 120)}`);
    const t3 = await row('T3');
    const bx = await h.post(`/api/bank-reconciliation/book-expense?entity_id=${eA}`, { banking_id: t3.id });
    A('T3 reconciled as an expense', bx.status === 200, `status ${bx.status} ${bx.text.slice(0, 100)}`);
    const s2 = await h.post(`/api/plaid/sync?entity_id=${eA}`, {});
    A('sync 2 → 200', s2.status === 200, `status ${s2.status} ${s2.text.slice(0, 120)}`);
    A('pending P1 removed when it posted as T1 (bug: P1 stays → the spend shows twice)', !(await row('P1')) && !!(await row('T1')), JSON.stringify(s2.json));
    const t2 = await row('T2');
    A('T2 modified to 45.00 (bug: stays 40.00)', t2 && Number(t2.data.amount) === 45, JSON.stringify(t2 && t2.data.amount));
    const t3b = await row('T3');
    A('control: reconciled T3 kept and flagged plaid_removed (the booked expense is not silently undone)', t3b && t3b.data.plaid_removed === true && t3b.data.reconcile_state === 'expense', JSON.stringify(t3b && t3b.data));
    A('currency recorded on the bank line (USD)', t2 && t2.data.currency === 'USD', JSON.stringify(t2 && t2.data.currency));
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (Plaid sync changes)` : `  ALL GREEN — ${pass} passed, 0 failed  (Plaid sync changes)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
