'use strict';
/**
 * verify-lr26-audit-client-ip.js — LR26 (found 2026-10-21 while writing the Cloudflare step; Rule 13 class enumerated).
 *
 * The rate limiters key on the real visitor (_clientIp: CF-Connecting-IP → x-envoy-external-address → leftmost
 * X-Forwarded-For). Every RECORD of who-came-from-where used req.ip instead — which, with `trust proxy: 1`, is the
 * nearest proxy hop (server.js's own comment: on Railway "an intermediate edge address"; behind Cloudflare, a Cloudflare
 * edge). So the security log showed the proxy's address, and the new-device check (same IP + browser) compared proxy
 * addresses — a new visitor behind the same edge was "not new", one visitor across two edges was "new".
 * Class: recordAudit, _isNewDevice, securityAlert (server.js), adminAudit ×3 (admin-routes.js), personal-history.js.
 *
 * Real server + scratch Postgres. Requests carry X-Forwarded-For "<client>, <edge>" exactly as a proxy chain does.
 *   1  sign-in from 198.51.100.7 via edge 10.9.9.9 → LOGIN row ip 198.51.100.7          bug: 10.9.9.9
 *   2  a second sign-in from a DIFFERENT visitor 203.0.113.44 via the SAME edge, same browser → recorded as a NEW
 *      device (SECURITY_ALERT NEW_DEVICE_LOGIN row)                                       bug: no alert (same edge IP)
 *   3  Cloudflare: CF-Connecting-IP 192.0.2.80 (+ a Cloudflare XFF) → LOGIN row ip 192.0.2.80   bug: the edge
 *   4  a personal change → personal_history ip 198.51.100.7                              bug: 10.9.9.9
 *   5  STRUCTURAL (labelled, Rule 5): no audit / security / admin / personal-history writer reads req.ip directly
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let scratch, server;
  console.log('\nLR26 — records carry the visitor\'s IP, not the proxy\'s\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'lr26@finflow.test', name: 'Ip Person', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
    const lastLoginIp = async () => (await c.query(`SELECT ip_address FROM audit_trail WHERE user_id=$1 AND action='LOGIN' ORDER BY id DESC LIMIT 1`, [uid])).rows[0]?.ip_address;
    const alerts = async () => (await c.query(`SELECT COUNT(*)::int n FROM audit_trail WHERE user_id=$1 AND action='SECURITY_ALERT' AND new_data->>'event'='NEW_DEVICE_LOGIN'`, [uid])).rows[0].n;

    const h1 = new HarnessHttp(server.baseUrl, { xff: '198.51.100.7, 10.9.9.9' }); h1.ua = UA;
    if ((await h1.post('/api/auth/login', { email: 'lr26@finflow.test', password: PW })).status !== 200) throw new Error('login 1');
    eq('1  sign-in via edge → LOGIN ip is the visitor 198.51.100.7', await lastLoginIp(), '198.51.100.7', '10.9.9.9');

    const a0 = await alerts();
    const h2 = new HarnessHttp(server.baseUrl, { xff: '203.0.113.44, 10.9.9.9' }); h2.ua = UA;
    if ((await h2.post('/api/auth/login', { email: 'lr26@finflow.test', password: PW })).status !== 200) throw new Error('login 2');
    eq('2  a different visitor behind the same edge → NEW_DEVICE alert recorded', (await alerts()) - a0, 1, 0);

    const h3 = new HarnessHttp(server.baseUrl, { xff: '192.0.2.80, 172.70.1.1', cf: '192.0.2.80' }); h3.ua = UA;
    if ((await h3.post('/api/auth/login', { email: 'lr26@finflow.test', password: PW })).status !== 200) throw new Error('login 3');
    eq('3  behind Cloudflare → LOGIN ip is CF-Connecting-IP 192.0.2.80', await lastLoginIp(), '192.0.2.80', '172.70.1.1');

    await h1.post('/api/personal-transactions', { description: 'LR26 coffee', amount: 3, currency: 'USD', category: 'Food', tx_type: 'expense', tx_date: '2026-07-20' });
    let phIp = null; try { phIp = (await c.query(`SELECT ip_address FROM personal_history WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [uid])).rows[0]?.ip_address; } catch (_) {}
    eq('4  personal history ip is the visitor 198.51.100.7', phIp, '198.51.100.7', '10.9.9.9');

    // 5 STRUCTURAL — the writers take the resolved client IP (req.clientIp), never the proxy hop.
    const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const auditFn = src('server.js').match(/async function recordAudit[\s\S]*?\n}\n/)[0] + src('server.js').match(/async function _isNewDevice[\s\S]*?\n}\n/)[0] + src('server.js').match(/async function securityAlert[\s\S]*?\n}\n/)[0];
    const offenders = [['server.js audit/security writers', auditFn], ['admin-routes.js', src('admin-routes.js')], ['personal-history.js', src('personal-history.js')]]
      .filter(([, s]) => /\breq\??\.ip\b(?!\s*\|\|\s*null\s*\)\s*;?\s*\/\/\s*fallback)/.test(s.replace(/req\.clientIp \|\| req\.ip/g, '')))
      .map(([n]) => n);
    eq('5  STRUCTURAL: no audit / security / admin / personal writer reads req.ip directly', offenders, [], ['server.js audit/security writers', 'admin-routes.js', 'personal-history.js']);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (server) await server.close(); } catch (_) {} try { if (scratch) await scratch.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
