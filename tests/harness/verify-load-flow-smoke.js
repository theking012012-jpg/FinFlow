#!/usr/bin/env node
'use strict';
/**
 * verify-load-flow-smoke.js — proves the capacity test's tools work, on a scratch database (load test #3, 2026-11-13).
 * It is NOT a capacity measurement: one local process on a scratch Postgres says nothing about Railway + Supabase limits.
 *
 * 1. tests/load/seed-load-users.js seeds 20 accounts into the scratch database (its STAGING_CONFIRM guard satisfied).
 * 2. 20 "users" run the EXACT request sequence of tests/load/k6-finflow.js at once, 3 loops each (sign in once, the six
 *    dashboard reads, a report, and every 3rd loop: create an invoice → record a 100 payment → add an expense).
 * EXPECTED: every seeded account signs in; 0 failed requests; every write stored exactly once — 20 × 1 write loop =
 * 20 new invoices of 250 each with a 100 payment, 20 expenses of 42 (hand count). Local timings are printed for information only.
 */
require('./clock.js');
const path = require('path');
const { execFileSync } = require('child_process');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const USERS = 20, LOOPS = 3;

(async () => {
  let scratch, server;
  try {
    scratch = await startScratchPostgres({ keep: false });
    server = await bootServer(scratch.url);
    const c = scratch.client;
    console.log('\n' + '='.repeat(78) + '\n  Capacity-test tools — seed + the k6 request flow, 20 users at once (scratch DB, not a capacity number)\n' + '='.repeat(78) + '\n');
    const out = execFileSync('node', [path.join(__dirname, '..', 'load', 'seed-load-users.js'), String(USERS)],
      { env: { ...process.env, DATABASE_URL: scratch.url, STAGING_CONFIRM: 'yes' }, encoding: 'utf8' });
    A('seed script made 20 accounts', /Done: 20 new/.test(out), out.trim());
    const PW = 'LoadTest-pw-2026!';
    const times = [], failures = [];
    const timed = async (h, m, p, b) => { const t = process.hrtime.bigint(); const r = await h.request(m, p, b); times.push(Number(process.hrtime.bigint() - t) / 1e6);   // hrtime: Date is pinned by clock.js
      if (r.status >= 400) failures.push(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 80)); return r; };
    let signedIn = 0;
    await Promise.all(Array.from({ length: USERS }, async (_, i) => {
      const n = i + 1, h = new HarnessHttp(server.baseUrl, { xff: `192.0.2.${n}` });
      const li = await timed(h, 'POST', '/api/auth/login', { email: `loadtest+${n}@finflow.test`, password: PW });
      if (li.status !== 200) return; signedIn++;
      for (let it = 0; it < LOOPS; it++) {
        await Promise.all(['/api/entities', '/api/settings', '/api/invoices', '/api/expenses', '/api/reports?period=year', '/api/customers'].map(p => timed(h, 'GET', p)));
        await timed(h, 'GET', '/api/reports?period=quarter&monthIdx=6');
        if (it % 3 === 0) {
          const key = `smoke-${n}-${it}`;
          const r = await timed(h, 'POST', '/api/invoices', { client: 'Load Customer ' + n, amount: 250, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-10', idempotency_key: key + '-inv' });
          let inv = {}; try { inv = JSON.parse(r.text); } catch (_) {}
          if (inv.id) await timed(h, 'POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 100, payment_date: '2026-07-12', method: 'bank', idempotency_key: key + '-pay' });
          await timed(h, 'POST', '/api/expenses', { description: 'k6 expense', category: 'Rent', amount: 42, deductible: 'yes', expense_date: '2026-07-11', idempotency_key: key + '-exp' });
        }
      }
    }));
    A('all 20 seeded accounts sign in with the documented password', signedIn === USERS, String(signedIn));
    A('0 failed requests across the whole flow', failures.length === 0, failures.slice(0, 5).join(' | '));
    const inv = (await c.query(`SELECT COUNT(*)::int n FROM invoices WHERE (data->>'amount')::numeric = 250 AND data->>'issue_date' = '2026-07-10' AND user_id IN (SELECT id FROM users WHERE data->>'email' LIKE 'loadtest+%')`)).rows[0].n;
    const pay = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float s FROM invoice_payments WHERE user_id IN (SELECT id FROM users WHERE data->>'email' LIKE 'loadtest+%')`)).rows[0];
    const exp = (await c.query(`SELECT COUNT(*)::int n FROM expenses WHERE data->>'description' = 'k6 expense'`)).rows[0].n;
    A('writes stored exactly once: 20 invoices of 250, 20 payments (Σ 2,000), 20 expenses of 42', inv === 20 && pay.n === 20 && pay.s === 2000 && exp === 20, `invoices ${inv} payments ${pay.n}/${pay.s} expenses ${exp}`);
    times.sort((a, b) => a - b);
    const p = q => times[Math.min(times.length - 1, Math.floor(q * times.length))];
    console.log(`  info  ${times.length} requests · local p50 ${Math.round(p(0.5))} ms · p95 ${Math.round(p(0.95))} ms · max ${Math.round(times[times.length - 1])} ms (scratch DB, one process — NOT a capacity figure)`);
  } catch (e) {
    fail++; console.log('  FATAL: ' + e.message + '\n' + e.stack);
  } finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed` : `  ALL GREEN — ${pass} passed, 0 failed  (load-test flow smoke)`);
  process.exit(fail ? 1 : 0);
})();
