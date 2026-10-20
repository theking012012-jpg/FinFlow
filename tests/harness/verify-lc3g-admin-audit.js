'use strict';
/**
 * verify-lc3g-admin-audit.js — LC3g (owner decision 2026-10-20: "industry standard, but better").
 *
 * Before: admin_log held (action, target_type, target_id, notes, created_at) — no IP, no browser, no before / after,
 * no way to tell one admin session from another — and it was an ordinary table (rows could be edited or deleted).
 * 7 of 17 admin actions wrote nothing at all: a successful admin login, logout, the "preferred partner" toggle (both
 * routes), dismissing / resolving a report, resolving a flagged transaction, a support reply / status change, and the
 * anomaly-alert send. Nothing told a CUSTOMER that an admin had changed their account.
 *
 * Standard (OWASP logging / SOC 2 CC7.2): every privileged action recorded with who / what / when / where / outcome,
 * before and after, logins incl. failures, the log append-only. Better: the customer's OWN audit trail shows the admin
 * change to their account (suspend, plan, delete), marked as made by FinFlow support.
 *
 * Real scratch Postgres, real server, real admin + user sessions, real routes. Each check names the field that changed
 * and both values (bug: no row, or a row with no IP / before / after).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lc3g-admin-audit.js
 */
require('./clock.js');
process.env.ADMIN_PASSWORD = 'harness-admin-password-not-a-secret';
delete process.env.ADMIN_TOTP_SECRET;
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let scratch, server;
  console.log('\nLC3g — every admin action is on an append-only, attributed admin log\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    try { const { runMigrations, pool } = require('../../database.js'); await runMigrations(pool); } catch (_) {}
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'lc3g-user@finflow.test', role: 'owner', plan: 'trial', trial_ends: '2026-12-31', password: bcrypt.hashSync('pw-not-a-secret', 10) }])).rows[0].id;
    const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code, status) VALUES ('lc3g-acc@finflow.test','x','Ada','Ledger','LC3GREF','pending') RETURNING id`)).rows[0].id;
    const rep1 = (await c.query(`INSERT INTO accountant_reports (accountant_id, reporter_id, reason) VALUES ($1,$2,'late replies') RETURNING id`, [acc, uid])).rows[0].id;
    const rep2 = (await c.query(`INSERT INTO accountant_reports (accountant_id, reporter_id, reason) VALUES ($1,$2,'wrong advice') RETURNING id`, [acc, uid])).rows[0].id;
    const flag = (await c.query(`INSERT INTO flagged_transactions (accountant_id, user_id, txn_type, txn_ref, note) VALUES ($1,$2,'expense','42','check this') RETURNING id`, [acc, uid])).rows[0].id;
    const earn = (await c.query(`INSERT INTO accountant_earnings (accountant_id, type, amount_cents, status) VALUES ($1,'referral',5000,'pending') RETURNING id`, [acc])).rows[0].id;
    const sup = (await c.query(`INSERT INTO support_requests (user_id, entity_id, data) VALUES ($1, NULL, $2) RETURNING id`, [uid, { email: 'lc3g-user@finflow.test', subject: 'Help', message: 'How do I export?', status: 'open' }])).rows[0].id;

    const admin = new HarnessHttp(server.baseUrl, { xff: '198.51.100.7' });
    const A = async (m, p, b) => { const r = await admin.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
    const log = async action => (await c.query(`SELECT * FROM admin_log WHERE action = $1 ORDER BY id DESC LIMIT 1`, [action])).rows[0] || null;
    const shape = r => r ? [!!r.ip, !!r.session_ref, r.outcome || null] : null;

    // ── sign-in ──
    eq('a wrong admin password is refused', (await admin.post('/api/admin/login', { password: 'nope' })).status, 401);
    eq('…and logged with the IP it came from', (await log('failed_login') || {}).ip || null, '198.51.100.7', null);
    eq('admin sign-in succeeds', (await admin.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status, 200);
    const li = await log('admin_login');
    eq('a successful admin sign-in is logged (IP, session, outcome)', shape(li), [true, true, 'ok'], null);

    // ── accountants ──
    await A('POST', '/api/admin/accountants/' + acc + '/verify', { action: 'approve', notes: 'docs ok', confirmedCredentials: 'CPA #123' });
    let r = await log('accountant_approve');
    eq('approve accountant: status pending → verified, by this session', r ? [r.before_data && r.before_data.status, r.after_data && r.after_data.status, !!r.ip, !!r.session_ref] : null, ['pending', 'verified', true, true], null);
    await A('POST', '/api/admin/accountants/' + acc + '/preferred', {});
    r = await log('accountant_preferred_partner');
    eq('preferred-partner toggle: false → true', r ? [r.before_data && r.before_data.preferred_partner, r.after_data && r.after_data.preferred_partner] : null, [false, true], null);
    await A('POST', '/api/admin/accountants/' + acc + '/preferred-partner', {});
    r = await log('accountant_preferred_partner');
    eq('preferred-partner (second route): true → false', r ? [r.before_data && r.before_data.preferred_partner, r.after_data && r.after_data.preferred_partner] : null, [true, false], null);

    // ── customer account ──
    await A('POST', '/api/admin/users/' + uid + '/plan', { plan: 'business' });
    r = await log('user_plan_override');
    eq('plan override: trial → business', r ? [r.before_data && r.before_data.plan, r.after_data && r.after_data.plan] : null, ['trial', 'business'], null);
    await A('POST', '/api/admin/users/' + uid + '/suspend', { suspend: true });
    r = await log('user_suspend');
    eq('suspend: suspended false → true', r ? [r.before_data && r.before_data.suspended, r.after_data && r.after_data.suspended] : null, [false, true], null);
    await A('POST', '/api/admin/users/' + uid + '/unsuspend', {});
    r = await log('user_unsuspend');
    eq('unsuspend: suspended true → false', r ? [r.before_data && r.before_data.suspended, r.after_data && r.after_data.suspended] : null, [true, false], null);

    // the customer's own trail
    const ut = (await c.query(`SELECT action, actor_type, table_name, old_data, new_data FROM audit_trail WHERE user_id = $1 AND actor_type = 'admin' ORDER BY id`, [uid])).rows;
    eq("the customer's own audit trail shows the admin changes (plan, suspend, unsuspend)", ut.map(x => [x.table_name, x.action, x.old_data && (x.old_data.plan ?? x.old_data.suspended), x.new_data && (x.new_data.plan ?? x.new_data.suspended)]),
      [['users', 'UPDATE', 'trial', 'business'], ['users', 'UPDATE', false, true], ['users', 'UPDATE', true, false]], []);
    const user = new HarnessHttp(server.baseUrl, { xff: '203.0.113.9' });
    await user.post('/api/auth/login', { email: 'lc3g-user@finflow.test', password: 'pw-not-a-secret' });
    const mine = ((await user.request('GET', '/api/audit-log?type=users&limit=50')).json || {});
    const mineRows = (Array.isArray(mine) ? mine : mine.rows || []).filter(x => x.actor_type === 'admin');
    eq('…and the customer can see them on their Audit page (served by /api/audit-log)', mineRows.length, 3, 0);

    // ── moderation ──
    await A('POST', '/api/admin/reports/' + rep1 + '/dismiss', { note: 'no evidence' });
    r = await log('report_dismiss');
    eq('dismiss report: open → dismissed, with the note', r ? [r.target_id, r.before_data && r.before_data.status, r.after_data && r.after_data.status, r.after_data && r.after_data.resolution] : null, [rep1, 'open', 'dismissed', 'no evidence'], null);
    await A('POST', '/api/admin/reports/' + rep2 + '/resolve', { note: 'warned' });
    r = await log('report_resolve');
    eq('resolve report: open → resolved', r ? [r.target_id, r.before_data && r.before_data.status, r.after_data && r.after_data.status] : null, [rep2, 'open', 'resolved'], null);
    await A('POST', '/api/admin/flags/' + flag + '/resolve', {});
    r = await log('flag_resolve');
    eq('resolve flagged transaction: open → resolved', r ? [r.target_id, r.before_data && r.before_data.status, r.after_data && r.after_data.status] : null, [flag, 'open', 'resolved'], null);

    // ── money / platform ──
    await A('POST', '/api/admin/earnings/mark-paid', { ids: [earn] });
    r = await log('earnings_mark_paid');
    eq('mark payout paid: pending → paid, with the amount', r ? [r.before_data && r.before_data[0] && [r.before_data[0].id, r.before_data[0].status, r.before_data[0].amount_cents], !!r.ip] : null, [[earn, 'pending', 5000], true], null);
    await A('POST', '/api/admin/operating-costs', { operating: [{ label: 'Hosting', monthly: 40 }] });
    await A('POST', '/api/admin/operating-costs', { operating: [{ label: 'Hosting', monthly: 55 }] });
    r = await log('operating_costs_update');
    eq('operating costs: Hosting 40 → 55', r ? [r.before_data && r.before_data[0] && r.before_data[0].monthly, r.after_data && r.after_data[0] && r.after_data[0].monthly] : null, [40, 55], null);
    await A('POST', '/api/admin/broadcast', { audience: 'trial_users', subject: 'Maintenance', message: 'Tonight' });
    r = await log('broadcast');
    eq('broadcast: audience, subject and the true sent count', r ? [r.after_data && r.after_data.audience, r.after_data && r.after_data.subject, r.after_data && r.after_data.sent, !!r.ip] : null, ['trial_users', 'Maintenance', 0, true], null);
    await A('POST', '/api/admin/support/' + sup, { status: 'resolved', response: 'Settings → Export' });
    r = await log('support_update');
    eq('support ticket: open → resolved, with the reply', r ? [r.target_id, r.before_data && r.before_data.status, r.after_data && r.after_data.status, r.after_data && r.after_data.response] : null, [sup, 'open', 'resolved', 'Settings → Export'], null);
    await A('POST', '/api/admin/audit-anomalies/notify', {});
    r = await log('audit_anomalies_notify');
    eq('anomaly-alert send is logged with its result', r ? [!!r.after_data, !!r.ip] : null, [true, true], null);

    // ── delete ──
    await A('DELETE', '/api/admin/users/' + uid);
    r = await log('user_delete');
    eq('delete user: the email it had, and deleted → true', r ? [r.before_data && r.before_data.email, r.after_data && r.after_data.deleted] : null, ['lc3g-user@finflow.test', true], null);
    const ud = (await c.query(`SELECT new_data FROM audit_trail WHERE user_id = $1 AND actor_type = 'admin' ORDER BY id DESC LIMIT 1`, [uid])).rows[0];
    eq("…and the deletion is on the customer's own trail", ud && ud.new_data && ud.new_data.deleted, true, null);

    // ── sign-out ──
    await A('POST', '/api/admin/logout', {});
    eq('admin sign-out is logged', shape(await log('admin_logout')), [true, true, 'ok'], null);

    // ── append-only ──
    const upd = await c.query(`UPDATE admin_log SET notes = 'tampered' WHERE action = 'user_delete'`).then(() => 'allowed', e => /append-only/.test(e.message) ? 'refused' : e.message);
    eq('admin_log rows cannot be edited', upd, 'refused', 'allowed');
    const del = await c.query(`DELETE FROM admin_log WHERE action = 'admin_login'`).then(() => 'allowed', e => /append-only/.test(e.message) ? 'refused' : e.message);
    eq('admin_log rows cannot be deleted', del, 'refused', 'allowed');
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
