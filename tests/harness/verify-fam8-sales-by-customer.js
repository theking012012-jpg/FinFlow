'use strict';
/**
 * verify-fam8-sales-by-customer.js — FA-M8 (full app audit M8: "Sales by Customer lumps Acme's −$300 credit note into
 * 'Cash sales / credits (unattributed)'; Acme shows $12,000 instead of $11,700"). The report grouped INVOICES only by
 * customer; credit notes and cash sales receipts — which carry a customer — fell into one unattributed remainder, and
 * "Acme" / "ACME " were two customers.
 * After: every revenue leg that names a customer is attributed to that customer (invoices +, sales receipts +, credit
 * notes −), customer names match case- and space-insensitively, and only what has no customer stays apart — named for
 * what it is. Σ rows == Total Revenue (the canonical computeRevenue).
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres, NO base seed. Clock 2026-07-25, fiscal year to date.
 *   invoices: Acme 12,000 · "ACME " 500 · Beta Co 1,000 (paid)
 *   credit note: Acme −300 (Open)          sales receipts: Beta Co 200 · no customer 150
 *   EXPECTED by hand: Acme 12,200 · Beta Co 1,200 · "Cash sales — no customer" 150 · Total 13,550
 *   bug: Acme 12,000 · ACME 500 · Beta Co 1,000 · unattributed 50 (= 200 + 150 − 300)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam8-sales-by-customer.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({
      baseSeed: false,
      seedExtra: async (c, uid) => {
        const ent = (await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2) RETURNING id`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
        const ins = (t, d) => c.query(`INSERT INTO ${t} (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`, [uid, ent, d]);
        await ins('invoices', { client: 'Acme', amount: 12000, status: 'pending', issue_date: '2026-07-05' });
        await ins('invoices', { client: 'ACME ', amount: 500, status: 'pending', issue_date: '2026-07-07' });
        await ins('invoices', { client: 'Beta Co', amount: 1000, status: 'paid', amount_paid: 1000, issue_date: '2026-07-06' });
        await ins('credit_notes', { customer: 'Acme', amount: 300, status: 'Open', date: '2026-07-10' });
        await ins('sales_receipts', { customer: 'Beta Co', amount: 200, date: '2026-07-08' });
        await ins('sales_receipts', { customer: '', amount: 150, date: '2026-07-09' });
      },
    });
    const { window, settle } = boot;
    for (let i = 0; i < 250 && typeof window.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    try { window.currentPeriod = 'year'; } catch (_) {}
    await window.generateReport('Sales by Customer');
    await settle(25, 60);
    const body = window.document.getElementById('rpt-body');
    const txt = (body ? body.textContent : '').replace(/\s+/g, ' ');
    const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const has = (label, amt) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^$]{0,40}\\$' + Number(amt).toLocaleString('en-US').replace(/,/g, ',') + '(\\.00)?(?![\\d,])').test(txt);   // the next label may start straight after the figure
    console.log('  [report] ' + txt.slice(0, 400));
    A('1  Acme (the spelling with the most revenue) $12,200 = 12,000 + 500 ("ACME ") − 300 credit note (bug: $12,000)', has('Acme', 12200) && !/ACME/.test(txt), '');
    A('2  "ACME " is not a second customer', !/ACME /.test(txt.replace(/Acme/g, '')), '');
    A('3  Beta Co $1,200 = invoice 1,000 + cash sale 200 (bug: $1,000)', has('Beta Co', 1200), '');
    A('4  the sale with no customer stands apart, named: "Cash sales — no customer" $150 (bug: "unattributed" $50)', has('Cash sales — no customer', 150) && !/unattributed/i.test(txt), '');
    A('5  Total Revenue $13,550 (the canonical figure)', /Total Revenue[^$]{0,40}\$13,550/.test(txt), '');
    void money;
    // the CSV export is the same report (Rule 2: the export is a surface of these figures)
    let csvRows = null; window._ffDownloadCsv = (rows) => { csvRows = rows; };
    try { window._rptExport('csv'); } catch (e) { csvRows = [['export threw', e.message]]; }
    const flat = (csvRows || []).map(r => r.join('|')).join(' / ');
    A('6  the CSV export lists the same customers and amounts (Acme 12,200 · Beta Co 1,200 · no-customer 150 · total 13,550)',
      /Acme\|\$?12,?200/.test(flat) && /Beta Co\|\$?1,?200/.test(flat) && /no customer\|\$?150/.test(flat) && /13,?550/.test(flat), flat.slice(0, 300));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-M8 sales by customer)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
