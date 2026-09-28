'use strict';
/**
 * verify-csv-import.js — DIRECT CSV IMPORT (aggregator-free migration). POST /api/import/csv parses a
 * CSV export (QuickBooks/Xero/spreadsheet), auto-detects columns, and writes documents idempotently,
 * entity-scoped. Dry-run previews without writing; a money import auto-reconciles via the verify engine.
 *
 * EXECUTED against real Postgres. Discriminating (Rule 14): preview writes NOTHING; commit writes the
 * valid rows (bad/empty rows skipped); a re-import is fully deduped (added 0); the imported money docs
 * reconcile (trial balance ties); a non-money import returns no reconcile block.
 *   node -r ./tests/harness/clock.js tests/harness/verify-csv-import.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
const csv = rows => rows.join('\n');
(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const email = 'csv-import@finflow.test';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eid = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`,
      [uid, { name: 'CSV Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.95' });
    A('login 200', (await http.post('/api/auth/login', { email, password: PW })).status === 200);
    const post = (type, content, dryRun) => http.post('/api/import/csv?entity_id=' + eid, { type, content, dryRun });
    const invCount = async () => (await c.query(`SELECT COUNT(*)::int n FROM invoices WHERE user_id=$1`, [uid])).rows[0].n;

    // Invoices CSV: 2 valid, 1 empty row (skip), 1 bad amount (skip).
    const invCsv = csv([
      'Customer,Amount,Status,Issue Date,Due Date,Invoice Number',
      'Acme Corp,1500,pending,2026-06-01,2026-07-01,INV-100',
      'Beta LLC,2500,paid,2026-06-05,2026-06-20,INV-101',
      ',,,,,',
      'Gamma,notanumber,pending,2026-06-10,,INV-102',
    ]);

    // PREVIEW writes nothing.
    const prev = JSON.parse((await post('invoices', invCsv, true)).text);
    A('preview: added 2 valid rows (bad+empty skipped)', prev.added === 2, JSON.stringify(prev));
    A('preview wrote NOTHING to the DB', (await invCount()) === 0, 'count=' + (await invCount()));

    // COMMIT writes the valid rows.
    const imp = JSON.parse((await post('invoices', invCsv, false)).text);
    A('commit: added 2', imp.added === 2, JSON.stringify(imp));
    A('commit: 1 bad row skipped', imp.skipped >= 1, 'skipped=' + imp.skipped);
    A('commit: DB now has 2 invoices', (await invCount()) === 2, 'count=' + (await invCount()));
    const acme = (await c.query(`SELECT data FROM invoices WHERE user_id=$1 AND data->>'client'='Acme Corp'`, [uid])).rows[0];
    A('imported invoice has correct amount + status + source', acme && Number(acme.data.amount) === 1500 && acme.data.status === 'pending' && acme.data.source === 'csv', JSON.stringify(acme && acme.data));

    // IDEMPOTENT re-import.
    const again = JSON.parse((await post('invoices', invCsv, false)).text);
    A('re-import is idempotent (added 0, duplicate 2)', again.added === 0 && again.duplicate === 2, JSON.stringify(again));
    A('DB still has exactly 2 invoices', (await invCount()) === 2, 'count=' + (await invCount()));

    // Money import auto-reconciles (owner) and ties out.
    A('invoice import reconcile: tiedOut true', imp.reconcile && imp.reconcile.tiedOut === true, JSON.stringify(imp.reconcile));

    // Expenses CSV.
    const expImp = JSON.parse((await post('expenses', csv([
      'Description,Amount,Category,Date',
      'Office rent,800,Rent,2026-06-02',
      'Domain renewal,20,Software,2026-06-03',
    ]), false)).text);
    A('expenses: added 2', expImp.added === 2, JSON.stringify(expImp));
    A('expenses import still reconciles (tiedOut)', expImp.reconcile && expImp.reconcile.tiedOut === true, JSON.stringify(expImp.reconcile));

    // Bills CSV.
    const billImp = JSON.parse((await post('bills', csv([
      'Vendor,Amount,Status,Bill Date,Due Date',
      'Acme Supplies,300,unpaid,2026-06-04,2026-07-04',
    ]), false)).text);
    A('bills: added 1', billImp.added === 1, JSON.stringify(billImp));
    A('bills import still reconciles (tiedOut)', billImp.reconcile && billImp.reconcile.tiedOut === true, JSON.stringify(billImp.reconcile));

    // Non-money import (customers): no reconcile block.
    const custImp = JSON.parse((await post('customers', csv([
      'Name,Email,Phone',
      'Acme Corp,ap@acme.com,555-1000',
      'Beta LLC,,555-2000',
    ]), false)).text);
    A('customers: added 2', custImp.added === 2, JSON.stringify(custImp));
    A('non-money import has NO reconcile block', custImp.reconcile == null, JSON.stringify(custImp.reconcile));

    // Bad type rejected.
    A('unknown type rejected (400)', (await post('widgets', 'a,b', false)).status === 400);

    const fs = require('fs'); const path = require('path');
    const idx = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    A('[STRUCTURAL] client ffImportCsv posts to /api/import/csv with preview then commit', /window\.ffImportCsv\s*=\s*function/.test(idx) && /\/api\/import\/csv/.test(idx) && /dryRun:\s*true/.test(idx));
    A('[STRUCTURAL] Invoices page exposes an Import CSV action', /ffImportCsv\('invoices'\)/.test(idx));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (direct CSV import)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
