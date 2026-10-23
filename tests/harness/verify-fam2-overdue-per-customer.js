'use strict';
/**
 * verify-fam2-overdue-per-customer.js — FA-M2 (full app audit 2026-10-22 M2). "Overdue" netted EVERY open credit note of
 * the business against the overdue total, so one customer's unrelated credit hid another customer's past-due money
 * (live: Bright Labs owes $1,500 past due; Acme's unapplied $300 credit made Overdue read $1,200 on the Dashboard,
 * Invoices, Payments Received, the AR report and the AI context — the Reminders page, which works per invoice, said $1,500).
 * Rule now: a credit note reduces only ITS OWN customer's overdue (matched by the one contact key of batch 9 — case and
 * spacing never split a customer), never below 0; a credit larger than that customer's overdue cannot spill onto anyone
 * else. Overdue stays ≤ Outstanding (L35). Both writers: the server (computeBooks.arSummary → /api/reports, the AR
 * report, the accountant portal, the AI context) and the client (arOutstanding → Dashboard, Invoices, Payments Received).
 *
 * Seed (UTC entity; clock pinned 2026-07-25), through the real routes:
 *   Bright Labs  INV 1,500  issued 06-01 due 07-04 (past due)
 *   Acme         INV   900  issued 07-10 due 08-09 (not due)      CN 300 open 07-12 "Acme"
 *   Gamma        INV   400  issued 06-05 due 07-01 (past due)     CN 150 open 07-13 "  GAMMA " (same customer, other spelling)
 *   Delta        INV   200  issued 06-06 due 07-02 (past due)     CN 500 open 07-14 "Delta"
 *                INV   600  issued 07-15 due 08-14 (not due)
 * HAND-COMPUTED (Rule 6):
 *   outstanding = (1,500 + 900 + 400 + 200 + 600) − (300 + 150 + 500) = 3,600 − 950 = 2,650
 *   overdue     = Bright 1,500 + Gamma (400 − 150) 250 + Delta max(0, 200 − 500) 0 = 1,750        (3 invoices past due)
 * BUGGY VALUES (Rule 4 — each differs from 1,750):
 *   global netting (the bug)                 2,100 − 950            = 1,150
 *   per customer, names NOT normalised       1,500 + 400 + 0        = 1,900
 *   per customer, excess credit spills over  1,750 − (500 − 200)    = 1,450
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const amounts = t => (String(t || '').match(/\$\s?-?[\d,]+(?:\.\d+)?/g) || []).map(s => parseFloat(s.replace(/[^\d.\-]/g, '')));
const OUT = 2650, OVD = 1750;

async function seed({ http }) {
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
  const ent = J(await http.post('/api/entities', { name: 'Overdue Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
  J(await http.post('/api/entities/' + ent.id + '/activate', {}));
  const inv = (client, amount, issue, due, k) => http.post('/api/invoices', { client, amount, status: 'pending', issue_date: issue, due_date: due, idempotency_key: 'fam2-' + k });
  J(await inv('Bright Labs', 1500, '2026-06-01', '2026-07-04', 1));
  J(await inv('Acme', 900, '2026-07-10', '2026-08-09', 2));
  J(await inv('Gamma', 400, '2026-06-05', '2026-07-01', 3));
  J(await inv('Delta', 200, '2026-06-06', '2026-07-02', 4));
  J(await inv('Delta', 600, '2026-07-15', '2026-08-14', 5));
  const cn = (customer, amount, date, k) => http.post('/api/credit-notes', { customer, amount, date, status: 'Open', num: 'CN-' + k, reason: 'test', idempotency_key: 'fam2-cn-' + k });
  J(await cn('Acme', 300, '2026-07-12', 1));
  J(await cn('  GAMMA ', 150, '2026-07-13', 2));
  J(await cn('Delta', 500, '2026-07-14', 3));
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  FA-M2 — a credit note nets only its own customer\'s overdue\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, http, settle, text } = ctx;

    const rep = JSON.parse((await http.get('/api/reports')).text);
    A('server /api/reports: outstanding 2,650 (unchanged by this fix)', near(rep.outstanding, OUT), 'outstanding=' + rep.outstanding);
    A('server /api/reports: overdue 1,750 (bug 1,150; un-normalised 1,900; spill-over 1,450)', near(rep.overdue, OVD), 'overdue=' + rep.overdue);
    const ar = JSON.parse((await http.get('/api/reports/ar-by-customer')).text);
    A('server AR report: overdueTotal 1,750 · 3 invoices past due', near(ar.overdueTotal, OVD) && ar.overdueCount === 3, 'overdueTotal=' + ar.overdueTotal + ' count=' + ar.overdueCount);

    await settle(60, 100);
    const c = w._arOutstanding(w._realInvoices || w.invoices || []);
    A('client arOutstanding: total 2,650 · overdue 1,750 (the dashboard / Invoices / Payments Received writer)', near(c.total, OUT) && near(c.overdueTotal, OVD), JSON.stringify(c));

    w.showPage('dashboard'); await settle(25, 100);
    const sub = text('d-outstanding-chg');
    A('Dashboard Outstanding sub-line: "3 overdue · $1,750"', /3 overdue/.test(sub) && amounts(sub).some(v => near(v, OVD)), 'd-outstanding-chg=' + sub);
    w.showPage('invoices'); await settle(25, 100);
    A('Invoices page "Overdue" card: $1,750', amounts(text('inv-over')).some(v => near(v, OVD)), 'inv-over=' + text('inv-over'));
    A('Invoices page "Outstanding" card: $2,650', amounts(text('inv-out')).some(v => near(v, OUT)), 'inv-out=' + text('inv-out'));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-M2 overdue per customer)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
