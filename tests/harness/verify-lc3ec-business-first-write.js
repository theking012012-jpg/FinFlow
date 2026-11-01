#!/usr/bin/env node
'use strict';
/**
 * verify-lc3ec-business-first-write — LC3e-c (owner decision 2026-11-01: refuse connecting a business service until a
 * business exists). The connect ROUTES already refuse (decision 3.6, verify-36-business-first); this executes the backstop
 * AT THE WRITE: every connector saves through _mutateSettingsBlob, which now refuses a linked business connection with
 * no business (entity NULL). Personal's own bank (belvo_conn at entity NULL) and clearing a legacy blob still work.
 * Real Postgres (Rule 3), the real function (exported test surface).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc3ec-business-first-write.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
(async () => {
  const s = await startScratchPostgres({ keep: false });
  let server;
  try {
    server = await bootServer(s.url);
    const app = require('../../server.js');
    const uid = (await s.client.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email: 'lc3ec@x.test', password: bcrypt.hashSync('x', 4) }])).rows[0].id;
    const tryWrite = async (key, val) => { try { await app._mutateSettingsBlob(uid, key, null, () => val); return 'ok'; } catch (e) { return [e.status, e.code].join(' '); } };
    A('a WiPay connection with no business is refused at the write (400 NO_BUSINESS_IN_VIEW)', (await tryWrite('wipay_conn', { account_number: '123', api_key: 'x' })) === '400 NO_BUSINESS_IN_VIEW');
    A('…a Stripe one too', (await tryWrite('stripe_conn', { stripe_user_id: 'acct_1' })) === '400 NO_BUSINESS_IN_VIEW');
    A('nothing was stored', (await s.client.query(`SELECT count(*)::int n FROM user_settings WHERE user_id = $1 AND data->>'key' IN ('wipay_conn','stripe_conn')`, [uid])).rows[0].n === 0);
    A('Personal\'s own bank (belvo_conn, no business) still saves', (await tryWrite('belvo_conn', { links: [{ link: 'l1', institution: 'Bank' }] })) === 'ok');
    A('clearing a legacy account-level blob still works', (await tryWrite('wipay_conn', {})) === 'ok');
  } finally { if (server && server.close) await server.close(); await s.stop(); }
  console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (LC3e-c write backstop)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR', e && e.stack); process.exit(1); });
