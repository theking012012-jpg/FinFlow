'use strict';
/**
 * verify-dd4-saas-snapshots.js — D-D part 4 (owner decision: "rebuild history on connect, monthly snapshots after").
 * Computed live, a CLOSED month's figures moved whenever its sources changed later (an invoice voided or deleted months
 * after, Stripe history edited) — last quarter's retention silently rewritten. Now the billing job freezes each closed
 * month per business (saas_snapshots: customer → MRR) and the metrics read a frozen month from its snapshot; the month
 * in progress and months before the first snapshot are still computed.
 * Seed (empty account, Business): Alpha 100 Jun + Jul (recurring); Beta 200 Jun only. Clock 2026-07-25 → closed month
 * June: MRR 300. The job snapshots June; then Beta's June invoice is deleted:
 *   June MRR stays 300 (bug, live: 100) · July MRR 100 (in progress, live)
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
let ENT = null;

async function seed({ http, client, userId }) {
  const J = x => { if (x.status >= 300) throw new Error(x.status + ' ' + String(x.text).slice(0, 160)); return x.json; };
  await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
  const ent = J(await http.post('/api/entities', { name: 'Snap Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
  J(await http.post('/api/entities/' + ent.id + '/activate', {}));
  ENT = ent.id;
  const prof = async (c, amount) => (await client.query(`INSERT INTO recurring_invoices (user_id, entity_id, data) VALUES ($1,$2,$3) RETURNING id`, [userId, ent.id, { client: c, amount, frequency: 'Monthly', status: 'active' }])).rows[0].id;
  const inv = async (pid, c, amount, month) => client.query(`INSERT INTO invoices (user_id, entity_id, data) VALUES ($1,$2,$3) RETURNING id`, [userId, ent.id, { client: c, amount, status: 'paid', amount_paid: amount, issue_date: month + '-01', recurring_invoice_id: pid, number: 'S-' + pid + '-' + month }]);
  const pA = await prof('Alpha', 100), pB = await prof('Beta', 200);
  await inv(pA, 'Alpha', 100, '2026-06'); await inv(pA, 'Alpha', 100, '2026-07');
  await inv(pB, 'Beta', 200, '2026-06');
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  D-D part 4 — closed months are frozen (monthly snapshots)\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { http, client: c, userId } = ctx;
    const app = require('../../server.js');
    const mrr = async m => (((await http.get('/api/saas-metrics?month=' + m)).json || {}).metrics || {}).mrr;
    A('0  premise: June MRR 300 computed live', Math.abs((await mrr('2026-06')) - 300) < .01, String(await mrr('2026-06')));
    await app.runBillingJob();
    const snaps = (await c.query(`SELECT month, data FROM saas_snapshots WHERE user_id = $1 AND entity_id = $2 ORDER BY month`, [userId, ENT]).catch(() => ({ rows: [] }))).rows;
    A('1  the job froze the closed month June (Alpha 100, Beta 200) — not July, still in progress', snaps.length === 1 && snaps[0].month === '2026-06' && snaps[0].data.mrr['ff:alpha'] === 100 && snaps[0].data.mrr['ff:beta'] === 200, JSON.stringify(snaps));
    await app.runBillingJob();
    A('1b running it again changes nothing (one snapshot per business per month)', (await c.query(`SELECT count(*)::int AS n FROM saas_snapshots WHERE user_id = $1`, [userId]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n === 1, 'count changed');
    await c.query(`DELETE FROM invoices WHERE user_id = $1 AND data->>'client' = 'Beta'`, [userId]);
    A('2  Beta\'s June invoice deleted later → June MRR stays 300 (frozen; bug, live: 100)', Math.abs((await mrr('2026-06')) - 300) < .01, String(await mrr('2026-06')));
    A('3  July (in progress) is still live: 100', Math.abs((await mrr('2026-07')) - 100) < .01, String(await mrr('2026-07')));
    const src = ((await http.get('/api/saas-metrics?month=2026-07')).json || {}).sources || {};
    A('4  the page is told which months are frozen (June)', Array.isArray(src.frozenMonths) && src.frozenMonths.includes('2026-06'), JSON.stringify(src));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (ctx) await ctx.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (D-D snapshots)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
