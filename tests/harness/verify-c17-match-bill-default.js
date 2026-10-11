'use strict';
/**
 * C17 (Cowork end-to-end test): on Bank Rec, each money-out line's "match to bill" dropdown pre-selects the bill it
 * most likely pays — the bill whose remaining balance equals the line, else the bill whose vendor the bank names.
 * BUG: every dropdown defaulted to the FIRST open bill, so a one-click match paid the wrong bill.
 * Seed: clientMoneyKit (open bill Supply Co 400) + open bill Alpha Print 75 (listed FIRST — measured) + bank debits
 *   SUPPLY CO REF 123 → Supply Co (vendor named in the bank line)   bug: Alpha Print (first)
 *   ALPHA PRINT INV 75 → Alpha Print (amount match; control — also first)
 */
const { run } = require('./clientMoneyKit.js');

run('C17 — match-bill dropdown pre-selects the right bill', async ({ w, d, settle, eq, http }) => {
  try { w.showPage('bank-rec'); } catch (_) {}
  await settle(20, 60);
  if (typeof w.loadBankRec === 'function') { await w.loadBankRec(); await settle(10, 40); }
  const lines = (await http.get('/api/banking')).json || [];
  const sel = desc => { const l = lines.find(x => x.description === desc); const s = l && d.getElementById('brec-bill-' + l.id); return s && s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent.split(' - ')[0] : null; };
  eq('SUPPLY CO REF 123 → Supply Co', sel('SUPPLY CO REF'), 'Supply Co', 'Alpha Print');
  eq('control: ALPHA PRINT INV 75 → Alpha Print', sel('ALPHA PRINT INV'), 'Alpha Print');
}, { extraSeed: async ({ http }) => {
  const r = await http.request('POST', '/api/bills', { vendor: 'Alpha Print', amount: 75, status: 'unpaid', issue_date: '2026-07-05', due_date: '2026-08-05', idempotency_key: 'c17-b' });
  if (r.status >= 300) throw new Error('bill ' + r.status);
  const i = await http.request('POST', '/api/banking/import', { format: 'csv', content: 'Date,Description,Amount\n2026-07-08,ALPHA PRINT INV,-75.00\n2026-07-09,SUPPLY CO REF,-123.00\n' });
  if (i.status >= 300) throw new Error('import ' + i.status);
} });
