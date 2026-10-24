'use strict';
/**
 * verify-dd2-saas-api.js — D-D part 2: the SaaS metrics for a business, from its real data.
 *   • FinFlow's recurring invoices (invoices made from a recurring profile carry recurring_invoice_id) and the business's
 *     connected Stripe account's PAID subscription invoices (rebuilt from Stripe's history, read-only) are both sources;
 *     each invoice is spread over the period it covers
 *   • acquisition spend = the business's expenses in the chosen categories (default Marketing + Advertising); gross
 *     margin from its books
 *   • Business plan and up (and the trial)
 * Same hand-computed seed as part 1 — A, B, D, E, F are FinFlow recurring customers; C pays a YEARLY 1,200 through
 * Stripe (paid invoice, line period 1 May 2026 → 1 May 2027). June expenses: Marketing 300, Advertising 200, Office 999.
 * An EMPTY account (baseSeed: false) — the books hold only this seed, no cost of sales → gross margin exactly 1.
 *   June: MRR 590 · new 50 · expansion 100 · churned 150 · revenue churn 25.42% · NRR 91.53% · ARPA 118.00
 *         CAC 500.00 (bug: Office included → 1,499.00) · payback 500 / (118 × 1) = 4.24 months
 *   July: LTV 137.5 × 1 ÷ 0.1325019 = 1,037.72
 *   Bugs: Stripe not read → C missing → June MRR 490; recurring lineage ignored → one-off invoices counted.
 * The REAL server + Postgres; the connected Stripe account answers at the HTTP boundary (global fetch, Stripe URLs only).
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_harness';
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => a != null && Math.abs(Number(a) - Number(b)) < 0.01;

async function seed({ http, client, userId }) {
  const J = x => { if (x.status >= 300) throw new Error(x.status + ' ' + String(x.text).slice(0, 160)); return x.json; };
  await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
  const ent = J(await http.post('/api/entities', { name: 'SaaS Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
  J(await http.post('/api/entities/' + ent.id + '/activate', {}));
  await client.query(`INSERT INTO user_settings (user_id, entity_id, data) VALUES ($1, $2, $3)`, [userId, ent.id, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_harness' }) }]);
  const prof = async (c, amount) => (await client.query(`INSERT INTO recurring_invoices (user_id, entity_id, data) VALUES ($1,$2,$3) RETURNING id`, [userId, ent.id, { client: c, amount, frequency: 'Monthly', status: 'active' }])).rows[0].id;
  const inv = async (pid, c, amount, month) => client.query(`INSERT INTO invoices (user_id, entity_id, data) VALUES ($1,$2,$3)`, [userId, ent.id, { client: c, amount, status: 'paid', amount_paid: amount, issue_date: month + '-01', due_date: month + '-15', recurring_invoice_id: pid, number: 'R-' + pid + '-' + month }]);
  const pA = await prof('Alpha', 100), pB = await prof('Beta', 200), pD = await prof('Delta', 150), pE = await prof('Echo', 50), pF = await prof('Fox', 80);
  for (const mm of ['2026-04', '2026-05', '2026-06', '2026-07']) await inv(pA, 'Alpha', 100, mm);
  for (const [mm, a] of [['2026-04', 200], ['2026-05', 200], ['2026-06', 300], ['2026-07', 300]]) await inv(pB, 'Beta', a, mm);
  for (const mm of ['2026-04', '2026-05']) await inv(pD, 'Delta', 150, mm);
  for (const mm of ['2026-06', '2026-07']) await inv(pE, 'Echo', 50, mm);
  for (const [mm, a] of [['2026-04', 80], ['2026-05', 40], ['2026-06', 40]]) await inv(pF, 'Fox', a, mm);
  // a ONE-OFF invoice (no recurring profile) — not recurring revenue
  await client.query(`INSERT INTO invoices (user_id, entity_id, data) VALUES ($1,$2,$3)`, [userId, ent.id, { client: 'Oneoff', amount: 5000, status: 'paid', amount_paid: 5000, issue_date: '2026-06-05', number: 'ONE-1' }]);
  for (const [cat, amt, day] of [['Marketing', 300, '16'], ['Advertising', 200, '14'], ['Office Supplies', 999, '15']]) J(await http.post('/api/expenses', { description: cat, category: cat, amount: amt, expense_date: '2026-06-' + day }));
}

(async () => {
  let ctx;
  const _f = global.fetch;
  const stripeCalls = [];
  try {
    console.log('\n' + '='.repeat(78) + '\n  D-D part 2 — SaaS metrics from FinFlow recurring invoices + the connected Stripe account\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { http } = ctx;
    global.fetch = async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://api.stripe.com/v1/invoices')) {
        stripeCalls.push({ u, acct: (init && init.headers && init.headers['Stripe-Account']) || null });
        return new Response(JSON.stringify({ has_more: false, data: [
          { id: 'in_C', status: 'paid', currency: 'usd', customer: 'cus_C', customer_name: 'Cloud Co', lines: { data: [{ type: 'subscription', amount: 120000, currency: 'usd', period: { start: Date.parse('2026-05-01T00:00:00Z') / 1000, end: Date.parse('2027-05-01T00:00:00Z') / 1000 } }] } },
          { id: 'in_X', status: 'paid', currency: 'eur', customer: 'cus_X', lines: { data: [{ type: 'subscription', amount: 5000, currency: 'eur', period: { start: Date.parse('2026-06-01T00:00:00Z') / 1000, end: Date.parse('2026-07-01T00:00:00Z') / 1000 } }] } },
        ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return _f(url, init);
    };
    const jun = await http.get('/api/saas-metrics?month=2026-06');
    const m = (jun.json || {}).metrics || {};
    A('1  June MRR 590 — FinFlow recurring + the Stripe yearly spread (bugs: Stripe not read → 490; the one-off 5,000 counted)', jun.status === 200 && near(m.mrr, 590), jun.status + ' ' + String(jun.text).slice(0, 300));
    A('2  June: new 50 · expansion 100 · churned 150 · revenue churn 25.42% · NRR 91.53% · ARPA 118.00', near(m.newMrr, 50) && near(m.expansion, 100) && near(m.churnedMrr, 150) && near(m.revenueChurnRate, 25.42) && near(m.nrr, 91.53) && near(m.arpa, 118), JSON.stringify(m).slice(0, 400));
    A('3  CAC 500.00 from Marketing + Advertising only (bug: Office included → 1,499.00); payback 4.24 months at margin 1', near(m.cac, 500) && near(m.paybackMonths, 4.24) && near((jun.json || {}).grossMargin, 1), JSON.stringify([m.cac, m.paybackMonths, (jun.json || {}).grossMargin]));
    const src = (jun.json || {}).sources || {};
    A('4  sources: FinFlow 15 lines, Stripe 1; the EUR invoice NOT mixed into USD MRR (counted as skipped); the business\'s own Stripe account', src.stripeConnected === true && src.stripeLines === 1 && src.otherCurrencySkipped === 1 && src.finflowLines === 15 && stripeCalls.length > 0 && stripeCalls.every(c => c.acct === 'acct_harness'), JSON.stringify(src) + ' ' + JSON.stringify(stripeCalls));
    const jul = (await http.get('/api/saas-metrics?month=2026-07')).json || {};
    A('5  July LTV 1,037.72 (ARPA 137.50 × margin 1 ÷ avg revenue churn 0.1325019)', near((jul.metrics || {}).ltv, 1037.72), JSON.stringify((jul.metrics || {}).working && jul.metrics.working.ltv));
    A('6  the cohort grid comes with it (April cohort 4 customers: 100 / 100 / 75 / 50 %)', ((jul.cohorts || []).find(g => g.start === '2026-04') || { months: [] }).months.map(r => r.customerPct).join() === '100,100,75,50', JSON.stringify((jul.cohorts || []).map(g => [g.start, g.size])));
    const put = await http.put('/api/saas-metrics/settings', { acquisitionCategories: ['Marketing'], salesPayrollPct: 0 });
    const j2 = ((await http.get('/api/saas-metrics?month=2026-06')).json || {}).metrics || {};
    A('7  the business chooses its acquisition categories: Marketing only → CAC 300.00', put.status === 200 && near(j2.cac, 300), put.status + ' ' + JSON.stringify(j2.working && j2.working.cac));
    // plan gate (plans.js: saasMetrics on Business+ and the trial; not Pro)
    await ctx.client.query(`UPDATE users SET data = data || '{"plan":"pro"}'::jsonb WHERE id = $1`, [ctx.userId]);
    const pro = await http.get('/api/saas-metrics?month=2026-06');
    await ctx.client.query(`UPDATE users SET data = data || '{"plan":"trial","trial_ends":"2026-08-20T00:00:00.000Z"}'::jsonb WHERE id = $1`, [ctx.userId]);
    const tri = await http.get('/api/saas-metrics?month=2026-06');
    A('8  Pro is told SaaS metrics are a Business feature (402); the trial sees them', pro.status === 402 && (pro.json || {}).code === 'PLAN_FEATURE' && tri.status === 200, pro.status + ' / ' + tri.status);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { global.fetch = _f; if (ctx) await ctx.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-D API)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
