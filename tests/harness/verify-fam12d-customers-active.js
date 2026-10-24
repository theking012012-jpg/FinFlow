'use strict';
/**
 * verify-fam12d-customers-active.js — FA-M12d (full app audit M12: Customers "Active 0 paying clients"; the revenue
 * column "—" for everyone). Re-checked 2026-10-24: revenue is now server-computed per customer, but "Active" still
 * counted the CRM status field — and every customer saved from an invoice (batch 9) is created "active", so the card
 * labelled "Paying clients" counted saved records, not customers who are billed.
 * After: Active = customers billed in the last 12 months (a recognised invoice or a sales receipt), from the server's
 * one customer-revenue book; the card says so. The revenue column shows each customer's figure.
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres, NO base seed. Clock 2026-07-25 (12 months back = 2025-07-25).
 *   Acme (status "prospect")  — invoice 1,000 on 2026-05-10  → active
 *   Beta, Gamma (status "active") — never billed             → not active
 *   Old Co (status "active")  — invoice 500 on 2025-03-01    → not active (more than 12 months ago)
 *   + Acme credit note −200 (Jun); a cash sale to "beta" 50 (Jun)
 *   EXPECTED: Active 2 — Acme, Beta (bug: 3) · revenue Acme $800 · Old Co $500 · Beta $50 · Gamma $0 (the legs of Sales by
 *   Customer: invoices + named cash sales − credit notes; bug: invoices only)
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam12d-customers-active.js
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
        for (const [co, status] of [['Acme', 'prospect'], ['Beta', 'active'], ['Gamma', 'active'], ['Old Co', 'active']])
          await ins('customers', { company: co, fname: '', lname: '', email: '', status, revenue: 0 });
        await ins('invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-05-10' });
        await ins('invoices', { client: 'Old Co', amount: 500, status: 'paid', amount_paid: 500, issue_date: '2025-03-01' });
        await ins('credit_notes', { customer: 'Acme', amount: 200, status: 'Open', date: '2026-06-15' });   // the revenue legs of Sales by Customer (FA-M8)
        await ins('sales_receipts', { customer: 'beta', amount: 50, date: '2026-06-01' });
      },
    });
    const { window, settle } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.renderCustomers !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    try { window.showPage('customers'); } catch (_) {}
    await settle(20, 80);
    try { window.renderCustomers(); } catch (_) {}
    await settle(6, 50);
    const active = ((d.getElementById('cust-active') || {}).textContent || '').trim();
    const activeSub = ((d.getElementById('cust-active') || {}).parentElement || { querySelector: () => null }).querySelector('.mc-change');
    const list = ((d.getElementById('customers-list') || {}).textContent || '').replace(/\s+/g, ' ');
    console.log('  [list] ' + list.slice(0, 300));
    A('1  Active = 2 — Acme and Beta (a cash sale) were billed in the last 12 months (bug: 3, the CRM status field)', active === '2', active);
    A('2  the card says what it counts: billed in the last 12 months (bug: "Paying clients")', /billed in the last 12 months/i.test(activeSub ? activeSub.textContent : ''), activeSub ? activeSub.textContent : 'no sub');
    A('3  revenue column on Sales by Customer\'s legs: Acme $800 (1,000 − 200 credit) · Old Co $500 · Beta $50 (cash sale) · Gamma $0 (bug: invoices only — Acme $1,000, Beta $0)',
      /Acme[^$]*\$800\b/.test(list) && /Old Co[^$]*\$500\b/.test(list) && /Beta[^$]*\$50\b/.test(list) && /Gamma[^$]*\$0\b/.test(list), '');
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-M12d customers active)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
