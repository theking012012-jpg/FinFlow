'use strict';
/**
 * verify-b7-reconciliation-saved.js — B7b + G2 (gap investigation 2026-10-22).
 *
 * "Finish reconciliation" kept the result in a JS object (lost on reload): no reconciliation was ever saved, so no
 * reconciliation report could exist, and the cleared lines stayed freely deletable. Its toast was a hard-coded
 * "Main Checking ✓" (an LR16 residue) and its refusal a literal "$0.00".
 * Fix (better than standard): a saved reconciliation per business — statement date, statement balance, the lines it
 * cleared, who, when; the SERVER recomputes the difference (prior cleared + newly ticked) and refuses anything but 0;
 * cleared lines LOCK (delete refused, saying which reconciliation holds them); undo is latest-first and audited; a
 * Bank Reconciliation report lists them.
 *
 * The REAL SPA in jsdom against the real server. Seed (CSV): DEPOSIT +1,000 (07-01), BANK FEE −35 (07-02),
 * RENT −200 (07-05). EXPECTED (by hand):
 *   rec 1: tick DEPOSIT + FEE, statement 965 (20 Jul)   → saved, cleared 965, 2 lines     bug: nothing saved
 *   reopen → those 2 lines ticked AND locked                                           bug: unticked, editable
 *   rec 2: tick RENT, statement 765 (prior 965 − 200)  → saved                           bug: nothing saved
 *   API statement 500, nothing ticked → 400, difference −265 (500 − 765)
 *   delete a cleared line → 409, names the reconciliation                                  bug: 200, line gone
 *   undo rec 1 while rec 2 stands → 409; undo rec 2 → RENT unlocked
 */
const { run } = require('./clientMoneyKit.js');
let bizB = null;

