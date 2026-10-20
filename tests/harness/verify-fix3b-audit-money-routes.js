'use strict';
/**
 * verify-fix3b-audit-money-routes.js — FIX-3b (LC3b; owner decision 2026-10-20: "audit them + add guard").
 *
 * The class LC3 belonged to: routes that change a business's books or access and write NO audit-trail row. Confirmed
 * by reading (tools/fix-2026-10-19/fix3-unaudited-routes.txt, categories B + C) — e.g. deleting an invoice payment or
 * a posted journal, auto-categorise "run" rewriting expense categories, and the role-permission table, all left no
 * trace of who did it. Fix: each writes one audit_trail row through recordAudit (record before / after, its business,
 * attributed); personal-scope bank lines are deliberately NOT written to the trail (the trail is shown on a business
 * page — the personal / business wall).
 *
 * Real scratch Postgres, real server, real routes. For each route: the row's (table, action), that it is on the right
 * business, and one value that identifies the change (bug: no row).
 * NOT executed here (labelled): POST /api/invoices/:id/payment-link — it calls an external processor; its audit call
 * is read-only verified.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fix3b-audit-money-routes.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let scratch, server;
  console.log('\nFIX-3b — money and access routes write an audit row\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const PW = 'harness-password-not-a-secret';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'fix3b@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.131' });
    if ((await http.post('/api/auth/login', { email: 'fix3b@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 300)); return r.json; };
    const ent = await J('POST', '/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('POST', '/api/entities/' + ent.id + '/activate', {});
    await J('PUT', '/api/settings', { personal_bank_currency: 'USD' }).catch(() => {});
    const eid = ent.id;
    let mark = 0;
    const since = async () => { const { rows } = await c.query(`SELECT COALESCE(MAX(id),0) m FROM audit_trail`); mark = rows[0].m; };
    const rows = async () => (await c.query(`SELECT table_name, action, entity_id, record_id, actor_type, old_data, new_data FROM audit_trail WHERE user_id = $1 AND id > $2 ORDER BY id`, [uid, mark])).rows;
    const ta = r => r.map(x => [x.table_name, x.action, x.entity_id === eid, x.actor_type]);

    // ── invoice payment delete ──
    const inv = await J('POST', '/api/invoices', { client: 'Acme', amount: 500, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-01', idempotency_key: 'f3b-i' });
    const pay = await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 175, payment_date: '2026-07-05', idempotency_key: 'f3b-p' });
    const payId = (pay.payment || pay).id;
    await since(); await J('DELETE', '/api/invoice-payments/' + payId);
    let t = (await rows()).filter(x => x.table_name === 'invoice_payments');
    eq('DELETE invoice payment → invoice_payments DELETE, amount 175', t.map(x => [x.action, x.entity_id === eid, Number(x.old_data && x.old_data.amount)]), [['DELETE', true, 175]], []);

    // ── journal delete (posted) ──
    const je = await J('POST', '/api/journals', { date: '2026-07-02', description: 'Accrual F3B', status: 'Posted', lines: [{ account: '6000', debit: 42, credit: 0 }, { account: '2000', debit: 0, credit: 42 }], idempotency_key: 'f3b-j' });
    await since(); await J('DELETE', '/api/journals/' + je.id);
    t = (await rows()).filter(x => x.table_name === 'journals');
    eq('DELETE journal → journals DELETE, the deleted entry kept', t.map(x => [x.action, x.old_data && x.old_data.description]), [['DELETE', 'Accrual F3B']], []);

    // ── inventory restock ──
    const item = await J('POST', '/api/inventory', { name: 'Widget F3B', sku: 'W3B', qty: 4, cost: 10, price: 25 });
    await since(); await J('POST', '/api/inventory/' + item.id + '/restock', { qty: 6, unit_cost: 12 });
    t = (await rows()).filter(x => x.table_name === 'inventory');
    eq('restock → inventory UPDATE, units 4 → 10', t.map(x => [x.action, Number(x.old_data && (x.old_data.units ?? x.old_data.qty)), Number(x.new_data && (x.new_data.units ?? x.new_data.qty))]), [['UPDATE', 4, 10]], []);

    // ── documents delete ──
    const doc = await J('POST', '/api/documents', { name: 'receipt-f3b.pdf', type: 'receipt', file_data: Buffer.from('%PDF-1.4 f3b').toString('base64'), media_type: 'application/pdf' });
    await since(); await J('DELETE', '/api/documents/' + doc.id);
    t = (await rows()).filter(x => x.table_name === 'documents');
    eq('DELETE document → documents DELETE (name kept, file bytes not)', t.map(x => [x.action, x.old_data && x.old_data.name, !!(x.old_data && x.old_data.file_data)]), [['DELETE', 'receipt-f3b.pdf', false]], []);

    // ── templates ──
    await since();
    const tpl = await J('POST', '/api/templates', { name: 'Blue F3B', accent_color: '#112233' });
    await J('PUT', '/api/templates/' + tpl.id, { accent_color: '#445566' });
    await J('DELETE', '/api/templates/' + tpl.id);
    t = (await rows()).filter(x => x.table_name === 'templates');
    eq('templates: CREATE · UPDATE (accent #112233 → #445566) · DELETE', t.map(x => [x.action, x.action === 'UPDATE' ? [x.old_data.accent_color, x.new_data.accent_color] : null]), [['CREATE', null], ['UPDATE', ['#112233', '#445566']], ['DELETE', null]], []);

    // ── auto-categorise rules + run ──
    const exp = await J('POST', '/api/expenses', { description: 'Uber trip F3B', category: 'Other', amount: 23, expense_date: '2026-07-03', idempotency_key: 'f3b-e' });
    await since();
    const rule = await J('POST', '/api/autocat-rules', { keyword: 'uber', category: 'Travel' });
    await J('PUT', '/api/autocat-rules/' + rule.id, { category: 'Transport' });
    const run = await J('POST', '/api/autocat-rules/run', {});
    await J('DELETE', '/api/autocat-rules/' + rule.id);
    t = await rows();
    eq('autocat rules: CREATE · UPDATE · DELETE', t.filter(x => x.table_name === 'autocat_rules').map(x => x.action), ['CREATE', 'UPDATE', 'DELETE'], []);
    eq('autocat run: the expense it re-categorised → expenses UPDATE, Other → Transport', [run.updated, ...t.filter(x => x.table_name === 'expenses').map(x => [x.action, x.record_id === exp.id, x.old_data.category, x.new_data.category])], [1, ['UPDATE', true, 'Other', 'Transport']], [1]);

    // ── recurring schedules ──
    await since();
    const ri = await J('POST', '/api/recurring-invoices', { client: 'Acme', amount: 300, frequency: 'Monthly', next_run: '2026-11-01' });
    await J('PUT', '/api/recurring-invoices/' + ri.id, { amount: 320 });
    await J('DELETE', '/api/recurring-invoices/' + ri.id);
    const rb = await J('POST', '/api/recurring-bills', { vendor: 'Net Host', amount: 90, frequency: 'Monthly', next_run: '2026-11-01' });
    await J('PUT', '/api/recurring-bills/' + rb.id, { amount: 95 });
    await J('DELETE', '/api/recurring-bills/' + rb.id);
    t = await rows();
    eq('recurring invoices: CREATE · UPDATE (300 → 320) · DELETE', t.filter(x => x.table_name === 'recurring_invoices').map(x => [x.action, x.action === 'UPDATE' ? [Number(x.old_data.amount), Number(x.new_data.amount)] : null]), [['CREATE', null], ['UPDATE', [300, 320]], ['DELETE', null]], []);
    eq('recurring bills: CREATE · UPDATE (90 → 95) · DELETE', t.filter(x => x.table_name === 'recurring_bills').map(x => [x.action, x.action === 'UPDATE' ? [Number(x.old_data.amount), Number(x.new_data.amount)] : null]), [['CREATE', null], ['UPDATE', [90, 95]], ['DELETE', null]], []);

    // ── bank lines (business) + reconciliation ──
    await since();
    const bl = await J('POST', '/api/banking', { desc: 'Deposit F3B', amount: 175, type: 'credit', date: '2026-07-05' });
    const bl2 = await J('POST', '/api/banking', { desc: 'Fee F3B', amount: 4, type: 'debit', date: '2026-07-06' });
    const imp = await J('POST', '/api/banking/import', { format: 'csv', content: 'Date,Description,Amount\n2026-07-07,Coffee F3B,-4.50\n2026-07-08,Refund F3B,12.00\n' });
    t = (await rows()).filter(x => x.table_name === 'bank_lines');
    eq('bank lines: 2 added + ' + imp.imported + ' imported → one CREATE each, on Northwind', [t.length, t.every(x => x.action === 'CREATE' && x.entity_id === eid)], [2 + imp.imported, true], [0, true]);
    const pay2 = await J('POST', '/api/invoice-payments', { invoice_id: inv.id, amount: 175, payment_date: '2026-07-05', idempotency_key: 'f3b-p2' });
    await since();
    const m1 = await J('POST', '/api/bank-reconciliation/match', { banking_id: bl.id, invoice_payment_id: (pay2.payment || pay2).id });
    await J('POST', '/api/bank-reconciliation/ignore', { banking_id: bl2.id });
    await J('DELETE', '/api/bank-reconciliation/' + m1.id);
    await J('POST', '/api/bank-reconciliation/match-batch', { matches: [{ banking_id: bl.id, invoice_payment_id: (pay2.payment || pay2).id }] });
    t = await rows();
    eq('reconciliation: match CREATE · unmatch DELETE · batch CREATE', t.filter(x => x.table_name === 'bank_reconciliation').map(x => x.action), ['CREATE', 'DELETE', 'CREATE'], []);
    eq('ignore a bank line → bank_lines UPDATE, reconcile_state → ignored', t.filter(x => x.table_name === 'bank_lines').map(x => [x.action, x.new_data && x.new_data.reconcile_state]), [['UPDATE', 'ignored']], []);
    await since();
    const pbl = await http.request('POST', '/api/banking?scope=personal', { desc: 'Personal coffee', amount: 3, type: 'debit', date: '2026-07-09', scope: 'personal' });
    eq('a PERSONAL bank line is not written to the trail (wall)', [pbl.status < 300 || pbl.status === 400, (await rows()).length], [true, 0]);

    // ── FX ──
    await since();
    const fr = await J('POST', '/api/fx-rates', { from_currency: 'USD', to_currency: 'TTD', rate: 6.79, rate_date: '2026-07-01' });
    await J('DELETE', '/api/fx-rates/' + fr.id);
    const fx = await J('POST', '/api/fx-transactions', { foreign_currency: 'EUR', foreign_amount: 1000, rate_at_transaction: 1.08 });
    await J('POST', '/api/fx-transactions/' + fx.id + '/settle', { rate_at_settlement: 1.11 });
    t = await rows();
    eq('FX rates: CREATE (6.79) · DELETE', t.filter(x => x.table_name === 'fx_rates').map(x => [x.action, Number((x.new_data || x.old_data).rate)]), [['CREATE', 6.79], ['DELETE', 6.79]], []);
    eq('FX position: CREATE · UPDATE (settled, realised 30)', t.filter(x => x.table_name === 'fx_transactions').map(x => [x.action, x.action === 'UPDATE' ? [x.new_data.status, Number(x.new_data.realised_gain_loss)] : null]), [['CREATE', null], ['UPDATE', ['settled', 30]]], []);

    // ── MRR, permissions, ledger rebuild ──
    await since();
    await J('PUT', '/api/mrr', { mrr: 1200 });
    await J('PUT', '/api/mrr', { mrr: 1350 });
    await J('POST', '/api/permissions', [{ role: 'bookkeeper', perms: ['books:read'] }]);
    await J('POST', '/api/gl/backfill', {});
    t = await rows();
    eq('MRR: CREATE (1200) then UPDATE (1200 → 1350)', t.filter(x => x.table_name === 'settings').map(x => [x.action, x.action === 'UPDATE' ? [x.old_data.mrr, x.new_data.mrr] : x.new_data.mrr]), [['CREATE', 1200], ['UPDATE', [1200, 1350]]], []);
    eq('role permissions saved → permissions UPDATE with the new table', t.filter(x => x.table_name === 'permissions').map(x => [x.action, JSON.stringify(x.new_data)]), [['UPDATE', JSON.stringify([{ role: 'bookkeeper', perms: ['books:read'] }])]], []);
    eq('ledger rebuild (not a dry run) → ledger_entries RECALC', t.filter(x => x.table_name === 'ledger_entries').map(x => x.action), ['RECALC'], []);
    await since();
    await J('POST', '/api/gl/backfill?dry=1', {});
    eq('a DRY-RUN ledger rebuild changes nothing → no row', (await rows()).filter(x => x.table_name === 'ledger_entries').length, 0);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally {
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
