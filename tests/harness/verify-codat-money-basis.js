#!/usr/bin/env node
'use strict';
/**
 * verify-codat-money-basis.js — N46. A Codat migration lands every money record on the right basis: a bill
 * payment settles its bill (no second expense), a void or draft bill is not an expense, a customer payment is
 * cash in on its invoice, and a foreign-currency record is never written as if it were native.
 *
 * Defects (executed through the real /api/codat/import, Codat stubbed at its HTTP boundary):
 *   - billPayments were imported with NO bill_id → orphan payment = direct expense, while the imported bill
 *     already accrued the expense: opex counted twice
 *   - Codat Void and Draft bills mapped to 'unpaid' → recognised as expenses
 *   - customer payments went to the RETIRED payments_received store → no cash-in anywhere
 *   - a EUR invoice was written as EUR-amount-in-USD
 *
 * Seed (USD business, January FY, today 2026-07-25), hand-computed expected opex:
 *   bills: B1 600 (PartiallyPaid, due 100) · B-void 900 (Void) · B-draft 700 (Draft)
 *   billPayment 500 → B1                     expenses = 600 (bug: 600 + 500 orphan + 900 + 700 = 2700)
 *   invoices: I1 1000 Paid (USD) · I-eur 2000 (EUR)   revenue = 1000 (bug: 3000)
 *   payment 1000 → I1                        cash in (invoice_payments) = 1000 (bug: 0)
 *   node -r ./tests/harness/clock.js tests/harness/verify-codat-money-basis.js
 */
process.env.CODAT_API_KEY = 'harness-codat-key';
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const FIX = {
  accounts: [], customers: [], suppliers: [], journalEntries: [],
  invoices: [
    { id: 'i1', invoiceNumber: 'INV-1', customerRef: { id: 'c1', companyName: 'Acme' }, issueDate: '2026-05-10', dueDate: '2026-06-10', currency: 'USD', totalAmount: 1000, amountDue: 0, status: 'Paid' },
    { id: 'ieur', invoiceNumber: 'INV-EUR', customerRef: { id: 'c2', companyName: 'Euro GmbH' }, issueDate: '2026-05-12', dueDate: '2026-06-12', currency: 'EUR', totalAmount: 2000, amountDue: 2000, status: 'Submitted' },
  ],
  bills: [
    { id: 'b1', reference: 'B1', supplierRef: { id: 's1', supplierName: 'Cloud Host' }, issueDate: '2026-05-13', dueDate: '2026-06-13', currency: 'USD', totalAmount: 600, amountDue: 100, status: 'PartiallyPaid' },
    { id: 'bvoid', reference: 'BV', supplierRef: { id: 's2', supplierName: 'Void Co' }, issueDate: '2026-05-14', dueDate: '2026-06-14', currency: 'USD', totalAmount: 900, amountDue: 900, status: 'Void' },
    { id: 'bdraft', reference: 'BD', supplierRef: { id: 's3', supplierName: 'Draft Co' }, issueDate: '2026-05-15', dueDate: '2026-06-15', currency: 'USD', totalAmount: 700, amountDue: 700, status: 'Draft' },
  ],
  payments: [ { id: 'p1', customerRef: { id: 'c1', companyName: 'Acme' }, date: '2026-05-20', totalAmount: 1000, currency: 'USD', lines: [{ amount: 1000, links: [{ type: 'Invoice', id: 'i1' }] }] } ],
  billPayments: [ { id: 'bp1', supplierRef: { id: 's1', supplierName: 'Cloud Host' }, date: '2026-05-25', totalAmount: 500, currency: 'USD', lines: [{ amount: 500, links: [{ type: 'Bill', id: 'b1' }] }] } ],
};

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  const realFetch = global.fetch;
  try {
    server = await bootServer(scratch.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (!u.startsWith('https://api.codat.io')) return realFetch(url, opts);
      if (u.includes('/connections')) return json({ results: [{ status: 'Linked', platformName: 'QuickBooks Online' }] });
      const m = u.match(/\/data\/([a-zA-Z]+)\?page=(\d+)/);
      if (m) { const arr = FIX[m[1]] || []; return json({ results: Number(m[2]) === 1 ? arr : [], pageNumber: Number(m[2]), totalResults: arr.length }); }
      return json({ error: 'unmapped' }, 404);
    };
    const PW = 'codat-basis-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'cb@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'CB Co', currency: 'USD', is_active: 1 }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data) VALUES ($1,$2,$3)`, [uid, eA, { key: 'codat_conn', value: JSON.stringify({ company_id: 'co_test', platform: 'QuickBooks Online' }) }]);
    const h = new HarnessHttp(server.baseUrl, { xff: '10.46.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'cb@finflow.test', password: PW })).status === 200);
    const imp = await h.post(`/api/codat/import?entity_id=${eA}`, {});
    A('import → 200', imp.status === 200, `status ${imp.status} ${imp.text.slice(0, 160)}`);

    const rep = (await h.get(`/api/reports?entity_id=${eA}&period=year&fyStart=0`)).json || {};
    A('expenses 600 — the bill only; its payment settles it; void/draft bills not recognised (bug: 2700)', Number(rep.expenses) === 600, 'expenses ' + rep.expenses);
    A('revenue 1000 — the EUR invoice is not written as USD (bug: 3000)', Number(rep.revenue) === 1000, 'revenue ' + rep.revenue);
    const bp = (await c.query(`SELECT data->>'bill_id' b FROM payments_made WHERE user_id=$1`, [uid])).rows;
    const b1 = (await c.query(`SELECT id FROM bills WHERE user_id=$1 AND data->>'num'='B1'`, [uid])).rows[0];
    A('the bill payment is linked to its imported bill (bug: bill_id null → orphan expense)', bp.length === 1 && b1 && Number(bp[0].b) === b1.id, JSON.stringify(bp));
    const ip = (await c.query(`SELECT COALESCE(SUM(amount),0)::float s FROM invoice_payments WHERE user_id=$1`, [uid])).rows[0].s;
    A('customer payment = cash in on its invoice: invoice_payments 1000 (bug: 0, retired store)', ip === 1000, 'invoice_payments ' + ip);
    const bills = (await c.query(`SELECT data->>'num' n FROM bills WHERE user_id=$1 ORDER BY id`, [uid])).rows.map(r => r.n);
    A('void and draft bills not imported', JSON.stringify(bills) === '["B1"]', JSON.stringify(bills));
    const t = (imp.json && imp.json.results && imp.json.results.invoices) || {};
    A('the EUR invoice is reported as a currency mismatch, not written', Number(t.currencyMismatch) === 1, JSON.stringify(t));
  } finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (Codat money basis)` : `  ALL GREEN — ${pass} passed, 0 failed  (Codat money basis)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[harness] fatal:', e && e.stack || e); process.exit(2); });
