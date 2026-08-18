#!/usr/bin/env node
'use strict';
/**
 * verify-codat-import.js — Codat → FinFlow MIGRATION importer (F187). Executes the REAL
 * /api/codat/import-preview + /api/codat/import endpoints against real Postgres, with the Codat
 * network boundary stubbed (global.fetch intercepts api.codat.io, everything else — incl. the
 * harness's own loopback HTTP — passes through to the real guarded fetch). Proves:
 *   - every data type maps into the canonical JSONB tables through db.insert (single-writer)
 *   - invoices/bills carry amount_paid derived from Codat amountDue → AR/AP tie out exactly
 *   - imported payments (received/made) do NOT re-move amount_paid (no double-count)
 *   - unbalanced journals are skipped, balanced ones imported
 *   - re-running imports 0 (idempotent on the deterministic codat key), no duplicate rows
 *   - RBAC: a viewer cannot preview or import (books:write)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-codat-import.js
 *
 * Scratch Postgres only — enforced by guard.js.
 */

process.env.CODAT_API_KEY = 'harness-codat-key';   // installEnv() does NOT scrub this → codatConfigured() true

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

// ── Codat fixture dataset (one page each) ──
const FIX = {
  accounts: [
    { id: 'a1', nominalCode: '1000', name: 'Cash', type: 'Asset', status: 'Active', currentBalance: 5000, currency: 'USD' },
    { id: 'a2', nominalCode: '4000', name: 'Sales', type: 'Income', status: 'Active', currentBalance: 0, currency: 'USD' },
    { id: 'a3', nominalCode: '5000', name: 'Rent', type: 'Expense', status: 'Active', currentBalance: 0, currency: 'USD' },
  ],
  customers: [
    { id: 'c1', customerName: 'Acme Corp', contactName: 'John Smith', emailAddress: 'john@acme.com', phone: '555-1', status: 'Active', currency: 'USD' },
    { id: 'c2', customerName: 'Beta LLC', contactName: 'Jane', emailAddress: 'jane@beta.com', phone: '555-2', status: 'Active', currency: 'USD' },
  ],
  suppliers: [
    { id: 's1', supplierName: 'Office Supplies Co', contactName: 'Bob', status: 'Active', currency: 'USD' },
    { id: 's2', supplierName: 'Cloud Host Inc', contactName: '', status: 'Active', currency: 'USD' },
  ],
  invoices: [
    { id: 'i1', invoiceNumber: 'INV-1', customerRef: { id: 'c1', companyName: 'Acme Corp' }, issueDate: '2026-05-10', dueDate: '2026-06-10', currency: 'USD', totalAmount: 1000, amountDue: 0, status: 'Paid' },
    { id: 'i2', invoiceNumber: 'INV-2', customerRef: { id: 'c2', companyName: 'Beta LLC' }, issueDate: '2026-05-12', dueDate: '2026-06-12', currency: 'USD', totalAmount: 500, amountDue: 500, status: 'Submitted' },
    { id: 'i3', invoiceNumber: 'INV-3', customerRef: { id: 'c1', companyName: 'Acme Corp' }, issueDate: '2026-05-14', dueDate: '2026-06-14', currency: 'USD', totalAmount: 800, amountDue: 300, status: 'PartiallyPaid' },
  ],
  bills: [
    { id: 'b1', reference: 'BILL-A', supplierRef: { id: 's1', supplierName: 'Office Supplies Co' }, issueDate: '2026-05-11', dueDate: '2026-06-11', currency: 'USD', totalAmount: 400, amountDue: 400, status: 'Open' },
    { id: 'b2', reference: 'BILL-B', supplierRef: { id: 's2', supplierName: 'Cloud Host Inc' }, issueDate: '2026-05-13', dueDate: '2026-06-13', currency: 'USD', totalAmount: 600, amountDue: 100, status: 'PartiallyPaid' },
  ],
  payments: [
    { id: 'p1', customerRef: { id: 'c1', companyName: 'Acme Corp' }, date: '2026-05-20', totalAmount: 1000, currency: 'USD', lines: [{ amount: 1000, links: [{ type: 'Invoice', id: 'i1' }] }] },
    { id: 'p2', customerRef: { id: 'c1', companyName: 'Acme Corp' }, date: '2026-05-22', totalAmount: 500, currency: 'USD', lines: [{ amount: 500, links: [{ type: 'Invoice', id: 'i3' }] }] },
  ],
  billPayments: [
    { id: 'bp1', supplierRef: { id: 's2', supplierName: 'Cloud Host Inc' }, date: '2026-05-25', totalAmount: 500, currency: 'USD' },
  ],
  journalEntries: [
    { id: 'j1', journalRef: 'JE-1', description: 'Opening', postedOn: '2026-05-01', journalLines: [{ netAmount: 100, accountRef: { id: 'a1' }, description: 'dr' }, { netAmount: -100, accountRef: { id: 'a2' }, description: 'cr' }] },
    { id: 'j2', journalRef: 'JE-2', description: 'Unbalanced', postedOn: '2026-05-02', journalLines: [{ netAmount: 100, accountRef: { id: 'a1' } }, { netAmount: -50, accountRef: { id: 'a2' } }] },
  ],
};

