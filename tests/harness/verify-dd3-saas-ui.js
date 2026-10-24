'use strict';
/**
 * verify-dd3-saas-ui.js — D-D part 3: the MRR page shows the SaaS metrics, with their working. Before: New / Churned /
 * Expansion / Net MRR and the churn rate read "—" (no history kept); nothing showed retention, CAC, payback, LTV or
 * cohorts. Now a "Growth & retention" section for a chosen COMPLETED month (labelled; the run-rate MRR card above is
 * unchanged — a different figure, today's run-rate):
 *   • tiles: NRR, GRR, customer churn, revenue churn, ARPA, CAC, payback, LTV — each opens its working (formula, inputs)
 *   • a figure history cannot support says why (June LTV: "needs 3 months") instead of a number
 *   • the month's movement names the customers (new Echo, expanded Beta, churned Delta)
 *   • the cohort grid; the breakdown tiles (New / Churned / Expansion / Net MRR) and the churn card are filled
 *   • the acquisition categories are chosen on the page
 * Same hand-computed seed as parts 1–2 (empty account, margin 1). June: NRR 91.53% · GRR 74.58% · customer churn 20.00%
 * · revenue churn 25.42% · ARPA $118.00 · CAC $500.00 · payback 4.24 months · new $50 · churned $150 · expansion $100 ·
 * net $0 (590 − 590).
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_harness';
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const stripeInvoices = () => ({ has_more: false, data: [
  { id: 'in_C', status: 'paid', currency: 'usd', customer: 'cus_C', customer_name: 'Cloud Co', lines: { data: [{ type: 'subscription', amount: 120000, currency: 'usd', period: { start: Date.parse('2026-05-01T00:00:00Z') / 1000, end: Date.parse('2027-05-01T00:00:00Z') / 1000 } }] } } ] });

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
  for (const [cat, amt, day] of [['Marketing', 300, '16'], ['Advertising', 200, '14'], ['Office Supplies', 999, '15']]) J(await http.post('/api/expenses', { description: cat, category: cat, amount: amt, expense_date: '2026-06-' + day }));
}

(async () => {
  let ctx;
  const _f = global.fetch;
  global.fetch = async (url, init) => String(url).startsWith('https://api.stripe.com/v1/invoices')
    ? new Response(JSON.stringify(stripeInvoices()), { status: 200, headers: { 'Content-Type': 'application/json' } }) : _f(url, init);
  try {
    console.log('\n' + '='.repeat(78) + '\n  D-D part 3 — the MRR page shows the SaaS metrics, with their working\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, settle } = ctx, d = w.document;
    try { w.showPage('mrr'); } catch (_) {}
    await settle(20, 60);
    try { await w.ffRenderSaas('2026-06'); } catch (e) { console.log('render error', e && e.message); }
    await settle(6, 40);
    const t = id => ((d.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const sec = t('saas-section');
    A('1  a "Growth & retention" section for June 2026 (bug: none)', /Growth & retention/.test(sec) && /June 2026/.test(sec), sec.slice(0, 160) || 'no #saas-section');
    A('2  tiles: NRR 91.53% · GRR 74.58% · customer churn 20.00% · revenue churn 25.42%', /91\.53%/.test(t('saas-nrr')) && /74\.58%/.test(t('saas-grr')) && /20\.00%/.test(t('saas-customer-churn')) && /25\.42%/.test(t('saas-revenue-churn')), [t('saas-nrr'), t('saas-grr'), t('saas-customer-churn'), t('saas-revenue-churn')].join(' | '));
    A('3  tiles: ARPA $118.00 · CAC $500.00 · payback 4.2 months', /\$118\.00/.test(t('saas-arpa')) && /\$500\.00/.test(t('saas-cac')) && /4\.2/.test(t('saas-payback')), [t('saas-arpa'), t('saas-cac'), t('saas-payback')].join(' | '));
    A('4  June LTV says why it is not shown (needs 3 months) — never a misleading number', /3 months/.test(t('saas-ltv')) && !/\$\d/.test(t('saas-ltv')), t('saas-ltv'));
    const nrr = d.getElementById('saas-nrr'); if (nrr) nrr.click();
    await settle(3, 30);
    const wk = t('saas-working');
    A('5  clicking NRR shows its working: the formula and its inputs (590 start, +100, −0, −150)', /start MRR \+ expansion/.test(wk) && /590/.test(wk) && /150/.test(wk), wk.slice(0, 220) || 'no #saas-working');
    const mv = t('saas-movement');
    A('6  the movement names the customers: new Echo · expanded Beta · churned Delta (names, not internal keys)', /Echo/.test(mv) && /Beta/.test(mv) && /Delta/.test(mv) && !/ff:/.test(mv), mv.slice(0, 260));
    const coh = t('saas-cohorts');
    // viewing JUNE: the grid runs to June — April's cohort is 100 / 100 / 75 % (July's 50% is not shown for June)
    A('7  the cohort grid up to June: April 2026 · 4 customers · 100% 100% 75% (and nothing after June)', /April 2026\s*4\s*100%\s*100%\s*75%May/.test(coh), coh.slice(0, 260));
    A('8  the breakdown tiles are filled for June: New $50 · Churned $150 · Expansion $100 · Net $0 (bug: "—")', /\$50\b/.test(t('mrr-new')) && /\$150\b/.test(t('mrr-churned')) && /\$100\b/.test(t('mrr-expansion')) && /\$0\b/.test(t('mrr-net')), [t('mrr-new'), t('mrr-churned'), t('mrr-expansion'), t('mrr-net')].join(' | '));
    A('8b the churn card shows June\'s customer churn 20.00% (bug: "—")', /20\.00%/.test(t('mrr-churn')), t('mrr-churn'));
    // the acquisition categories, chosen on the page
    const cats = d.getElementById('saas-cats');
    if (cats) cats.value = 'Marketing';
    try { await w.ffSaveSaasSettings(); } catch (e) { console.log('save error', e && e.message); }
    await settle(8, 50);
    A('9  choosing Marketing only on the page → CAC $300.00', /\$300\.00/.test(t('saas-cac')), t('saas-cac'));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { global.fetch = _f; if (ctx) await ctx.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-D UI)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
