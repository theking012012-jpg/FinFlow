#!/usr/bin/env node
'use strict';
/**
 * verify-provider-blob-atomic.js — N45. A bank linked while a sync is running is kept; the sync's cursor is kept.
 *
 * Defect: the linked-bank list (user_settings 'plaid_items') was read at the start of a request and written back
 * whole at the end. A sync — seconds of Plaid calls — that finished after a concurrent link wrote its stale
 * list over it: the newly linked bank vanished.
 * Executed: real server + Postgres; Plaid mocked at its HTTP boundary. Item A linked. A sync for A is started
 * (Plaid answers after 600 ms); while it runs, bank B is linked (exchange).
 *   afterwards: items = A (cursor advanced to 'cA1') + B          (bug: B lost — the sync wrote [A] back)
 *   unlink A while a sync runs → A stays unlinked                 (bug: the sync writes A back)
 *   node -r ./tests/harness/clock.js tests/harness/verify-provider-blob-atomic.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let scratch, server;
  const realFetch = global.fetch;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    process.env.PLAID_CLIENT_ID = 'cid-harness'; process.env.PLAID_SECRET = 'secret-harness';
    let nextItem = 'item-B';
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (/plaid\.com\/transactions\/sync/.test(u)) { await sleep(600); return { ok: true, status: 200, json: async () => ({ added: [], modified: [], removed: [], next_cursor: 'cA1', has_more: false }) }; }
      if (/plaid\.com\/item\/public_token\/exchange/.test(u)) return { ok: true, status: 200, json: async () => ({ access_token: 'access-' + nextItem, item_id: nextItem }) };
      if (/plaid\.com\/accounts\/get/.test(u)) return { ok: true, status: 200, json: async () => ({ item: {} }) };
      if (/plaid\.com\/item\/remove/.test(u)) return { ok: true, status: 200, json: async () => ({}) };
      return realFetch(url, opts);
    };
    const app = require('../../server.js');
    const PW = 'blob-atomic-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'ba@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'BA Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { key: 'plaid_items', value: JSON.stringify([{ item_id: 'item-A', access_token: app._encTok('access-A'), institution_name: 'Bank A', cursor: null }]) }]);
    const items = async () => { const r = (await c.query(`SELECT data->>'value' v FROM user_settings WHERE user_id=$1 AND data->>'key'='plaid_items'`, [uid])).rows; return r.length ? JSON.parse(r[0].v) : []; };
    const h = new HarnessHttp(server.baseUrl, { xff: '10.45.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'ba@finflow.test', password: PW })).status === 200);
    const q = `?entity_id=${eA}`;

    const syncP = h.post('/api/plaid/sync' + q, {});
    await sleep(150);
    const ex = await h.post('/api/plaid/exchange' + q, { public_token: 'public-sandbox-B' });
    const sy = await syncP;
    const after = await items();
    A('link during sync → 201; sync → 200', ex.status === 201 && sy.status === 200, `exchange ${ex.status} sync ${sy.status}`);
    A('bank B (linked during the sync) is kept (bug: lost — the sync wrote its stale list back)', after.some(i => i.item_id === 'item-B'), JSON.stringify(after.map(i => i.item_id)));
    const a = after.find(i => i.item_id === 'item-A') || {};
    A('item A cursor advanced by the sync (cA1)', a.cursor === 'cA1', JSON.stringify(a.cursor));

    const sync2 = h.post('/api/plaid/sync' + q, {});
    await sleep(150);
    const un = await h.post('/api/plaid/unlink' + q, { item_id: 'item-A' });
    await sync2;
    const after2 = await items();
    A('unlink A during a sync → A stays unlinked (bug: the sync writes A back)', un.status === 200 && !after2.some(i => i.item_id === 'item-A') && after2.some(i => i.item_id === 'item-B'), JSON.stringify(after2.map(i => i.item_id)));
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (provider blob atomic)` : `  ALL GREEN — ${pass} passed, 0 failed  (provider blob atomic)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
