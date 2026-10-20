'use strict';
/**
 * verify-lc3e-integration-audit.js — LC3e (owner decision 2026-10-20: "industry standard, but better").
 *
 * Connecting or disconnecting an outside service (a bank, a payment processor, a store, payroll, an accounting
 * platform) changes who can read or write a business's books — and none of it was recorded: no connect, no
 * disconnect, no change of which business a Stripe account books into, no change to the connection toggles, no
 * integration request.
 *
 * Standard: every grant and revocation of third-party access is on the record, with who, when and from where; never a
 * credential. Better: it is recorded at the ONE place every connection is written (`_mutateSettingsBlob`, through
 * `_saveProviderBlobE` / `_mutatePlaidItemsE`), so every current provider — and any added later — is covered without
 * its own audit call; a token refresh is NOT a new connection (no noise); a PERSONAL connection never reaches a
 * business trail (the wall — it belongs to the personal history, LC3c).
 *
 * Real scratch Postgres, real server, real routes. Providers that need a live account (Plaid / Belvo / Finch / Codat /
 * Stripe OAuth) are not called; they write through the same function this test drives through WiPay, WooCommerce,
 * the credential connectors (dLocal / Mercado Pago / Wise) and Plaid unlink.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc3e-integration-audit.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const PW = 'harness-password-not-a-secret';

(async () => {
  let scratch, server;
  console.log('\nLC3e — connecting / disconnecting outside services is recorded, once, at the one write path\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    try { const { runMigrations, pool } = require('../../database.js'); await runMigrations(pool); } catch (_) {}
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'lc3e@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '203.0.113.70', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36' });
    const J = async (m, p, b) => { const r = await h.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
    await h.post('/api/auth/login', { email: 'lc3e@finflow.test', password: PW });
    const ent = await J('POST', '/api/entities', { name: 'Island Shop', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
    await J('POST', '/api/entities/' + ent.id + '/activate', {});
    let mark = 0;
    const since = async () => { mark = (await c.query(`SELECT COALESCE(MAX(id),0) m FROM audit_trail`)).rows[0].m; };
    const rows = async () => (await c.query(`SELECT table_name, record_id, action, entity_id, actor_type, ip_address, user_agent, old_data, new_data FROM audit_trail WHERE id > $1 AND user_id = $2 AND table_name IN ('integrations','settings','support_requests') ORDER BY id`, [mark, uid])).rows;
    const s = r => [r.action, r.new_data && r.new_data.provider || r.old_data && r.old_data.provider || null, r.entity_id === ent.id];

    // ── connect / disconnect ──
    await since();
    await J('POST', '/api/wipay/connect', { account_number: '1234567890', api_key: 'wipay-key-SECRET-1', country: 'TT' });
    await J('POST', '/api/wipay/connect', { account_number: '1234567890', api_key: 'wipay-key-SECRET-2', country: 'TT' });   // same account, new key: not a new connection
    await J('POST', '/api/wipay/disconnect', {});
    let t = await rows();
    eq('WiPay: CONNECTED once (re-saving the same account is not a new connection), then DISCONNECTED — on this business', t.map(s), [['INTEGRATION_CONNECTED', 'wipay', true], ['INTEGRATION_DISCONNECTED', 'wipay', true]], []);
    eq('…with the account, who and where', t[0] ? [t[0].new_data && t[0].new_data.account, t[0].actor_type, t[0].ip_address, !!t[0].user_agent] : null, ['1234567890', 'user', '203.0.113.70', true], null);

    await since();
    await J('POST', '/api/mercadopago/connect', { access_token: 'mp-token-SECRET-3' });
    await J('POST', '/api/mercadopago/disconnect', {});
    t = await rows();
    eq('a credential connector (Mercado Pago): CONNECTED then DISCONNECTED', t.map(s), [['INTEGRATION_CONNECTED', 'mercadopago', true], ['INTEGRATION_DISCONNECTED', 'mercadopago', true]], []);

    // WooCommerce connect checks the store URL over the network (safe-egress) — refused with no network, so this case
    // seeds the stored connection the way connect writes it and drives DISCONNECT, which needs no network.
    const wc = await h.post('/api/woocommerce/connect', { store_url: 'https://shop.example.com', consumer_key: 'ck_SECRET4', consumer_secret: 'cs_SECRET5' });
    if (wc.status >= 300) await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, ent.id, { key: 'woocommerce_conn', value: JSON.stringify({ connected: true, provider: 'WooCommerce', store_url: 'https://shop.example.com', consumer_key: 'enc-SECRET4', consumer_secret: 'enc-SECRET5' }) }]);
    await since();
    await J('POST', '/api/woocommerce/disconnect', {});
    t = await rows();
    eq('WooCommerce disconnect is recorded, naming the store (connect ' + (wc.status < 300 ? 'ran' : 'refused offline — seeded') + ')',
      t.map(r => [r.action, r.old_data && r.old_data.account]), [['INTEGRATION_DISCONNECTED', 'https://shop.example.com']], []);

    // ── Plaid items (array blob): unlink one of two banks ──
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, ent.id, { key: 'plaid_items', value: JSON.stringify([{ item_id: 'item-A', institution_name: 'Republic Bank', access_token: 'enc-SECRET-6' }, { item_id: 'item-B', institution_name: 'First Citizens', access_token: 'enc-SECRET-7' }]) }]);
    await since();
    await J('POST', '/api/plaid/unlink', { item_id: 'item-B' });
    t = await rows();
    eq('Plaid: unlinking one of two banks → one DISCONNECTED naming that bank', t.map(r => [r.action, r.old_data && r.old_data.account]), [['INTEGRATION_DISCONNECTED', 'First Citizens']], []);

    // ── Stripe books binding, connection toggles, integration request ──
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, ent.id, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_123', access_token: 'enc-SECRET-8', books: { scope: 'business', entity_id: ent.id } }) }]);
    await since();
    const bind = await h.post('/api/stripe/binding', { scope: 'personal' });
    await J('POST', '/api/connections', { stripe: true, quickbooks: false });
    await J('POST', '/api/integration-requests', { name: 'Xero' });
    t = await rows();
    eq('Stripe "books into": business → personal is recorded', bind.status < 300 ? t.filter(r => r.table_name === 'integrations').map(r => [r.action, r.old_data && r.old_data.books && r.old_data.books.scope, r.new_data && r.new_data.books && r.new_data.books.scope]) : 'binding refused: ' + bind.status,
      [['UPDATE', 'business', 'personal']], []);
    eq('connection toggles saved → settings UPDATE with the new toggles', t.filter(r => r.table_name === 'settings').map(r => [r.action, r.new_data && r.new_data.stripe]), [['UPDATE', true]], []);
    const reqId = (await c.query(`SELECT id FROM user_settings WHERE user_id = $1 AND data->>'key' = 'integration_request'`, [uid])).rows.map(r => r.id);
    eq('integration request → support_requests CREATE naming it, on the stored request', t.filter(r => r.table_name === 'support_requests').map(r => [r.action, r.new_data && r.new_data.integration, r.record_id]), [['CREATE', 'Xero', reqId[0]]], [['CREATE', 'Xero', null]]);

    // ── the wall: a PERSONAL connection never reaches the business trail ──
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { key: 'plaid_items', value: JSON.stringify([{ item_id: 'item-P', institution_name: 'My Personal Bank', access_token: 'enc-SECRET-9' }]) }]);
    await since();
    const pu = await h.post('/api/plaid/unlink?scope=personal', { item_id: 'item-P', scope: 'personal' });
    const biz = (await c.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE id > $1 AND user_id = $2 AND table_name = 'integrations'`, [mark, uid])).rows[0].n;
    eq('unlinking a PERSONAL bank writes nothing to the business audit trail (wall)', [pu.status, biz], [200, 0]);

    // ── bank feeds, executed: Plaid and Belvo answered by this test (the server runs in-process, so its fetch to
    //    sandbox.plaid.com / sandbox.belvo.com is served here); everything behind the routes is the real database ──
    process.env.PLAID_CLIENT_ID = 'test-client'; process.env.PLAID_SECRET = 'test-secret';
    process.env.BELVO_SECRET_ID = 'test-id'; process.env.BELVO_SECRET_PASSWORD = 'test-pw';
    const realFetch = globalThis.fetch;
    const reply = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url), b = (() => { try { return JSON.parse(opts.body || '{}'); } catch (_) { return {}; } })();
      if (u.startsWith('https://sandbox.plaid.com/')) {
        const p = u.slice('https://sandbox.plaid.com'.length);
        if (p === '/item/public_token/exchange') return reply(b.public_token === 'public-biz'
          ? { access_token: 'access-biz-SECRET-10', item_id: 'item-C' } : { access_token: 'access-pers-SECRET-11', item_id: 'item-Q' });
        if (p === '/accounts/get') return reply({ item: { institution_id: b.access_token === 'access-biz-SECRET-10' ? 'ins_biz' : 'ins_pers' } });
        if (p === '/institutions/get_by_id') return reply({ institution: { name: b.institution_id === 'ins_biz' ? 'Scotiabank' : 'My Credit Union' } });
        if (p === '/transactions/sync') return reply({ added: /SECRET-1[01]/.test(b.access_token) ? [{ transaction_id: 'tx-' + b.access_token, name: 'Coffee', amount: 4.5, date: '2026-07-20', iso_currency_code: 'TTD' }] : [], modified: [], removed: [], next_cursor: 'c1', has_more: false });
        return reply({ error_message: 'unexpected ' + p }, 400);
      }
      if (u.startsWith('https://sandbox.belvo.com/')) {
        if (u.includes('/api/accounts/')) return reply([{ id: 'acc-1' }]);
        if (u.includes('/api/transactions/')) return reply([{ id: 'bt-1', amount: 120, type: 'OUTFLOW', value_date: '2026-07-21', description: 'Rent' }, { id: 'bt-2', amount: 60, type: 'INFLOW', value_date: '2026-07-22', description: 'Refund' }]);
        return reply({}, 404);
      }
      return realFetch(url, opts);
    };
    try {
      await since();
      await J('POST', '/api/plaid/exchange', { public_token: 'public-biz' });
      // (item-A / item-B seeded above hold tokens this server cannot decrypt — the sync skips them, as for a dead item)
      const ps = await J('POST', '/api/plaid/sync', {});
      t = (await rows()).filter(r => r.table_name === 'integrations');
      eq('Plaid (business): link → CONNECTED naming the bank; sync that added 1 line → one INTEGRATION_SYNC with the counts',
        [ps.added, t.map(r => [r.action, r.new_data && (r.new_data.account || r.new_data.added)])], [1, [['INTEGRATION_CONNECTED', 'Scotiabank'], ['INTEGRATION_SYNC', 1]]], [1, []]);
      await since();
      const ps2 = await J('POST', '/api/plaid/sync', {});
      eq('a re-sync that changed nothing writes no row', [ps2.added, (await rows()).length], [0, 0], [0, 1]);

      await since();
      await J('POST', '/api/plaid/exchange', { public_token: 'public-pers', scope: 'personal' });
      const pps = await J('POST', '/api/plaid/sync?scope=personal', { scope: 'personal' });
      const bizRows = (await c.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE id > $1 AND user_id = $2`, [mark, uid])).rows[0].n;
      eq('Plaid (PERSONAL): link + a sync that added 1 personal line → nothing on the business trail (wall)', [pps.added, bizRows], [1, 0], [1, 2]);

      await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
        [uid, ent.id, { key: 'belvo_conn', value: JSON.stringify({ links: [{ link: 'link-1', institution: 'Banco Ejemplo' }] }) }]);
      await since();
      const bs = await J('POST', '/api/belvo/sync', {});
      t = (await rows()).filter(r => r.table_name === 'integrations');
      eq('Belvo (business): sync that added 2 lines → one INTEGRATION_SYNC with added 2', [bs.added, t.map(r => [r.action, r.new_data && r.new_data.provider, r.new_data && r.new_data.added])], [2, [['INTEGRATION_SYNC', 'belvo', 2]]], [2, []]);
      await since();
      await J('POST', '/api/belvo/disconnect', {});
      t = (await rows()).filter(r => r.table_name === 'integrations');
      eq('Belvo disconnect → DISCONNECTED naming the bank', t.map(r => [r.action, r.old_data && r.old_data.account]), [['INTEGRATION_DISCONNECTED', 'Banco Ejemplo']], []);
    } finally { globalThis.fetch = realFetch; }

    // ── never a credential ──
    const dump = JSON.stringify((await c.query(`SELECT old_data, new_data FROM audit_trail WHERE user_id = $1`, [uid])).rows);
    eq('no API key, token, consumer key / secret anywhere in the trail', ['SECRET-1', 'SECRET-2', 'SECRET-3', 'SECRET4', 'SECRET5', 'SECRET-6', 'SECRET-7', 'SECRET-8', 'SECRET-9', 'SECRET-10', 'SECRET-11'].filter(x => dump.includes(x)), []);

    // ── the Audit page can filter them ──
    const tableOpts = await (async () => { const html = await (await fetch(server.baseUrl + '/app')).text(); return html; })();
    eq('Audit filter has an "Integrations" option', /value="integrations"/.test(tableOpts) || /value="[^"]*\bintegrations\b[^"]*"/.test(tableOpts), true, false);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
