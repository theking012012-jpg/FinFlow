'use strict';
/**
 * verify-gl-backfill-full-leg.js — Phase 2.1. The structural cure for the multi-writer class is to read the
 * reconciled GL everywhere; reports already read-swap to the ledger WHEN it reconciles to computeBooks (GL 5b).
 * Production's historical rows reach the ledger only through the owner-gated backfill (Rule 8 — the run itself is
 * the owner's). Before that run, prove on the richest dataset we have — fullLegScenario, ONE of every money leg
 * written through the real routes, incl. this run's journal cash legs (L6) and paid_date payroll (L7) — that:
 *   1. the backfill reproduces the live dual-write ledger EXACTLY (entry for entry, line for line, date for date)
 *   2. it is idempotent (a second run posts nothing)
 *   3. the trial balance balances, and GL P&L == computeBooks == the hand-computed EXPECTED (745 / 614 / 131)
 *   4. /api/reports shows the hand-computed figures after the backfill
 * If (1) fails, a historical row would be dated/valued differently from the same row written live — the backfill
 * would silently restate history.
 * FOUND by this harness (fixed in the same commit): the backfill had NO journal step. computeBooks reads the journal
 * P&L FROM the GL (N20), so after a backfill both GL and computeBooks reported revenue 715 / net 113 — they AGREED,
 * /api/reports served source:'gl', and both were wrong vs the hand-computed 745 / 131 (Rule 6).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-backfill-full-leg.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const { postFullLegScenario, EXPECTED } = require('./fullLegScenario.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
const snapRows = async (c, uid) => (await c.query(
  `SELECT le.idempotency_key AS k, le.entry_date::text AS d, le.source_type AS st, le.source_id AS sid, la.code AS code, ll.debit::float AS dr, ll.credit::float AS cr
     FROM ledger_entries le JOIN ledger_lines ll ON ll.entry_id=le.id JOIN ledger_accounts la ON la.id=ll.account_id
    WHERE le.user_id=$1 AND le.reversal_of IS NULL ORDER BY le.idempotency_key, la.code, ll.debit, ll.credit`, [uid])).rows;

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  2.1 — GL backfill on the full-leg dataset: exact, idempotent, reconciled\n' + '='.repeat(78) + '\n');
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'glfl@finflow.test', name: 'GL Full', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', { email: 'glfl@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const { entityId: eid } = await postFullLegScenario({ http, client: c, userId: uid });

    // Seed artefact, not a code path: fullLegScenario re-dates the paid run's paid_date to 2026-06-28 by SQL AFTER
    // mark-paid already posted its GL entry on the day it ran (2026-07-25, pinned). Through the API the two are the
    // same day (mark-paid stamps paid_date = the day it posts), so align the live entry to what a June mark-paid
    // would have posted before comparing.
    await c.query(`UPDATE ledger_entries le SET entry_date = pr.paid_date FROM payroll_runs pr
                    WHERE le.user_id=$1 AND le.source_type='payroll_paid' AND le.source_id=pr.id AND pr.paid_date IS NOT NULL`, [uid]);
    const live = await snapRows(c, uid);
    const legs = [...new Set(live.map(r => r.st))].sort();
    A('live dual-write ledger covers every leg type (premise)', ['bill', 'credit_note', 'expense', 'invoice', 'journal', 'payroll_paid'].every(x => legs.includes(x)), 'source types: ' + legs.join(','));

    await c.query(`DELETE FROM ledger_lines WHERE user_id=$1`, [uid]);
    await c.query(`DELETE FROM ledger_entries WHERE user_id=$1`, [uid]);
    const bf = await http.post('/api/gl/backfill?entity_id=' + eid, {});
    const back = await snapRows(c, uid);
    const key = r => [r.k, r.d, r.code, r.dr, r.cr].join('|');
    const L = new Set(live.map(key)), B = new Set(back.map(key));
    const onlyLive = [...L].filter(x => !B.has(x)), onlyBack = [...B].filter(x => !L.has(x));
    A(`backfill reproduces the live ledger exactly (${live.length} lines)`, bf.status === 200 && onlyLive.length === 0 && onlyBack.length === 0 && live.length === back.length,
      'status=' + bf.status + ' live-only=' + JSON.stringify(onlyLive.slice(0, 6)) + ' backfill-only=' + JSON.stringify(onlyBack.slice(0, 6)));

    const bf2 = await http.post('/api/gl/backfill?entity_id=' + eid, {});
    A('second backfill posts nothing (idempotent)', bf2.status === 200 && bf2.json && bf2.json.posted === 0, 'posted=' + (bf2.json && bf2.json.posted));
    const rec = (bf.json && bf.json.reconciliation || [])[0] || {};
    A('trial balance + balance sheet balance after backfill', rec.trialBalanced === true && rec.balanceSheetBalanced === true, JSON.stringify(rec).slice(0, 240));

    const pnl = (await http.get('/api/gl/pnl?period=year&entity_id=' + eid)).json || {};
    A(`GL P&L after backfill == hand-computed: income ${EXPECTED.revenue} · expenses ${EXPECTED.opex} · net ${EXPECTED.net} (bug: 715 / 602 / 113 — no journals)`,
      near(pnl.income, EXPECTED.revenue) && near(pnl.expenses, EXPECTED.opex) && near(pnl.netProfit, EXPECTED.net), JSON.stringify({ income: pnl.income, expenses: pnl.expenses, net: pnl.netProfit }));
    const rep = (await http.get('/api/reports?period=year&fyStart=0')).json || {};
    A(`/api/reports after backfill: revenue ${EXPECTED.revenue} / net ${EXPECTED.net} (bug: 715 / 113, served as 'gl' because both sides lost the journals)`,
      near(rep.revenue, EXPECTED.revenue) && near(rep.netProfit, EXPECTED.net), JSON.stringify({ source: rep.source, revenue: rep.revenue, netProfit: rep.netProfit }));
    // L34: the GL 5b P&L gate computed opex as 6000 + 6100 only, so a journal expense account (J5100 …) made every
    // journal-using entity "diverge" and the GL never served (bug: source 'computeBooks', gl opex 602 vs 614).
    A(`L34: /api/reports read-swaps to the reconciled GL (source 'gl') with ${EXPECTED.revenue} / ${EXPECTED.opex} / ${EXPECTED.net}`,
      rep.source === 'gl' && near(rep.revenue, EXPECTED.revenue) && near(rep.expenses != null ? rep.expenses : rep.totalExpenses, EXPECTED.opex) && near(rep.netProfit, EXPECTED.net),
      JSON.stringify({ source: rep.source, revenue: rep.revenue, expenses: rep.expenses, totalExpenses: rep.totalExpenses, netProfit: rep.netProfit }));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (GL backfill full-leg)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
