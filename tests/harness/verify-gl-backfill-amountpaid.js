#!/usr/bin/env node
'use strict';
/**
 * verify-gl-backfill-amountpaid.js — REGRESSION: the backfill must settle amount_paid that has NO
 * corresponding payment row, or the ledger AR/AP diverges from computeBooks and the balance sheet
 * never serves real cash.
 *
 * The prod bug (2026-09-26): Saige's historical invoices were marked paid via amount_paid (pre-F133)
 * with few/no invoice_payments rows; bills likewise (pre-F135). computeBooks treats amount_paid as
 * collected (low AR / AP), but the backfill only settled AR/AP via payment rows → glAR 37,550 vs
 * oracle 12,550, glAP 1,000 vs oracle 0 → balance sheet stuck on the AR-only fallback despite the
 * P&L reconciling. Fix: settle the uncovered amount_paid (invoice_paidgap / bill_paidgap legs).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-backfill-amountpaid.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks, glReconcile, glBalanceSheet, backfillLedgerForUser } = require('../../server.js');

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'ap-gap@finflow.test', name: 'AP', plan: 'business', role: 'owner', base_currency: 'USD', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Co', currency: 'USD' }])).rows[0].id;

    // Invoice A: fully paid via amount_paid, NO invoice_payments row (historical pre-F133).
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-06-01T09:00:00Z',NOW())`,
      [uid, eid, { client: 'PaidHist', amount: 10000, amount_paid: 10000, status: 'paid', issue_date: '2026-06-01' }]);
    // Invoice B: outstanding (no payment).
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-06-05T09:00:00Z',NOW())`,
      [uid, eid, { client: 'Open', amount: 2000, amount_paid: 0, status: 'pending', issue_date: '2026-06-05' }]);
    // Bill: fully paid via amount_paid, NO payments_made row (historical pre-F135).
    await c.query(`INSERT INTO bills (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-06-03T09:00:00Z',NOW())`,
      [uid, eid, { vendor: 'PaidVendor', amount: 800, amount_paid: 800, status: 'paid', issue_date: '2026-06-03' }]);

    const books = await computeBooks(uid, eid, 'year');
    A('oracle AR = 2,000 (only the open invoice; the paid one is collected)', near(books.outstanding, 2000), 'AR=' + books.outstanding);

    await backfillLedgerForUser(uid, { entityId: eid });

    // Ledger AR / AP must now equal the oracle (the paid amounts were settled).
    const { rows: acc } = await c.query(
      `SELECT la.code, COALESCE(SUM(ll.debit-ll.credit),0)::float AS net FROM ledger_lines ll JOIN ledger_accounts la ON la.id=ll.account_id WHERE ll.user_id=$1 AND ll.entity_id=$2 GROUP BY la.code`, [uid, eid]);
    const bal = {}; acc.forEach(r => bal[r.code] = Math.round(r.net * 100) / 100);
    A('GL AR (1100) settled to 2,000 (paid invoice cleared, open invoice remains)', near(bal['1100'], 2000), 'glAR=' + bal['1100']);
    A('GL AP (2000) settled to 0 (paid bill cleared)', near(-(bal['2000'] || 0), 0), 'glAP=' + (-(bal['2000'] || 0)));

    const rec = await glReconcile(uid, eid);
    A('glReconcile: books balanced AND reconciled to reports', rec.booksBalanced === true && rec.reconciledToReports === true, JSON.stringify({ bal: rec.booksBalanced, rec: rec.reconciledToReports }));

    const bs = await glBalanceSheet(uid, eid);
    A('balance sheet now serves the LEDGER with real tracked cash', bs.source === 'gl' && bs.cashTracked === true, JSON.stringify({ src: bs.source, cash: bs.cash }));
    A('balance sheet AR = 2,000 and it balances', near(bs.accountsReceivable, 2000) && near(bs.totalAssets, bs.totalLiabilities + bs.equity), JSON.stringify({ ar: bs.accountsReceivable, ta: bs.totalAssets }));
    A('cash reflects the real collection (10,000 in − 800 out = 9,200)', near(bs.cash, 9200), 'cash=' + bs.cash);

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (backfill settles amount_paid without a payment row)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[ap-gap] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
