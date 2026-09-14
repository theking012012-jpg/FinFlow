'use strict';
/**
 * verify-connector-token-encryption.js — PROVES (not just audits) that connector credentials are
 * encrypted at rest. Drives the two plain-POST connect routes (no external API roundtrip) through the
 * real server against real Postgres, then reads the stored blob straight out of user_settings and
 * asserts the credential is ciphertext — and that the PLAINTEXT never appears anywhere in the row.
 *
 *   WiPay:       api_key                          → encTok
 *   WooCommerce: consumer_key + consumer_secret   → encTok
 *
 * RED without encryption: the plaintext secret would appear verbatim in the stored blob and the
 * "plaintext absent" assertion fails. (encTok format is iv:tag:ciphertext — includes ':'.)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-connector-token-encryption.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function mkOwner(c, email) {
  const data = { email, password: bcrypt.hashSync(PW, 10), name: 'Owner', role: 'owner', plan: 'trial',
    trial_ends: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
  return (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1) RETURNING id', [data])).rows[0].id;
}
async function blob(c, key) {
  const { rows } = await c.query("SELECT data->>'value' AS value FROM user_settings WHERE data->>'key' = $1 ORDER BY id DESC LIMIT 1", [key]);
  return rows[0] ? rows[0].value : null;   // raw stored JSON string
}
// A credential field is "encrypted at rest" iff it is present, is NOT the plaintext, and looks like
// encTok output (iv:tag:ciphertext, so it contains ':').
const enc = (storedField, plaintext) => !!storedField && storedField !== plaintext && String(storedField).includes(':');

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    await mkOwner(c, 'conn@finflow.test');
    const http = new HarnessHttp(server.baseUrl);

    console.log('\n' + '='.repeat(78));
    console.log('  CONNECTOR TOKEN ENCRYPTION AT REST — real routes, real PG, read the stored blob');
    console.log('='.repeat(78) + '\n');

    A('owner login → 200', (await http.post('/api/auth/login', { email: 'conn@finflow.test', password: PW })).status === 200);

    // ── WiPay ──
    const WIPAY_KEY = 'wipay_PLAINTEXT_secret_ABC123';
    const wr = await http.post('/api/wipay/connect', { account_number: '1234567', api_key: WIPAY_KEY, country: 'TT' });
    A('WiPay connect → 201', wr.status === 201, JSON.stringify(wr.json));
    const wraw = await blob(c, 'wipay_conn');
    A('WiPay: a blob was stored', !!wraw, String(wraw));
    const wv = wraw ? JSON.parse(wraw) : {};
    A('WiPay: api_key stored ENCRYPTED (ciphertext, not plaintext)', enc(wv.api_key, WIPAY_KEY), 'stored=' + wv.api_key);
    A('WiPay: plaintext api_key NOT present anywhere in the stored row', !!wraw && !wraw.includes(WIPAY_KEY));

    // ── WooCommerce ──
    const CK = 'ck_PLAINTEXT_consumer_key_XYZ', CS = 'cs_PLAINTEXT_consumer_secret_XYZ';
    const or = await http.post('/api/woocommerce/connect', { store_url: 'https://shop.example.com', consumer_key: CK, consumer_secret: CS });
    A('WooCommerce connect → 201', or.status === 201, JSON.stringify(or.json));
    const oraw = await blob(c, 'woocommerce_conn');
    A('WooCommerce: a blob was stored', !!oraw);
    const ov = oraw ? JSON.parse(oraw) : {};
    A('WooCommerce: consumer_key stored ENCRYPTED', enc(ov.consumer_key, CK), 'stored=' + ov.consumer_key);
    A('WooCommerce: consumer_secret stored ENCRYPTED', enc(ov.consumer_secret, CS), 'stored=' + ov.consumer_secret);
    A('WooCommerce: neither plaintext present in the stored row', !!oraw && !oraw.includes(CK) && !oraw.includes(CS));
    A('WooCommerce: store_url kept in clear (not a secret)', ov.store_url === 'https://shop.example.com');

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? `  ${pass} passed, ${fail} FAILED` : `  ALL GREEN - ${pass} passed, 0 failed  (connector token encryption at rest)`);
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