run('B7b/G2 — reconciliations are saved, locked, undoable and reported', async ({ w, d, settle, eq, A, http }) => {
  const msgs = []; const _n = w.notify; w.notify = (m, e) => { msgs.push(String(m)); try { _n(m, e); } catch (_) {} };
  if (typeof w.loadBankingFromDB === 'function') { await w.loadBankingFromDB(); await settle(6, 40); }
  const lines = (await http.get('/api/banking')).json || [];
  const L = desc => lines.find(x => String(x.description || '').indexOf(desc) === 0) || {};
  const recs = async () => { const r = await http.get('/api/bank-reconciliation/statements'); return (r.status === 200 && r.json && r.json.reconciliations) || []; };
  const boxOf = desc => {
    const id = L(desc).id; let b = d.querySelector('#recon-txn-list input[data-id="' + id + '"]');
    if (!b) { const i = (w.eval('bankTxns') || []).findIndex(t => t._dbId === id); b = d.querySelector('#recon-txn-list input[data-idx="' + i + '"]'); }
    return b;
  };
  const finish = async (ticks, stmtDate, stmtBal) => {
    w.openReconcileModal(); await settle(10, 40);
    for (const t of ticks) { const b = boxOf(t); if (b) b.checked = true; }
    const sd = d.getElementById('recon-stmt-date'); if (sd) sd.value = stmtDate;
    d.getElementById('recon-stmt-bal').value = String(stmtBal); w.updateReconSummary();
    await w.finishReconciliation(); await settle(15, 50);
  };

  await finish(['DEPOSIT', 'BANK FEE'], '2026-07-20', 965);
  const r1 = await recs();
  eq('1  the reconciliation is SAVED on the server', r1.length, 1, 0);
  const s1 = r1[0] || {};
  eq('1b statement date, statement balance, cleared total and line count are kept', [s1.statement_date, s1.statement_balance, s1.cleared_total, (s1.lines || []).length], ['2026-07-20', 965, 965, 2], 'nothing');
  const toast = msgs.slice(-1)[0] || '';
  A('2  the confirmation names the business, not a hard-coded "Main Checking"', /Business A/.test(toast) && !/Main Checking/.test(toast), JSON.stringify(toast));

  w.openReconcileModal(); await settle(10, 40);
  const dep = boxOf('DEPOSIT'), fee = boxOf('BANK FEE'), rent = boxOf('RENT');
  eq('3  reopening: the cleared lines are ticked and LOCKED; RENT is open', [!!(dep && dep.checked && dep.disabled), !!(fee && fee.checked && fee.disabled), !!(rent && !rent.checked && !rent.disabled)], [true, true, true], [false, false, true]);
  try { w.closeModal('reconcile-modal'); } catch (_) {}

  await finish(['RENT'], '2026-07-31', 765);
  const r2 = await recs();
  eq('4  second reconciliation (statement 765 = 965 cleared before − 200) is saved', r2.length, 2, 0);

  msgs.length = 0;
  w.openReconcileModal(); await settle(10, 40);
  d.getElementById('recon-stmt-bal').value = '500'; w.updateReconSummary();
  await w.finishReconciliation(); await settle(8, 40);
  A('5  finishing with a difference says how far off it is', /265\.00/.test(msgs.join(' | ')), JSON.stringify(msgs));
  try { w.closeModal('reconcile-modal'); } catch (_) {}
  const bad = await http.post('/api/bank-reconciliation/statements', { statement_date: '2026-08-01', statement_balance: 500, line_ids: [], idempotency_key: 'b7-bad' });
  eq('5b the server refuses an unbalanced save itself (difference 500 − 765 = −265)', [bad.status, (bad.json || {}).code, (bad.json || {}).difference], [400, 'NOT_BALANCED', -265], [404, undefined, undefined]);

  const del = await http.request('DELETE', '/api/banking/' + L('BANK FEE').id);
  eq('6  deleting a reconciled line is refused', del.status, 409, 200);
  A('6b …saying which reconciliation holds it and how to undo it', /20 Jul 2026|Jul 20/.test((del.json || {}).error || '') && /undo/i.test((del.json || {}).error || ''), JSON.stringify(del.json));

  const ids = (await recs()).map(r => r.id).sort((a, b) => a - b);
  eq('7  undoing the OLDER reconciliation while a later one stands is refused', (await http.post('/api/bank-reconciliation/statements/' + ids[0] + '/undo', {})).status, 409, 404);
  eq('7b undoing the latest → HTTP 200', (await http.post('/api/bank-reconciliation/statements/' + ids[1] + '/undo', {})).status, 200, 404);
  const after = await recs();
  eq('7c it is kept as undone (history never deleted) and RENT is unlocked', [(after.find(r => r.id === ids[1]) || {}).status, ((await http.get('/api/banking')).json || []).find(x => x.id === L('RENT').id).reconciliation_id == null], ['undone', true]);

  await w.generateReport('Bank Reconciliation'); await settle(15, 50);
  const rpt = ((d.getElementById('rpt-body') || {}).textContent || '').replace(/\s+/g, ' ');
  A('8  the Bank Reconciliation report lists the saved reconciliation (965.00, 2 lines, 20 Jul)', /965\.00/.test(rpt) && /2 lines/.test(rpt) && /Jul 20|20 Jul/.test(rpt), rpt.slice(0, 300));
  A('8b …and shows the undone one as undone', /undone/i.test(rpt), rpt.slice(0, 300));

  const audit = ((await http.get('/api/audit-log?limit=500')).json || []);
  const rows = (Array.isArray(audit) ? audit : (audit.rows || [])).filter(e => e.table_name === 'bank_reconciliations');
  eq('9  audited: 2 CREATE + 1 UNDO on bank_reconciliations', [rows.filter(e => e.action === 'CREATE').length, rows.filter(e => e.action === 'UNDO').length], [2, 1], [0, 0]);

  // Business B is created in the seed (straight in the DB — the seeded plan allows one business through the API).
  eq('10 premise: switched to Business B', (await http.post('/api/entities/' + bizB + '/activate', {})).status, 200);
  eq('10b premise: Business B\'s bank feed is its own (empty)', ((await http.get('/api/banking')).json || []).length, 0);
  eq('10c another business sees none of these reconciliations', (await recs()).length, 0);
}, { extraSeed: async ({ http, client, userId }) => {
  bizB = (await client.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2) RETURNING id`, [userId, { name: 'Business B', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 0 }])).rows[0].id;
  const r = await http.request('POST', '/api/banking/import', { format: 'csv', content: 'Date,Description,Amount\n2026-07-01,DEPOSIT CLIENT,1000.00\n2026-07-02,BANK FEE JUL,-35.00\n2026-07-05,RENT JULY,-200.00\n' });
  if (r.status >= 300) throw new Error('import ' + r.status + ' ' + String(r.text).slice(0, 160));
} });
