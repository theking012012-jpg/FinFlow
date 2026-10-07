'use strict';
/**
 * verify-egress-ssrf.js — N54. A user-supplied URL fetched by the server (WooCommerce store_url) can
 * only reach public https hosts.
 *
 * Defect: store_url accepted any http(s) host, and sync fetched it server-side with the store's Basic
 * credentials — localhost services, the private network and the cloud metadata endpoint were reachable.
 *
 * Executed against the real server + Postgres. A loopback HTTP listener stands in for an internal
 * service and counts the requests it receives. Discriminating checks (Rule 4), bug value stated:
 *   connect http://127.0.0.1:<listener>                → 400  (bug: 201)
 *   connect https://169.254.169.254 (metadata)         → 400  (bug: 201)
 *   connect https://localhost:<port> (private via DNS) → 400  (bug: 201)
 *   connect https://[::ffff:127.0.0.1], https://10.1.2.3 → 400 (bug: 201)
 *   connect https://mixed.test (DNS: public + 10.0.0.1) → 400 (bug: 201)
 *   sync of a stored internal URL (pre-fix row)         → internal listener hit 0 times (bug: 1, with credentials)
 *   control: https://93.184.215.14 (public literal)     → 201
 *   address classification table (executed): private/reserved → true, public → false
 * NOT executed: the DNS-rebinding property (connect pinned to the checked address) — the offline clock
 * blocks non-loopback sockets before connect; it follows from passing `lookup` to https.request.
 *   node -r ./tests/harness/clock.js tests/harness/verify-egress-ssrf.js
 */
require('./clock.js');
const http = require('http');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const OWNER = { email: 'ssrf@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, internal, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const hits = [];
  const dns = require('dns');
  const realLookup = dns.promises.lookup;
  try {
    internal = http.createServer((req, res) => { hits.push({ url: req.url, auth: req.headers.authorization || null }); res.setHeader('X-WP-Total', '7'); res.end('[]'); });
    await new Promise(r => internal.listen(0, '127.0.0.1', r));
    const P = internal.address().port;
    dns.promises.lookup = async (h, o) => (h === 'mixed.test' ? [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.1', family: 4 }] : realLookup(h, o));

    scratch = await startScratchPostgres({ keep: false }); const c = scratch.client;
    server = await bootServer(scratch.url);
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`,
      [{ email: OWNER.email, plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'SSRF Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl);
    A('login 200', (await h.post('/api/auth/login', OWNER)).status === 200);
    const connect = (store_url) => h.post('/api/woocommerce/connect?entity_id=' + eid, { store_url, consumer_key: 'ck_SECRET', consumer_secret: 'cs_SECRET' });

    console.log('\n' + '='.repeat(78));
    console.log('  USER-SUPPLIED URLS — public https hosts only');
    console.log('='.repeat(78));
    for (const u of ['http://127.0.0.1:' + P, 'https://169.254.169.254', 'https://localhost:' + P, 'https://[::ffff:127.0.0.1]', 'https://10.1.2.3', 'https://mixed.test']) {
      const r = await connect(u);
      A(`connect ${u} → 400 (bug: 201)`, r.status === 400, `status ${r.status}: ${r.text.slice(0, 120)}`);
    }

    // A row saved before the fix (or by any other path) still cannot be fetched.
    await c.query(`DELETE FROM user_settings WHERE user_id=$1 AND data->>'key'='woocommerce_conn'`, [uid]);
    const enc = require('../../server.js')._encTok || ((x) => x);
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1,$2,$3)`, [uid, eid,
      { key: 'woocommerce_conn', value: JSON.stringify({ connected: true, store_url: 'http://127.0.0.1:' + P, consumer_key: enc('ck_SECRET'), consumer_secret: enc('cs_SECRET') }) }]);
    hits.length = 0;
    const sy = await h.post('/api/woocommerce/sync?entity_id=' + eid, {});
    A('sync of a stored internal URL: internal service hit 0 times (bug: 1, carrying the store credentials)', hits.length === 0, JSON.stringify(hits));
    A('  sync reports an error (502), not a count', sy.status === 502, `status ${sy.status}: ${sy.text.slice(0, 120)}`);

    const ok = await connect('https://93.184.215.14');
    A('control: public https address → 201', ok.status === 201, `status ${ok.status}: ${ok.text.slice(0, 120)}`);

    const { isPrivateAddress } = require('../../safe-egress');
    const priv = ['127.0.0.1', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1'.replace('a00:1', '10.0.0.1')];
    const pub = ['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'];
    const wrongP = priv.filter(a => !isPrivateAddress(a)), wrongQ = pub.filter(a => isPrivateAddress(a));
    A('classification: every private/reserved address → private', wrongP.length === 0, 'misclassified: ' + wrongP.join(', '));
    A('classification: public addresses → public', wrongQ.length === 0, 'misclassified: ' + wrongQ.join(', '));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { dns.promises.lookup = realLookup; try { if (internal) internal.close(); } catch {} try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (egress SSRF)` : `  ALL GREEN — ${pass} passed, 0 failed  (egress SSRF)`);
  console.log('-'.repeat(78));
  process.exitCode = fail === 0 ? 0 : 1;
})();
