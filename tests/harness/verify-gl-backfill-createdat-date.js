#!/usr/bin/env node
'use strict';
/**
 * verify-gl-backfill-createdat-date.js — REGRESSION: the ledger backfill must date an entry from a
 * pg Date-OBJECT created_at when the source doc has no issue_date, exactly as computeBooks does.
 *
 * The bug (prod, 2026-09-26): the backfill dated fallback used `String(v).slice(0,10)` on created_at.
 * A pg timestamptz comes back as a Date OBJECT, and String(Date) = 'Thu Sep 15 2026 …' → its first 10
 * chars are not YYYY-MM-DD → the entry_date guard nulled it → the doc fell OUTSIDE the GL period, so
 * the ledger under-reported revenue and never reconciled to computeBooks (which uses _toYmd). Six of
 * Saige's invoices (no issue_date, only created_at) were dropped this way — a 21,300 revenue gap.
 * Fix: the backfill now dates via FinFlowDates._toYmd (handles Date objects). This probe locks it in.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-gl-backfill-createdat-date.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const { computeBooks, glReconcile, backfillLedgerForUser } = require('../../server.js');

    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'bf-date@finflow.test', name: 'BF', plan: 'business', role: 'owner', base_currency: 'USD', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Co', currency: 'USD' }])).rows[0].id;

    // Invoice WITH issue_date (control) and invoice WITHOUT issue_date (only a real timestamp created_at,
    // stored as a proper TIMESTAMPTZ so the row comes back as a pg Date object — the prod scenario).
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-06-10T09:00:00Z',NOW())`,
      [uid, eid, { client: 'A', amount: 1000, status: 'pending', issue_date: '2026-06-10' }]);
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,'2026-06-15T09:00:00Z',NOW())`,
      [uid, eid, { client: 'B', amount: 4000, status: 'pending' }]);   // NO issue_date → must fall back to created_at (a Date object)

    // Oracle: computeBooks counts BOTH (5000) — it dates the second off created_at via _toYmd.
    const books = await computeBooks(uid, eid, 'year');
    A('oracle computeBooks revenue counts BOTH invoices (5000)', Math.abs(books.revenue - 5000) < 0.01, 'revenue=' + books.revenue);

    // Backfill (the real writer) then reconcile.
    await backfillLedgerForUser(uid, { entityId: eid });

    const { rows: entries } = await c.query(
      `SELECT source_id, entry_date::text AS entry_date FROM ledger_entries WHERE user_id=$1 AND source_type='invoice' ORDER BY source_id`, [uid]);
    A('both invoice entries were posted', entries.length === 2, JSON.stringify(entries));
    A('NEITHER invoice entry has a null entry_date (the no-issue_date one dated off created_at)',
      entries.every(e => e.entry_date && /^\d{4}-\d{2}-\d{2}$/.test(e.entry_date)), JSON.stringify(entries));
    A('the no-issue_date invoice is dated 2026-06-15 (from its created_at, via _toYmd)',
      entries.some(e => e.entry_date === '2026-06-15'), JSON.stringify(entries));

    const rec = await glReconcile(uid, eid);
    A('GL revenue == oracle revenue (both invoices in the period) → reconciled', rec.reconciledToReports === true, JSON.stringify({ reconciled: rec.reconciledToReports }));
    A('books balanced (trial balance ties, reports reconcile)', rec.booksBalanced === true, JSON.stringify({ booksBalanced: rec.booksBalanced }));

    console.log('\n' + (fail === 0 ? '  ALL GREEN — ' + pass + ' passed, 0 failed  (backfill dates off a Date-object created_at)'
                                   : '  ' + fail + ' FAILED, ' + pass + ' passed'));
  } catch (e) {
    console.error('[bf-date] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail = fail || 1;
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
