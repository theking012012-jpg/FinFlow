'use strict';
/**
 * verify-n3-1-receivable-g13.js — N3-1 / N3-2 (live re-audit 2026-11-11).
 *
 * FA-M2 made overdue net only each customer's OWN credits, but the H1 cap then clamped it to `outstanding` — and
 * `outstanding` is net of EVERY credit. When a credit belongs to a customer who owes nothing (G13: a "Customer deposit"),
 * that credit still lowered everyone's overdue through the cap (live: Bright 1,500 + Delta 1,200 past due read 2,400 because
 * of Acme's 300 credit; Acme's only invoice was paid). The same net figure was shown as Outstanding, while the balance
 * sheet (G13) shows AR grossed up — so Dashboard Outstanding ≠ BS AR (F58's invariant), and the AR report listed a
 * negative "Acme −300" row under a total its rows did not add up to.
 * Rule now: the RECEIVABLE = Σ over customers max(0, open − own credits) == balance-sheet AR; overdue is capped by it.
 * `books.outstanding` stays NET (the GL reconciliation compares it with ledger AR) — not asserted here.
 *
 * Why FA-M2's harness missed it (Rule 4): every customer there with a credit also owed money, and its outstanding (2,650)
 * stayed above its overdue (1,750), so the cap never bound.
 *
 * Seed (UTC entity, clock pinned 2026-07-25), through the real routes:
 *   Bright Labs INV 1,500  issued 06-01 due 07-04 (past due)
 *   Delta Co    INV 1,200  issued 06-10 due 07-10 (past due)
 *   Gamma       INV   400  issued 06-05 due 07-01 (past due)     CN 150 open 07-13 (Gamma still owes 250)
 *   Acme Corp   INV   900  issued 05-01 due 05-31, PAID in full 05-20      CN 300 open 07-12 (Acme owes nothing → deposit)
 * HAND-COMPUTED (Rule 6):
 *   receivable (== BS AR)  = 1,500 + 1,200 + (400 − 150) = 2,950          customer deposits = 300
 *   overdue                = 1,500 + 1,200 + 250        = 2,950          (3 invoices past due)
 * BUGGY VALUES (Rule 4):
 *   Outstanding / AR total = 3,100 − 450 = 2,650   (net of every credit)
 *   overdue                = min(2,650, 2,950) = 2,650   (the cap)
 *   AR report rows         include "Acme Corp −300"; Σ rows 2,650 ≠ total
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const amounts = t => (String(t || '').match(/\$\s?-?[\d,]+(?:\.\d+)?/g) || []).map(s => parseFloat(s.replace(/[^\d.\-]/g, '')));
const REC = 2950, OVD = 2950, DEP = 300;

async function seed({ http }) {
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 200)); return JSON.parse(r.text); };
  const ent = J(await http.post('/api/entities', { name: 'Receivable Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
  J(await http.post('/api/entities/' + ent.id + '/activate', {}));
  const inv = (client, amount, issue, due, k) => http.post('/api/invoices', { client, amount, status: 'pending', issue_date: issue, due_date: due, idempotency_key: 'n31-' + k });
  J(await inv('Bright Labs', 1500, '2026-06-01', '2026-07-04', 1));
  J(await inv('Delta Co', 1200, '2026-06-10', '2026-07-10', 2));
  J(await inv('Gamma', 400, '2026-06-05', '2026-07-01', 3));
  const acme = J(await inv('Acme Corp', 900, '2026-05-01', '2026-05-31', 4));
  J(await http.post('/api/invoice-payments', { invoice_id: acme.id, amount: 900, payment_date: '2026-05-20', idempotency_key: 'n31-p1' }));
  const cn = (customer, amount, date, k) => http.post('/api/credit-notes', { customer, amount, date, status: 'Open', num: 'CN-' + k, reason: 'test', idempotency_key: 'n31-cn-' + k });
  J(await cn('Acme Corp', 300, '2026-07-12', 1));
  J(await cn('Gamma', 150, '2026-07-13', 2));
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  N3-1 / N3-2 — the receivable is per customer (G13); overdue is capped by it\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, http, settle, text } = ctx;

    const rep = JSON.parse((await http.get('/api/reports')).text);
    A('server /api/reports: outstanding 2,950 (bug 2,650)', near(rep.outstanding, REC), 'outstanding=' + rep.outstanding);
    A('server /api/reports: overdue 2,950 (bug 2,650 — the cap)', near(rep.overdue, OVD), 'overdue=' + rep.overdue);

    const ar = JSON.parse((await http.get('/api/reports/ar-by-customer')).text);
    const rowsSum = (ar.rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    A('server AR report: total 2,950 · overdueTotal 2,950 · 3 past due (bug 2,650 / 2,650)', near(ar.total, REC) && near(ar.overdueTotal, OVD) && ar.overdueCount === 3, JSON.stringify({ total: ar.total, overdueTotal: ar.overdueTotal, overdueCount: ar.overdueCount }));
    A('server AR report: rows add up to the total (bug: Σ 2,650 with an "Acme Corp −300" row)', near(rowsSum, ar.total) && !(ar.rows || []).some(r => Number(r.amount) < 0), JSON.stringify(ar.rows));

    const bs = JSON.parse((await http.post('/api/reports/balance-sheet', {})).text || '{}');
    A('balance sheet AR 2,950 · Customer deposits 300 (G13, unchanged by this fix)', near(bs.accountsReceivable, REC) && near(bs.customerDeposits, DEP), JSON.stringify({ ar: bs.accountsReceivable, dep: bs.customerDeposits }));
    A('F58 parity restored: /api/reports outstanding == balance-sheet AR (bug 2,650 vs 2,950)', near(rep.outstanding, bs.accountsReceivable), rep.outstanding + ' vs ' + bs.accountsReceivable);

    await settle(60, 100);
    const c = w._arOutstanding(w._realInvoices || w.invoices || []);
    A('client arOutstanding: total 2,950 · overdue 2,950 (bug 2,650 / 2,650)', near(c.total, REC) && near(c.overdueTotal, OVD), JSON.stringify(c));
    A('client arOutstanding: caption credit = 150 (Gamma\'s, the one that reduced a receivable); deposit 300 kept out', near(c.creditTotal, 150) && near(c.depositTotal, DEP), JSON.stringify({ creditTotal: c.creditTotal, depositTotal: c.depositTotal }));

    w.showPage('dashboard'); await settle(25, 100);
    const sub = text('d-outstanding-chg');
    A('Dashboard Outstanding sub-line: "3 overdue · $2,950" (bug $2,650)', /3 overdue/.test(sub) && amounts(sub).some(v => near(v, OVD)), 'd-outstanding-chg=' + sub);
    w.showPage('invoices'); await settle(25, 100);
    A('Invoices "Overdue" card: $2,950 (bug $2,650)', amounts(text('inv-over')).some(v => near(v, OVD)), 'inv-over=' + text('inv-over'));
    A('Invoices "Outstanding" card: $2,950 (bug $2,650)', amounts(text('inv-out')).some(v => near(v, REC)), 'inv-out=' + text('inv-out'));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e && e.errors) e.errors.forEach(x => console.log('    ' + (x && x.stack || x)));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-1 receivable per customer)'));
  process.exit(fail ? 1 : 0);
})();
