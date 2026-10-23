'use strict';
/**
 * verify-g4-bankrec-suggestions.js — G4 (gap investigation 2026-10-22; live: a $5,850 debit arrived with a $44 bill
 * already selected). Bank-rec match suggestions, BOTH pickers (Rule 13 — one class):
 *   money out → "match to bill" dropdown: C17 preselected amount → vendor → the FIRST open bill. With no candidate the
 *     first bill was a guess, already selected — one click booked the wrong match. Ties were broken silently.
 *   money in → recorded invoice payments: no suggestion at all.
 * Fix: ONE scorer (amount, the name on the bank line, date) that says WHY, preselects only a clear winner, never a guess.
 *
 * The REAL SPA in jsdom against the real server. clientMoneyKit seed: open bill Supply Co 400 (due 2026-07-10);
 * invoice payments Acme Ltd 250 (2026-07-03) and Beta Co 300 (2026-06-05). Extra seed: bills Alpha Print 75,
 * Tiny Co 44, Mini Co 44; bank lines (CSV):
 *   ACH TRANSFER 5850  −5,850  no candidate        → nothing selected, says no bill matches     bug: first bill selected
 *   SUPPLY CO REF 123  −123    vendor named          → Supply Co, "vendor named on the line"       (C17 parity)
 *   ALPHA PRINT INV 75 −75     amount + vendor       → Alpha Print, "exact amount"
 *   CARD PAYMENT       −44     two bills of 44       → nothing selected, "2 bills match equally"   bug: Tiny Co guessed
 *   ACME LTD PAYMENT   +250    payment of 250, named → selecting it puts Acme Ltd first, marked Suggested   bug: no mark
 */
const { run } = require('./clientMoneyKit.js');

run('G4 — bank-rec suggestions rank, explain, and never preselect a guess', async ({ w, d, settle, eq, A, http }) => {
  try { w.showPage('bank-rec'); } catch (_) {}
  await settle(20, 60);
  if (typeof w.loadBankRec === 'function') { await w.loadBankRec(); await settle(10, 40); }
  const lines = (await http.get('/api/banking')).json || [];
  const line = desc => lines.find(x => String(x.description || '').indexOf(desc) === 0);
  const sel = desc => { const l = line(desc); return l && d.getElementById('brec-bill-' + l.id); };
  const chosen = desc => { const s = sel(desc); const o = s && s.options[s.selectedIndex]; return o && o.value ? o.textContent.replace(/^★\s*/, '').split(' - ')[0].trim() : ''; };
  const why = desc => { const l = line(desc); const e = l && d.getElementById('brec-why-' + l.id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };

  eq('1  ACH TRANSFER 5850: no bill fits → nothing preselected', chosen('ACH TRANSFER'), '', 'Mini Co (the first open bill)');
  A('1b …and the line says no bill matches', /no open bill matches/i.test(why('ACH TRANSFER')), JSON.stringify(why('ACH TRANSFER')));
  eq('2  SUPPLY CO REF 123 → Supply Co (vendor named; C17 parity)', chosen('SUPPLY CO REF'), 'Supply Co');
  A('2b …says why: vendor named on the line', /vendor named on the line/.test(why('SUPPLY CO REF')), JSON.stringify(why('SUPPLY CO REF')));
  eq('3  ALPHA PRINT INV 75 → Alpha Print', chosen('ALPHA PRINT INV'), 'Alpha Print');
  A('3b …says why: exact amount + vendor named', /exact amount/.test(why('ALPHA PRINT INV')) && /vendor named/.test(why('ALPHA PRINT INV')), JSON.stringify(why('ALPHA PRINT INV')));
  eq('4  CARD PAYMENT 44 with two bills of 44 → nothing preselected (a tie is not a guess)', chosen('CARD PAYMENT'), '', 'Mini Co');
  A('4b …says 2 bills match equally', /2 bills match equally/.test(why('CARD PAYMENT')), JSON.stringify(why('CARD PAYMENT')));
  const s4 = sel('CARD PAYMENT');
  const firstReal = s4 ? [...s4.options].filter(o => o.value).slice(0, 2).map(o => o.textContent.replace(/^★\s*/, '').split(' - ')[0].trim()).sort() : [];
  eq('4c …and lists both 44 bills first', firstReal, ['Mini Co', 'Tiny Co']);

  // a click on "Match bill" with nothing chosen books nothing
  const handled = async () => (((await http.get('/api/bank-reconciliation')).json || {}).handled || []).length;
  const h0 = await handled();
  const l4 = line('CARD PAYMENT');
  if (l4) { w.ffBankMatchBill(l4.id); await settle(10, 50); }
  eq('5  "Match bill" on the tied 44 line with nothing chosen books nothing', await handled(), h0, h0 + 1);
  const l1 = line('ACH TRANSFER');
  if (l1) { w.ffBankMatchBill(l1.id); await settle(10, 50); }
  eq('5b control: the 5,850 line books nothing either (the server also refuses a payment above a bill\'s balance)', await handled(), h0);

  // money in: selecting the bank credit ranks the recorded payments
  const cr = line('ACME LTD PAYMENT');
  if (cr) { w.selectBankTx(cr.id, d.getElementById('bbtx-' + cr.id)); await settle(6, 40); }
  const payRows = [...(d.getElementById('brec-pay-list') || { querySelectorAll: () => [] }).querySelectorAll('.tx-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
  A('6  money in: Acme Ltd 250 is listed first for the ACME LTD PAYMENT +250 line', /Acme Ltd/.test(payRows[0] || ''), JSON.stringify(payRows));
  A('6b …marked Suggested with its reason (exact amount, customer named)', /Suggested/.test(payRows[0] || '') && /exact amount/.test(payRows[0] || '') && /customer named on the line/.test(payRows[0] || ''), JSON.stringify(payRows[0]));
  A('6c …and Beta Co 300 is not marked', payRows.length > 1 && !/Suggested/.test(payRows.find(r => /Beta Co/.test(r)) || 'x'), JSON.stringify(payRows));
}, { extraSeed: async ({ http }) => {
  const P = async (p, b) => { const r = await http.request('POST', p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); };
  await P('/api/bills', { vendor: 'Alpha Print', amount: 75, status: 'unpaid', issue_date: '2026-07-05', due_date: '2026-08-05', idempotency_key: 'g4-b1' });
  await P('/api/bills', { vendor: 'Tiny Co', amount: 44, status: 'unpaid', issue_date: '2026-07-06', due_date: '2026-08-06', idempotency_key: 'g4-b2' });
  await P('/api/bills', { vendor: 'Mini Co', amount: 44, status: 'unpaid', issue_date: '2026-07-06', due_date: '2026-08-06', idempotency_key: 'g4-b3' });
  await P('/api/banking/import', { format: 'csv', content: 'Date,Description,Amount\n2026-07-08,ALPHA PRINT INV 75,-75.00\n2026-07-09,SUPPLY CO REF 123,-123.00\n2026-07-12,ACH TRANSFER 5850,-5850.00\n2026-07-14,CARD PAYMENT,-44.00\n2026-07-04,ACME LTD PAYMENT,250.00\n' });
} });
