'use strict';
/**
 * LR16 (live retest C13 / B7): Bank Rec showed no statement or book balance; 3 debits (TRANSFER TO SAVINGS 500, PAPER
 * SUPPLY CO 650, BANK FEE 35) appeared in no list; Banking "TOTAL BALANCE $0" with a linked bank.
 * Read: (1) a debit that was HANDLED (booked as an expense / matched to a bill / ignored) carries reconcile_state and is
 * dropped from every list — it vanished; (2) the Reconcile modal never writes "Book balance", sums every line as a
 * POSITIVE amount (debits added), measures the difference the wrong way round, and prints "Main Checking ****4821";
 * (3) Banking's Total Balance sums `bankAccounts`, which nothing ever fills → always "$0" (a fabricated balance).
 *
 * Real SPA in jsdom → real server → scratch Postgres. One business, four bank lines through the real route:
 *   DEPOSIT +1,000 (credit) · BANK FEE −35 → booked as expense · PAPER SUPPLY CO −650 → matched to a 650 bill ·
 *   TRANSFER TO SAVINGS −500 → ignored.     Book balance of the lines = 1,000 − 35 − 650 − 500 = −185.
 *   1  Bank Rec lists the 3 handled lines with what was done (expense / bill / ignored)     bug: in no list
 *   2  Reconcile modal Book balance = −185                                                   bug: "—"
 *   3  tick DEPOSIT + BANK FEE, statement 965 → difference 0, "Balanced"                     bug: −185 off (wrong sign + direction)
 *   4  modal names this business, not "Main Checking ****4821"                               bug: Main Checking ****4821
 *   5  Banking Total Balance is "—" (no account reports a balance), never "$0"                bug: "$0"
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  — ' + det : ''))); };
  console.log('\nLR16 — Bank Rec: handled lines visible, real book balance, honest totals\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status} ${String(r.text).slice(0, 200)}`); return r.json; };
      const e = (await J('POST', '/api/entities', { name: 'Harbour Co', currency: 'USD', timezone: 'UTC', country: 'US' })).id;
      await J('POST', '/api/entities/' + e + '/activate', {});
      await J('POST', '/api/banking', { desc: 'DEPOSIT', amount: 1000, type: 'credit', date: '2026-07-02', idempotency_key: 'lr16-d' });
      const fee = await J('POST', '/api/banking', { desc: 'BANK FEE', amount: 35, type: 'debit', date: '2026-07-03', idempotency_key: 'lr16-f' });
      const pap = await J('POST', '/api/banking', { desc: 'PAPER SUPPLY CO', amount: 650, type: 'debit', date: '2026-07-04', idempotency_key: 'lr16-p' });
      const trn = await J('POST', '/api/banking', { desc: 'TRANSFER TO SAVINGS', amount: 500, type: 'debit', date: '2026-07-05', idempotency_key: 'lr16-t' });
      const bill = await J('POST', '/api/bills', { vendor: 'Paper Supply Co', amount: 650, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-07-30', idempotency_key: 'lr16-b' });
      await J('POST', '/api/bank-reconciliation/book-expense', { banking_id: fee.id, category: 'Bank fees' });
      await J('POST', '/api/bank-reconciliation/match-bill', { banking_id: pap.id, bill_id: bill.id });
      await J('POST', '/api/bank-reconciliation/ignore', { banking_id: trn.id });
    } });
    const { window: w, settle } = boot;
    const d = w.document;
    await settle(60, 75);
    try { w.showPage('bank-rec'); } catch (_) {}
    try { await w.loadBankRec(); } catch (e) { console.log('    loadBankRec threw ' + e.message); }
    await settle(30, 60);
    const page = ((d.getElementById('page-bank-rec') || d.body).textContent || '').replace(/\s+/g, ' ');
    const handled = ((d.getElementById('brec-handled-list') || {}).textContent || '').replace(/\s+/g, ' ');
    A('1  the 3 handled lines are listed with what was done', /BANK FEE/.test(handled) && /PAPER SUPPLY CO/.test(handled) && /TRANSFER TO SAVINGS/.test(handled)
      && /expense/i.test(handled) && /bill/i.test(handled) && /ignored/i.test(handled), JSON.stringify(handled.slice(0, 200)) + ' / on page: ' + /TRANSFER TO SAVINGS/.test(page));

    try { w.showPage('banking'); } catch (_) {}
    try { await w.loadBankingFromDB(); } catch (_) {}
    await settle(30, 60);
    const tot = ((d.getElementById('bank-total-bal') || {}).textContent || '').trim();
    A('5  Banking Total Balance is "—" when no account reports a balance', tot === '—', JSON.stringify(tot));
    w.openReconcileModal(); await settle(5, 30);
    const book = ((d.getElementById('recon-book-bal') || {}).textContent || '').trim();
    A('2  Reconcile: Book balance −185', /-\s?\$185(\.00)?$/.test(book) || /\$-185/.test(book), JSON.stringify(book));
    const rows = [...d.querySelectorAll('#recon-txn-list label')];
    rows.forEach(l => { if (/DEPOSIT|BANK FEE/.test(l.textContent)) { const cb = l.querySelector('input'); cb.checked = true; } });
    d.getElementById('recon-stmt-bal').value = '965';
    w.updateReconSummary(); await settle(2, 20);
    const diff = ((d.getElementById('recon-diff') || {}).textContent || '').trim();
    const st = ((d.getElementById('recon-status') || {}).textContent || '').trim();
    A('3  ticked DEPOSIT + BANK FEE, statement 965 → difference 0, Balanced', /^\$?0\.00$|\$0\.00/.test(diff) && /Balanced/.test(st), JSON.stringify({ diff, st }));
    const sub = ((d.getElementById('recon-sub') || {}).textContent || '');
    A('4  modal names this business, not "Main Checking ****4821"', !/4821|Main Checking/.test(sub) && /Harbour Co/.test(sub), JSON.stringify(sub));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
