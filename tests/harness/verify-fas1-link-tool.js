#!/usr/bin/env node
'use strict';
/**
 * verify-fas1-link-tool.js — the FA-S1 owner tool tools/launch/link-stripe-subscriptions.js, run as the owner would
 * (a child process) against a scratch Postgres with the real schema; the Stripe API is a stand-in (fas1-stripe-stub).
 * Seed — each case changes the outcome (Rule 4):
 *   A  a@  no subscription stored      ← sub_a (no metadata, customer a@)        → LINKED by e-mail
 *   B  b@  already has sub_old         ← sub_b (metadata userId = B)             → NOT touched (never overwritten)
 *          nobody@                     ← sub_none                                → UNMATCHED, listed
 *   B's sub_old in Stripe too          ← sub_old                                 → already linked, skipped
 * Dry run: "to link: 1" and the database unchanged. --apply --expect 2: refused, unchanged. --apply --expect 1: A linked,
 * one audit row, the Stripe subscription tagged with A's user id. A second dry run: "to link: 0".
 */
require('./clock.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  console.log('\n' + '='.repeat(78) + '\n  FA-S1 owner tool — link existing Stripe subscriptions\n' + '='.repeat(78) + '\n');
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const log = path.join(os.tmpdir(), 'fas1-stub-' + process.pid + '.log');
  try {
    await initSchema(scratch.url);
    const ins = async d => (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [d])).rows[0].id;
    const a = await ins({ email: 'a@finflow.test', plan: 'business' });
    const b = await ins({ email: 'b@finflow.test', plan: 'pro', stripe_subscription_id: 'sub_old' });
    // (two accounts sharing an e-mail cannot exist — idx_users_email_ci_uniq — so the tool's 'ambiguous' guard is defensive)
    const subs = [
      { id: 'sub_a', status: 'active', metadata: {}, customer: { id: 'cus_a', email: 'A@finflow.test' } },
      { id: 'sub_b', status: 'active', metadata: { userId: String(b) }, customer: { id: 'cus_b', email: 'b@finflow.test' } },
      { id: 'sub_none', status: 'canceled', metadata: {}, customer: { id: 'cus_none', email: 'nobody@finflow.test' } },
      { id: 'sub_old', status: 'active', metadata: {}, customer: { id: 'cus_b', email: 'b@finflow.test' } },
    ];
    const env = Object.assign({}, process.env, { DATABASE_URL: scratch.url, STRIPE_SECRET_KEY: 'sk_test_stub', LINK_TOOL_STRIPE_STUB: path.join(__dirname, 'fas1-stripe-stub.js'), FAS1_STUB_SUBS: JSON.stringify(subs), FAS1_STUB_LOG: log });
    const tool = path.join(__dirname, '..', '..', 'tools', 'launch', 'link-stripe-subscriptions.js');
    const runTool = (...args) => { try { return { code: 0, out: execFileSync(process.execPath, [tool, ...args], { env, encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
    const state = async () => (await c.query(`SELECT id, data->>'stripe_subscription_id' AS sub FROM users ORDER BY id`)).rows.map(r => r.sub);

    const before = await state();
    const dry = runTool();
    A('1  dry run: to link 1 (A by e-mail, any case); B never overwritten; nobody listed as unmatched', dry.code === 0 && /to link: 1/.test(dry.out) && /user \d+ <a@finflow\.test>\s+←\s+sub_a/.test(dry.out) && /no matching account: 1/.test(dry.out), dry.out.slice(0, 600));
    A('1b dry run changed nothing', JSON.stringify(await state()) === JSON.stringify(before), JSON.stringify(await state()));
    const bad = runTool('--apply', '--expect', '2');
    A('2  --apply with the wrong --expect is refused and changes nothing', bad.code === 3 && JSON.stringify(await state()) === JSON.stringify(before), bad.code + ' ' + bad.out.slice(-200));
    const ok = runTool('--apply', '--expect', '1');
    const after = (await c.query(`SELECT data FROM users WHERE id = $1`, [a])).rows[0].data;
    const bAfter = (await c.query(`SELECT data->>'stripe_subscription_id' AS s FROM users WHERE id = $1`, [b])).rows[0].s;
    A('3  apply: A linked (sub_a, cus_a, status); B still sub_old', ok.code === 0 && after.stripe_subscription_id === 'sub_a' && after.stripe_customer_id === 'cus_a' && after.subscriptionStatus === 'active' && bAfter === 'sub_old', ok.out.slice(-300) + ' ' + JSON.stringify(after));
    const aud = (await c.query(`SELECT count(*)::int AS n FROM audit_trail WHERE user_id = $1 AND table_name = 'users' AND actor_type = 'system'`, [a])).rows[0].n;
    A('3b one audit row for the link', aud === 1, 'rows ' + aud);
    const tags = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
    A('3c the Stripe subscription is tagged with A\'s user id (only on apply)', tags.length === 1 && tags[0].id === 'sub_a' && tags[0].body.metadata.userId === String(a), JSON.stringify(tags));
    const again = runTool();
    A('4  re-running finds nothing more to link', /to link: 0/.test(again.out), again.out.slice(0, 200));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    try { fs.unlinkSync(log); } catch (_) {}
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-S1 link tool)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