function installCodatStub() {
  const realFetch = global.fetch;                    // clock-guarded fetch (allows loopback)
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.startsWith('https://api.codat.io')) return realFetch(url, opts);
    if (u.includes('/connections')) return json({ results: [{ status: 'Linked', platformName: 'QuickBooks Online' }] });
    const m = u.match(/\/data\/([a-zA-Z]+)\?page=(\d+)/);
    if (m) {
      const type = m[1], page = Number(m[2]);
      const arr = FIX[type] || [];
      return json({ results: page === 1 ? arr : [], pageNumber: page, totalResults: arr.length });
    }
    return json({ error: 'unmapped' }, 404);
  };
  return () => { global.fetch = realFetch; };
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null, restore = null;
  try {
    server = await bootServer(scratch.url);
    restore = installCodatStub();

    const mkUser = async (email) => (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name: email, plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const ownerId = await mkUser('cd-owner@finflow.test');
    const entId = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [ownerId, { name: 'CD Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    // seed the codat connection blob (company linked)
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerId, { key: 'codat_conn', value: JSON.stringify({ company_id: 'co_test', platform: 'QuickBooks Online' }) }]);
    const viewerId = await mkUser('cd-viewer@finflow.test');
    await c.query(`INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerId, { member_user_id: String(viewerId), status: 'active', role: 'viewer', name: 'V', email: 'cd-viewer@finflow.test' }]);

    const login = async (email) => { const h = new HarnessHttp(server.baseUrl); if ((await h.post('/api/auth/login', { email, password: PW })).status !== 200) throw new Error('login ' + email); return h; };
    const cnt = async (tbl) => Number((await c.query(`SELECT COUNT(*)::int n FROM ${tbl} WHERE user_id=$1`, [ownerId])).rows[0].n);
    const sum = async (tbl) => Number((await c.query(`SELECT COALESCE(SUM((data->>'amount')::numeric - COALESCE(NULLIF(data->>'amount_paid','')::numeric,0)),0) s FROM ${tbl} WHERE user_id=$1`, [ownerId])).rows[0].s);

    const owner = await login('cd-owner@finflow.test');

    console.log('\n' + '='.repeat(78));
    console.log('  CODAT → FINFLOW MIGRATION — preview, import, AR/AP tie-out, idempotency, RBAC');
    console.log('='.repeat(78));

    // ── PREVIEW (dry run — no writes) ──
    console.log('\n-- preview (dry-run) --');
    const pv = await owner.post('/api/codat/import-preview', {});
    const ds = (pv.json && pv.json.datasets) || {};
    A('preview → 200', pv.status === 200, JSON.stringify(pv.json).slice(0, 200));
    A('preview platform = QuickBooks Online', pv.json && pv.json.platform === 'QuickBooks Online');
    A('preview counts (acct3 cust2 supp2 inv3 bill2 pay2 billpay1)',
      ds.accounts && ds.accounts.added === 3 && ds.customers.added === 2 && ds.suppliers.added === 2 &&
      ds.invoices.added === 3 && ds.bills.added === 2 && ds.payments.added === 2 && ds.billPayments.added === 1,
      JSON.stringify(Object.keys(ds).reduce((o,k)=>{o[k]=ds[k].added;return o;},{})));
    A('preview journals: 1 balanced added, 1 unbalanced skipped', ds.journalEntries && ds.journalEntries.added === 1 && ds.journalEntries.skipped === 1, JSON.stringify(ds.journalEntries));
    A('preview wrote NOTHING (invoices table still empty)', (await cnt('invoices')) === 0);

    // ── IMPORT ──
    console.log('\n-- import (write) --');
    const imp = await owner.post('/api/codat/import', {});
    A('import → 200, total_added 16', imp.status === 200 && imp.json.total_added === 16, JSON.stringify(imp.json && imp.json.total_added));
    A('invoices: 3 rows', (await cnt('invoices')) === 3);
    A('bills: 2 rows', (await cnt('bills')) === 2);
    A('customers: 2 rows', (await cnt('customers')) === 2);
    A('vendors: 2 rows', (await cnt('vendors')) === 2);
    A('chart_of_accounts: 3 rows', (await cnt('chart_of_accounts')) === 3);
    A('payments_received: 2 rows', (await cnt('payments_received')) === 2);
    A('payments_made: 1 row', (await cnt('payments_made')) === 1);
    A('journals: 1 row (balanced only)', (await cnt('journals')) === 1);

    A('AR ties out = 800 (Σ amount − amount_paid over invoices)', (await sum('invoices')) === 800, 'AR=' + (await sum('invoices')));
    A('AP ties out = 500 (Σ amount − amount_paid over bills)', (await sum('bills')) === 500, 'AP=' + (await sum('bills')));

    const i1 = (await c.query(`SELECT data FROM invoices WHERE user_id=$1 AND data->>'codat_id'='i1'`, [ownerId])).rows[0].data;
    A('paid invoice i1 amount_paid=1000 status=paid', Number(i1.amount_paid) === 1000 && i1.status === 'paid', JSON.stringify(i1));
    const i3 = (await c.query(`SELECT data FROM invoices WHERE user_id=$1 AND data->>'codat_id'='i3'`, [ownerId])).rows[0].data;
    A('partial invoice i3 amount_paid=500 status=partial', Number(i3.amount_paid) === 500 && i3.status === 'partial', JSON.stringify(i3));
    A('imported rows are entity-scoped (i1.entity_id = seeded entity)',
      Number((await c.query(`SELECT entity_id FROM invoices WHERE user_id=$1 AND data->>'codat_id'='i1'`, [ownerId])).rows[0].entity_id) === entId);
    A('imported rows tagged source=codat', i1.source === 'codat');

    // single-writer / no double-count: the imported bill-payment must NOT carry a bill_id (else recalcBillStatus
    // would re-move amount_paid and AP would drift). Assert AP unchanged AND no bill_id on the payment.
    const bpRow = (await c.query(`SELECT data FROM payments_made WHERE user_id=$1 LIMIT 1`, [ownerId])).rows[0].data;
    A('imported payment_made has NO bill_id (no double-count path)', bpRow.bill_id === undefined || bpRow.bill_id === null || bpRow.bill_id === '', JSON.stringify(bpRow));
    const jrow = (await c.query(`SELECT data FROM journals WHERE user_id=$1 LIMIT 1`, [ownerId])).rows[0].data;
    A('journal imported balanced (debit==credit)', Number(jrow.debit) === Number(jrow.credit) && Number(jrow.debit) === 100, JSON.stringify(jrow));

    // ── IDEMPOTENCY: re-import must add 0 and create no duplicate rows ──
    console.log('\n-- idempotency (re-import) --');
    const imp2 = await owner.post('/api/codat/import', {});
    A('re-import → total_added 0', imp2.status === 200 && imp2.json.total_added === 0, JSON.stringify(imp2.json && imp2.json.total_added));
    A('still 3 invoices (no duplicates)', (await cnt('invoices')) === 3);
    A('still 2 bills, 2 customers, 3 accounts, 1 journal', (await cnt('bills')) === 2 && (await cnt('customers')) === 2 && (await cnt('chart_of_accounts')) === 3 && (await cnt('journals')) === 1);
    A('AR still 800 after re-import (no drift)', (await sum('invoices')) === 800);

    // ── RBAC ──
    console.log('\n-- RBAC (books:write) --');
    const viewer = await login('cd-viewer@finflow.test');
    A('viewer import-preview → 403', (await viewer.post('/api/codat/import-preview', {})).status === 403);
    A('viewer import → 403', (await viewer.post('/api/codat/import', {})).status === 403);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (codat migration importer)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('  NOTE: the live Codat network handshake is stubbed here; a real CODAT_API_KEY + sandbox');
    console.log('        company is the one boundary still to run end-to-end in the deployed app.');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (restore) restore();
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[codat-import] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
