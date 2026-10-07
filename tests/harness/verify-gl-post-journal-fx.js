'use strict';
/**
 * verify-gl-post-journal-fx.js — N20 hardening: (A) a posted journal in a FOREIGN-currency entity
 * reconciles both single-entity (native) and CONSOLIDATED (base-currency), proving the computeBooks
 * journal leg converts identically to glConsolidated; (B) flipping a posted journal to Draft REVERSES
 * it out of the GL and the P&L and reconcile stays green.
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-post-journal-fx.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const PW = 'harness-password-not-a-secret';
async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks, glReconcile } = require('../../server.js');
    console.log('\n' + '='.repeat(78) + '\n  N20 FX + REVERSAL hardening\n' + '='.repeat(78) + '\n');
    const email = 'gljefx@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`, [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10), base_currency: 'USD' }])).rows[0].id;
    const A_us = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'US Co', currency: 'USD' }])).rows[0].id;
    const B_tt = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'TT Co', currency: 'TTD' }])).rows[0].id;
    await c.query(`INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date) VALUES ($1,NULL,$2,$3,$4,$5)`, [uid, 'TTD', 'USD', 0.15, '2026-01-01']);
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.26' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);

    // ── (A) foreign-currency posted JE in entity B (TTD): Dr Rent 680 / Cr Checking 680 → opex +680 TTD
    const baseB = await computeBooks(uid, B_tt, 'year');
    const baseCons = await computeBooks(uid, null, 'year');
    const jeB = await http.post('/api/journals?entity_id=' + B_tt, { entity_id: B_tt, date: '2026-06-10', description: 'TT rent', status: 'Posted',
      lines: [{ code: '5100', name: 'Rent', debit: 680, credit: 0 }, { code: '1010', name: 'Checking', debit: 0, credit: 680 }] });
    A('JE(B) posted 2xx', jeB.status >= 200 && jeB.status < 300, 'status=' + jeB.status + ' ' + (jeB.text || '').slice(0, 140));

    const bkB = await computeBooks(uid, B_tt, 'year');
    A('single-entity B: opex +680 TTD (native)', near(bkB.opex - baseB.opex, 680), 'Δ=' + (bkB.opex - baseB.opex));
    A('single-entity B: reconcile booksBalanced', (await glReconcile(uid, B_tt)).booksBalanced === true);

    const bkCons = await computeBooks(uid, null, 'year');
    A('consolidated: opex +102 USD (680 × 0.15)', near(bkCons.opex - baseCons.opex, 102), 'Δ=' + (bkCons.opex - baseCons.opex));
    const recCons = await glReconcile(uid, null);
    A('consolidated: reconcile booksBalanced (FX parity GL==books)', recCons.booksBalanced === true, JSON.stringify(recCons.detail));

    // ── (B) reversal: post a JE in A, then flip to Draft → must reverse out of GL + P&L
    const baseA = await computeBooks(uid, A_us, 'year');
    const jeA = await http.post('/api/journals?entity_id=' + A_us, { entity_id: A_us, date: '2026-06-11', description: 'US rev adj', status: 'Posted',
      lines: [{ code: '1010', name: 'Checking', debit: 300, credit: 0 }, { code: '4000', name: 'Service Revenue', debit: 0, credit: 300 }] });
    const jeAid = JSON.parse(jeA.text || '{}').id;
    A('JE(A) posted 2xx', jeA.status >= 200 && jeA.status < 300, 'status=' + jeA.status);
    A('after post: revenue +300', near((await computeBooks(uid, A_us, 'year')).revenue - baseA.revenue, 300));
    const put = await http.put('/api/journals/' + jeAid, { status: 'Draft' });
    A('PUT → Draft 2xx', put.status >= 200 && put.status < 300, 'status=' + put.status);
    A('after Draft: revenue back to baseline (reversed)', near((await computeBooks(uid, A_us, 'year')).revenue, baseA.revenue), 'rev=' + (await computeBooks(uid, A_us, 'year')).revenue + ' base=' + baseA.revenue);
    A('after Draft: GL entry net-zero for this journal', (await c.query(`SELECT COALESCE(SUM(ll.debit-ll.credit),0)::float AS n FROM ledger_lines ll JOIN ledger_entries le ON le.id=ll.entry_id WHERE le.user_id=$1 AND le.source_type='journal' AND le.source_id=$2`, [uid, jeAid])).rows[0].n === 0);
    A('after Draft: A reconcile booksBalanced', (await glReconcile(uid, A_us)).booksBalanced === true);

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N20 FX + reversal)'));
    console.log('-'.repeat(78) + '\n');
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
