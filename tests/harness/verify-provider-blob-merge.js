#!/usr/bin/env node
'use strict';
/**
 * verify-provider-blob-merge.js — N45b. A provider connection blob (stripe_conn, codat_conn, finch_conn, the OAuth
 * driver's token blob) is updated by MERGING onto what is stored now, under the row lock — so a change written by
 * another request in the meantime is never overwritten.
 *
 * Defect: merge writers read the blob, did other work, then saved Object.assign({}, <that copy>, patch) — the
 * WHOLE blob. Anything written in between was silently replaced by the stale copy. Example: changing which
 * business Stripe books to while reconnecting Stripe in another tab put the OLD account and token back.
 *
 * Executed: real server + Postgres, real POST /api/stripe/binding. The window is made deterministic: when the route
 * reaches its business-ownership check (after it has read the blob, before it saves) a pool.query wrapper first
 * rewrites the blob with a new Stripe account (acct_NEW) — standing in for the concurrent reconnect.
 *   after both: stripe_user_id = acct_NEW AND books = { business, B }      (bug: acct_OLD — the reconnect undone)
 *   control: the binding alone (no concurrent write) → books set, account unchanged
 *   node -r ./tests/harness/clock.js tests/harness/verify-provider-blob-merge.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'blob-merge-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'bm@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'A Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'B Co', currency: 'USD', is_active: 0 }])).rows[0].id;
    const blobRow = (await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3) RETURNING id`,
      [uid, eA, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_OLD', access_token: 'enc-old', books: { scope: 'business', entity_id: eA } }) }])).rows[0].id;
    const blob = async () => JSON.parse((await c.query(`SELECT data->>'value' v FROM user_settings WHERE id=$1`, [blobRow])).rows[0].v);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.45.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'bm@finflow.test', password: PW })).status === 200);

    console.log('\n' + '='.repeat(78));
    console.log('  PROVIDER BLOB — a merge never undoes a concurrent write');
    console.log('='.repeat(78));
    const r0 = await h.post(`/api/stripe/binding?entity_id=${eA}`, { scope: 'business', entity_id: eA });
    const b0 = await blob();
    A('control: binding alone → 200, account unchanged (acct_OLD), books A', r0.status === 200 && b0.stripe_user_id === 'acct_OLD' && b0.books.entity_id === eA, `status ${r0.status} ${JSON.stringify(b0)}`);

    const { pool } = require('../../database.js');
    const realQ = pool.query.bind(pool);
    let delayed = false;
    // The binding has ALREADY read the blob when it reaches its ownership check; the reconnect is written at
    // exactly that moment (inside the window), then the check proceeds.
    pool.query = (text, ...rest) => {
      // The route's OWN check is for business B; the entity middleware runs the same SQL earlier for A (?entity_id).
      if (!delayed && /SELECT id FROM entities WHERE id=\$1 AND user_id=\$2/.test(String(text && text.text || text)) && Array.isArray(rest[0]) && Number(rest[0][0]) === eB) {
        delayed = true;
        return c.query(`UPDATE user_settings SET data = data || jsonb_build_object('value', $2::text) WHERE id=$1`,
            [blobRow, JSON.stringify({ stripe_user_id: 'acct_NEW', access_token: 'enc-new', books: { scope: 'business', entity_id: eA } })])
          .then(() => realQ(text, ...rest));
      }
      return realQ(text, ...rest);
    };
    const r1 = await h.post(`/api/stripe/binding?entity_id=${eA}`, { scope: 'business', entity_id: eB });
    pool.query = realQ;
    const b1 = await blob();
    A('the delay window was exercised', delayed === true);
    A('after both: the reconnect survives (acct_NEW, enc-new) (bug: acct_OLD written back)', r1.status === 200 && b1.stripe_user_id === 'acct_NEW' && b1.access_token === 'enc-new', `status ${r1.status} ${JSON.stringify(b1)}`);
    A('  and the binding applied: books → business B', b1.books && b1.books.scope === 'business' && b1.books.entity_id === eB, JSON.stringify(b1.books));
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (provider blob merge)` : `  ALL GREEN — ${pass} passed, 0 failed  (provider blob merge)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main();
