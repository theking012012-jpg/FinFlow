'use strict';
/**
 * verify-connections-entity-scope.js — per-entity connectors (Finch, Codat, Belvo, WiPay). Each
 * business links its OWN connection; business A's shows only on A, B's only on B (no cross-entity
 * bleed). A legacy account-level connection (entity_id NULL) still shows on a business that has not
 * linked its own — the backward-compat fallback, so nothing breaks on deploy. Disconnect is per-entity
 * (clearing A never touches B or the legacy row). The public WiPay callback verifies the payment hash
 * against the INVOICE's own business's key — a hash from the wrong entity's key is rejected.
 *   node -r ./tests/harness/clock.js tests/harness/verify-connections-entity-scope.js
 */
require('./clock.js');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'conns-owner@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const seed = (c, uid, eid, value) => c.query(
    `INSERT INTO user_settings (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
    [uid, eid, { key: value.__key, value: JSON.stringify(value.v) }]);
  try {
    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client; server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'S', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const mkEnt = async (name, active) => (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`, [uid, { name, currency: 'USD', is_active: active }])).rows[0].id;
    const eidA = await mkEnt('A Co', 1), eidB = await mkEnt('B Co', 0), eidC = await mkEnt('C Co', 0);

    // ── per-entity connections for A and B ──
    await seed(c, uid, eidA, { __key: 'finch_conn', v: { access_token: 'x', provider_name: 'gusto_A', linked_at: 't' } });
    await seed(c, uid, eidB, { __key: 'finch_conn', v: { access_token: 'x', provider_name: 'adp_B', linked_at: 't' } });
    await seed(c, uid, eidA, { __key: 'codat_conn', v: { company_id: 'co_A' } });
    await seed(c, uid, eidB, { __key: 'codat_conn', v: { company_id: 'co_B' } });
    await seed(c, uid, eidA, { __key: 'belvo_conn', v: { links: [{ link: 'lA', institution: 'Banco_A' }] } });
    await seed(c, uid, eidB, { __key: 'belvo_conn', v: { links: [{ link: 'lB', institution: 'Banco_B' }] } });
    await seed(c, uid, eidA, { __key: 'wipay_conn', v: { account_number: 'acct_A', country: 'TT', api_key: 'KEY_A' } });
    await seed(c, uid, eidB, { __key: 'wipay_conn', v: { account_number: 'acct_B', country: 'JM', api_key: 'KEY_B' } });
    // legacy account-level (entity_id NULL) — pre-per-entity single connections
    await seed(c, uid, null, { __key: 'finch_conn', v: { access_token: 'x', provider_name: 'legacy_payroll', linked_at: 't' } });
    await seed(c, uid, null, { __key: 'belvo_conn', v: { links: [{ link: 'lLeg', institution: 'Banco_LEGACY' }] } });

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', OWNER)).status === 200);
    const get = async (p, eid) => (await http.get(p + '?entity_id=' + eid)).json || {};

    // ── FINCH ──
    A('Finch: A sees its OWN payroll', (await get('/api/finch/status', eidA)).provider === 'gusto_A');
    A('Finch: B sees its OWN payroll', (await get('/api/finch/status', eidB)).provider === 'adp_B');
    A('Finch: A does NOT see B (no bleed)', (await get('/api/finch/status', eidA)).provider !== 'adp_B');
    A('Finch: C (no own) falls back to legacy', (await get('/api/finch/status', eidC)).provider === 'legacy_payroll');

    // ── CODAT ──
    A('Codat: A sees its OWN company', (await get('/api/codat/status', eidA)).company_id === 'co_A');
    A('Codat: B sees its OWN company', (await get('/api/codat/status', eidB)).company_id === 'co_B');
    A('Codat: A does NOT see B (no bleed)', (await get('/api/codat/status', eidA)).company_id !== 'co_B');
    A('Codat: C (no own, no legacy) is unconnected', (await get('/api/codat/status', eidC)).company_id == null);

    // ── BELVO ──
    A('Belvo: A sees its OWN institutions', ((await get('/api/belvo/status', eidA)).institutions || []).includes('Banco_A'));
    A('Belvo: B sees its OWN institutions', ((await get('/api/belvo/status', eidB)).institutions || []).includes('Banco_B'));
    A('Belvo: A does NOT see B (no bleed)', !((await get('/api/belvo/status', eidA)).institutions || []).includes('Banco_B'));
    A('Belvo: C (no own) falls back to legacy', ((await get('/api/belvo/status', eidC)).institutions || []).includes('Banco_LEGACY'));

    // ── WIPAY ──
    A('WiPay: A sees its OWN account', (await get('/api/wipay/status', eidA)).account === 'acct_A');
    A('WiPay: B sees its OWN account', (await get('/api/wipay/status', eidB)).account === 'acct_B');
    A('WiPay: A does NOT see B (no bleed)', (await get('/api/wipay/status', eidA)).account !== 'acct_B');

    // ── DISCONNECT is per-entity: clearing A does not touch B or legacy ──
    A('WiPay disconnect A 200', (await http.post('/api/wipay/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after A disconnect, A is cleared', !(await get('/api/wipay/status', eidA)).account);
    A('after A disconnect, B still linked', (await get('/api/wipay/status', eidB)).account === 'acct_B');
    A('Belvo disconnect A 200', (await http.post('/api/belvo/disconnect?entity_id=' + eidA, {})).status === 200);
    A('after A disconnect, C still falls back to legacy Belvo', ((await get('/api/belvo/status', eidC)).institutions || []).includes('Banco_LEGACY'));

    // ── WIPAY CALLBACK: verify hash against the INVOICE's own business's key ──
    // NB: WiPay stores api_key ENCRYPTED (encTok); the callback decTok's it before hashing. The harness
    // can't encTok, so re-seed B's wipay with a properly-encrypted key via the connect route.
    await http.post('/api/entities/' + eidB + '/activate', {}).catch(() => {});
    await http.post('/api/wipay/connect?entity_id=' + eidB, { account_number: 'acct_B', api_key: 'PLAINKEY_B', country: 'JM' });
    // an invoice under business B, amount 100.00
    const invB = (await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eidB, { client: 'Cust', amount: 100, amount_paid: 0, status: 'pending', currency: 'JMD' }])).rows[0].id;
    const txnGood = 'TXN_GOOD_' + Date.now();
    const hashGood = crypto.createHash('md5').update(txnGood + '100.00' + 'PLAINKEY_B').digest('hex');
    await http.get(`/api/wipay/callback?order_id=INV-${invB}-1&status=success&transaction_id=${txnGood}&hash=${hashGood}`);
    const bookedGood = (await c.query(`SELECT 1 FROM invoice_payments WHERE idempotency_key=$1 LIMIT 1`, ['wipay:' + txnGood])).rows.length;
    A('WiPay callback: B-invoice paid with B\'s key is RECORDED', bookedGood === 1);

    // a hash computed with the WRONG entity's key (A's) against B's invoice must be rejected
    const invB2 = (await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eidB, { client: 'Cust2', amount: 100, amount_paid: 0, status: 'pending', currency: 'JMD' }])).rows[0].id;
    const txnBad = 'TXN_BAD_' + Date.now();
    const hashBad = crypto.createHash('md5').update(txnBad + '100.00' + 'KEY_A').digest('hex'); // A's key — wrong business
    await http.get(`/api/wipay/callback?order_id=INV-${invB2}-1&status=success&transaction_id=${txnBad}&hash=${hashBad}`);
    const bookedBad = (await c.query(`SELECT 1 FROM invoice_payments WHERE idempotency_key=$1 LIMIT 1`, ['wipay:' + txnBad])).rows.length;
    A('WiPay callback: wrong-entity key hash is REJECTED (not recorded)', bookedBad === 0);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (connectors per-entity)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
