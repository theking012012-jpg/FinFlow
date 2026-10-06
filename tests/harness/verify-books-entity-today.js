#!/usr/bin/env node
'use strict';
/**
 * verify-books-entity-today.js — N64 (Rule 10). The books' "today" — what is not yet recognised (future-dated)
 * and which period is current — is the BUSINESS's calendar date in its own timezone, not the UTC date.
 *
 * Defect: computeBooks, the ledger reads, canonical AP and COGS used resolvedToday(new Date()) = the UTC date.
 * For a business east of UTC, documents dated its own today were "future" (excluded) until UTC midnight.
 *
 * Clock pinned 2026-07-25T16:00Z. Tokyo (UTC+9) = 2026-07-26 01:00; Los Angeles (UTC−7) = 2026-07-25 09:00.
 * The matrix spans the sign boundary (Rule 10 testing corollary).
 *   Tokyo business: invoices 100 (07-20) + 50 (07-26, its today) → revenue 150; bill 30 dated 07-26 is
 *     owed → AP 30                                                    (bug: revenue 100, AP 0)
 *   LA business:    invoices 100 (07-20) + 50 (07-26, its tomorrow) → revenue 100, AP 0   (control)
 *   node -r ./tests/harness/clock.js tests/harness/verify-books-entity-today.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const PW = 'entity-today-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'et@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const tok = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Tokyo KK', currency: 'USD', timezone: 'Asia/Tokyo', is_active: 1 }])).rows[0].id;
    const la = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'LA Inc', currency: 'USD', timezone: 'America/Los_Angeles', is_active: 0 }])).rows[0].id;
    const h = new HarnessHttp(server.baseUrl, { xff: '10.64.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'et@finflow.test', password: PW })).status === 200);
    for (const e of [tok, la]) {
      for (const [d, amt] of [['2026-07-20', 100], ['2026-07-26', 50]]) {
        const r = await h.post(`/api/invoices?entity_id=${e}`, { client: 'Cust', amount: amt, status: 'pending', issue_date: d, due_date: '2026-08-30' });
        if (r.status >= 300) throw new Error('invoice create ' + r.status + ' ' + r.text);
      }
      const b = await h.post(`/api/bills?entity_id=${e}`, { vendor: 'Supplier', amount: 30, status: 'unpaid', issue_date: '2026-07-26', due_date: '2026-08-30' });
      if (b.status >= 300) throw new Error('bill create ' + b.status + ' ' + b.text);
    }

    console.log('\n' + '='.repeat(78));
    console.log("  BOOKS' TODAY = THE BUSINESS'S DATE (positive and negative offsets)");
    console.log('='.repeat(78));
    const rt = (await h.get(`/api/reports?entity_id=${tok}&period=year&fyStart=0`)).json || {};
    A('Tokyo (UTC+9, today 07-26): revenue 150 — its same-day invoice counts (bug: 100)', Number(rt.revenue) === 150, `revenue ${rt.revenue} source ${rt.source}`);
    const bt = (await h.post(`/api/reports/balance-sheet?entity_id=${tok}`, {})).json || {};
    A('Tokyo: accounts payable 30 — its same-day bill is owed (bug: 0)', Number(bt.accountsPayable) === 30, `AP ${bt.accountsPayable} source ${bt.source}`);
    const rl = (await h.get(`/api/reports?entity_id=${la}&period=year&fyStart=0`)).json || {};
    A('control — LA (UTC−7, today 07-25): revenue 100 — 07-26 is still future', Number(rl.revenue) === 100, `revenue ${rl.revenue}`);
    const bl = (await h.post(`/api/reports/balance-sheet?entity_id=${la}`, {})).json || {};
    A('control — LA: accounts payable 0', Number(bl.accountsPayable) === 0, `AP ${bl.accountsPayable}`);
  } finally {
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (books entity today)` : `  ALL GREEN — ${pass} passed, 0 failed  (books entity today)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
