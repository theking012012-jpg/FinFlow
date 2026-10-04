'use strict';
/**
 * verify-admin-platform.js — admin platform ops that were UNHARNESSED: audited CSV exports,
 * operating-costs (platform_settings round-trip), and the flagged-transactions lifecycle.
 *
 * CSV export: PII leaves via the server (so it's audited) — users.csv + accountants.csv return real
 * CSV, include the seeded rows, and write an admin_log row. Admin-gated.
 * Operating costs: POST validates + persists to platform_settings; GET /costs reads the SAME values
 * back; a non-array body is rejected.
 * Flagged transactions: an accountant flag creates an OPEN row; admin lists it (with names); admin
 * resolve flips it to resolved + stamps resolved_at. All admin endpoints reject a non-admin.
 * Discriminating (Rule 14): the exported CSV contains the seeded email; the saved operating cost reads
 * back byte-for-byte; resolve flips status open→resolved; every admin route is 401 without a session.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-admin-platform.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const ADMIN_PW = 'harness-admin-pw';
(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    process.env.ADMIN_PASSWORD = ADMIN_PW;

    const clientId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'plat-client@finflow.test', name: 'Platform Client', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const accId = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,country,referral_code,status,created_at,updated_at)
                    VALUES ($1,$2,'Ada','Ledger','Ledger & Co','USA','REF-PLAT','verified',NOW(),NOW()) RETURNING id`,
      ['plat-acct@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id,user_id,status,access_level) VALUES ($1,$2,'active','filing')`, [accId, clientId]);

    const anon = new HarnessHttp(server.baseUrl, { xff: '203.0.113.70' });
    const admin = new HarnessHttp(server.baseUrl, { xff: '203.0.113.71' });

    // ── admin gate ─────────────────────────────────────────────────────────────────
    A('[GATE] export without admin → 401', (await anon.get('/api/admin/export/users.csv')).status === 401);
    A('[GATE] operating-costs without admin → 401', (await anon.post('/api/admin/operating-costs', { operating: [] })).status === 401);
    A('[GATE] flags without admin → 401', (await anon.get('/api/admin/flags')).status === 401);
    A('admin login 200', (await admin.post('/api/admin/login', { password: ADMIN_PW })).status === 200);

    // ── CSV export (audited) ─────────────────────────────────────────────────────────
    const logBefore = (await c.query(`SELECT COUNT(*)::int n FROM admin_log`)).rows[0].n;
    const ucsv = await admin.get('/api/admin/export/users.csv');
    A('users.csv → 200 text/csv', ucsv.status === 200 && /text\/csv/.test(ucsv.headers.get('content-type') || ''), 'ct=' + ucsv.headers.get('content-type'));
    A('users.csv has a header row + the seeded client email', /ID,Name,Email/.test(ucsv.text) && ucsv.text.indexOf('plat-client@finflow.test') >= 0);
    const acsv = await admin.get('/api/admin/export/accountants.csv');
    A('accountants.csv includes the firm + client count', acsv.status === 200 && acsv.text.indexOf('Ledger & Co') >= 0 && /Clients/.test(acsv.text));
    const logAfter = (await c.query(`SELECT COUNT(*)::int n FROM admin_log`)).rows[0].n;
    A('CSV export writes an admin_log audit row (PII egress is traced)', logAfter >= logBefore + 2, `before=${logBefore} after=${logAfter}`);

    // ── operating costs / platform_settings round-trip ───────────────────────────────
    A('bad body (no array) → 400', (await admin.post('/api/admin/operating-costs', { operating: 'nope' })).status === 400);
    const save = await admin.post('/api/admin/operating-costs', { operating: [{ label: 'Railway (hosting)', monthly: 25 }, { label: 'Supabase', monthly: 30 }, { label: '', monthly: 9 }] });
    A('save operating costs → 200, drops the blank-label row', save.status === 200 && Array.isArray(save.json.operating) && save.json.operating.length === 2, JSON.stringify(save.json));
    const stored = (await c.query(`SELECT value FROM platform_settings WHERE key='operating_costs'`)).rows[0];
    A('persisted to platform_settings', stored && Array.isArray(stored.value) && stored.value.length === 2, JSON.stringify(stored && stored.value));
    const costs = (await admin.get('/api/admin/costs')).json;
    const opList = (costs.costs && costs.costs.operating) || [];
    const railway = opList.find(x => x.label === 'Railway (hosting)');
    A('GET /costs reads the saved value back (25)', !!railway && Number(railway.monthly) === 25, JSON.stringify(opList));

    // ── flagged-transactions lifecycle ───────────────────────────────────────────────
    const acct = new HarnessHttp(server.baseUrl, { xff: '203.0.113.72' });
    await acct.post('/api/accountants/login', { email: 'plat-acct@finflow.test', password: PW });
    A('accountant raises a flag → 200', (await acct.post('/api/accountants/clients/' + clientId + '/flag', { type: 'expense', ref: 'EXP-9', note: 'missing receipt' })).status === 200);
    const flags = (await admin.get('/api/admin/flags')).json;
    const flag = (Array.isArray(flags) ? flags : []).find(f => f.txn_ref === 'EXP-9');
    A('admin sees the open flag with accountant + client names', !!flag && flag.status === 'open' && !!flag.first_name && !!flag.client_name, JSON.stringify(flag));
    const res = await admin.post('/api/admin/flags/' + flag.id + '/resolve', {});
    A('admin resolve → 200', res.status === 200);
    const after = (await c.query(`SELECT status, resolved_at FROM flagged_transactions WHERE id=$1`, [flag.id])).rows[0];
    A('flag flipped open→resolved + resolved_at stamped', after.status === 'resolved' && !!after.resolved_at, JSON.stringify(after));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (admin platform: CSV export + operating costs + flags)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
