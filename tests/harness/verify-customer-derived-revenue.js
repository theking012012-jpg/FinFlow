'use strict';
/**
 * verify-customer-derived-revenue.js — Phase 1.1 / L17 (same class as N24 / 20861a9 vendor balances): a
 * customer's "Lifetime revenue" and the Customers page "Lifetime Revenue — All customers" card were a TYPED
 * number on the customer record (`revenue`, entered in the customer form and summed by the page), agreeing
 * with nothing in the books. They are now DERIVED on read from the customer's recognised invoices.
 *
 * Attribution rule (each invoice counted ONCE): an invoice's `client` text matches a customer's full name
 * ("First Last") first, else its company; if several customers share that company the lowest id takes it.
 * Recognised = pending/overdue/partial/paid, issued on or before today (draft and future-dated excluded).
 *
 * Seed (today pinned 2026-07-25) — hand-computed:
 *   customers  Ada Lovelace @ Acme (typed revenue 999) · Bob Byte @ Acme (typed 555) · Cara Diaz @ Diaz LLC
 *   invoices   "Acme" 700 pending (Jun 5) · "Cara Diaz" 50 paid (Jun 6) · "Acme" 300 DRAFT ·
 *              "Acme" 40 issued 2026-08-10 (future) · "Unknown Co" 20 (no customer)
 *   ⇒ Ada 700 · Bob 0 · Cara 50 · card 750        BUG (typed): Ada 999 · Bob 555 · Cara 0 · card 1554
 *   then the form adds Dan Delta @ "Unknown Co" ⇒ Dan 20 · card 770   (pre-fix save: NaN / not re-derived)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-customer-derived-revenue.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs((+a) - (+b)) < 0.01;
const money = s => { const m = String(s == null ? '' : s).replace(/[,\s]/g, '').match(/(-?)[^\d-]*(-?\d+(?:\.\d+)?)/); return m ? (m[1] === '-' ? -1 : 1) * parseFloat(m[2]) : NaN; };

async function seed({ http }) {
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return JSON.parse(r.text); };
  const ent = J(await http.post('/api/entities', { name: 'Cust Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
  J(await http.post('/api/entities/' + ent.id + '/activate', {}));
  J(await http.post('/api/customers', { fname: 'Ada', lname: 'Lovelace', company: 'Acme', email: 'ada@acme.test', revenue: 999, status: 'active' }));
  J(await http.post('/api/customers', { fname: 'Bob', lname: 'Byte', company: 'Acme', email: 'bob@acme.test', revenue: 555, status: 'active' }));
  J(await http.post('/api/customers', { fname: 'Cara', lname: 'Diaz', company: 'Diaz LLC', email: 'cara@diaz.test', status: 'active' }));
  J(await http.post('/api/invoices', { client: 'Acme', amount: 700, status: 'pending', issue_date: '2026-06-05', due_date: '2026-08-05' }));
  J(await http.post('/api/invoices', { client: 'Cara Diaz', amount: 50, status: 'paid', issue_date: '2026-06-06', due_date: '2026-07-06' }));
  J(await http.post('/api/invoices', { client: 'Acme', amount: 300, status: 'draft', issue_date: '2026-06-07', due_date: '2026-08-07' }));
  J(await http.post('/api/invoices', { client: 'Acme', amount: 40, status: 'pending', issue_date: '2026-08-10', due_date: '2026-09-10' }));
  J(await http.post('/api/invoices', { client: 'Unknown Co', amount: 20, status: 'pending', issue_date: '2026-06-08', due_date: '2026-08-08' }));
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L17 — customer revenue is derived from invoices, not typed\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, http, settle, text } = ctx;
    const custs = JSON.parse((await http.get('/api/customers')).text);
    const by = n => (custs.find(c => c.fname === n) || {}).revenue;
    A('GET /api/customers: Ada (Acme, lowest id) 700 (bug: typed 999)', near(by('Ada'), 700), JSON.stringify(custs.map(c => [c.fname, c.revenue])));
    A('GET /api/customers: Bob (also Acme) 0 — each invoice counted once (bug: typed 555)', near(by('Bob'), 0), JSON.stringify(custs.map(c => [c.fname, c.revenue])));
    A('GET /api/customers: Cara 50 — matched by full name (bug: 0)', near(by('Cara'), 50), JSON.stringify(custs.map(c => [c.fname, c.revenue])));
    await settle(60, 100);
    w.showPage('customers'); await settle(25, 100);
    A('Customers page "Lifetime Revenue" card == 750 (bug: 1554)', near(money(text('cust-revenue')), 750), 'cust-revenue=' + text('cust-revenue'));
    const row = n => { const r = [...w.document.querySelectorAll('#customers-list .cust-row')].find(x => x.textContent.includes(n)); return r ? r.textContent.replace(/\s+/g, ' ') : ''; };
    A('Customers page row: Ada shows $700', /\$700\b/.test(row('Ada Lovelace')), row('Ada Lovelace'));
    A('customer form has no typed "Lifetime revenue" input any more', !w.document.getElementById('cust-revenue-val'), 'input still present');

    // Save path (the runtime winner, wiring saveCustomer): add "Dan Delta" @ "Unknown Co" through the form. The
    // page must show his DERIVED revenue (the existing "Unknown Co" invoice, 20) and the card 750 + 20 = 770 —
    // the save used to push the form object (no revenue ⇒ NaN card) into window.customers, not the list rendered.
    w.openCustomerModal();
    const set = (id, v) => { const el = w.document.getElementById(id); if (el) el.value = v; };
    set('cust-fname', 'Dan'); set('cust-lname', 'Delta'); set('cust-email', 'dan@unknown.test'); set('cust-company', 'Unknown Co');
    await w.saveCustomer(); await settle(20, 100);
    A('after adding Dan @ Unknown Co: card == 770', near(money(text('cust-revenue')), 770), 'cust-revenue=' + text('cust-revenue'));
    A('Dan Delta is listed with $20 (his derived revenue)', /\$20\b/.test(row('Dan Delta')), row('Dan Delta') || '(not listed)');
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (customer derived revenue)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
