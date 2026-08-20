'use strict';
/**
 * verify-tax-rate.js — D1 / F76 defect #1. The income-tax estimate uses the OWNER'S saved rate
 * (Settings → tax_rate, 0–100 %), not a hardcoded 25%. Proves GET /api/tax-filing reads
 * user_settings.data.tax_rate and applies it, defaulting to 25% only until the owner sets one,
 * and honouring the 0–100 clamp the settings PUT enforces.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-tax-rate.js
 */

const bcrypt = require('bcryptjs');
require('./clock.js');   // pinned 2026-07-25 → FY2026
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'tax@finflow.test', name: 'Tax Co', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;
    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'Tax Co', currency: 'USD', is_active: 1 }]
    )).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('login 200', (await http.post('/api/auth/login', { email: 'tax@finflow.test', password: PW })).status === 200);

    // Seed accrual revenue: one pending invoice issued inside FY2026.
    const inv = await http.post('/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-15', entity_id: eid });
    A('invoice created (accrual revenue)', inv.status === 201 || inv.status === 200, `status ${inv.status} ${JSON.stringify(inv.json)}`);

    const taxFiling = async () => (await http.get('/api/tax-filing?fyStart=0')).json;

    // 1) default rate before the owner sets anything → 25%
    let t = await taxFiling();
    A('taxable income = revenue − deductible = 1000', t && Number(t.taxableIncome) === 1000, JSON.stringify(t));
    A('default rate is 0.25 (until owner sets one)', t && Number(t.rate) === 0.25, JSON.stringify(t));
    A('estimatedTax = taxable × 0.25 = 250', t && Number(t.estimatedTax) === 250, JSON.stringify(t));

    // 2) owner sets 40% → endpoint reflects it
    A('PUT settings tax_rate=40 → 200', (await http.put('/api/settings', { tax_rate: 40 })).status === 200);
    t = await taxFiling();
    A('rate now 0.40 (owner-supplied)', t && Number(t.rate) === 0.40, JSON.stringify(t));
    A('estimatedTax = taxable × 0.40 = 400', t && Number(t.estimatedTax) === 400, JSON.stringify(t));

    // 3) owner sets 0% → zero tax (not the 25% default sneaking back)
    A('PUT settings tax_rate=0 → 200', (await http.put('/api/settings', { tax_rate: 0 })).status === 200);
    t = await taxFiling();
    A('rate 0 honoured (0, not defaulted to 0.25)', t && Number(t.rate) === 0, JSON.stringify(t));
    A('estimatedTax = 0', t && Number(t.estimatedTax) === 0, JSON.stringify(t));

    // 4) out-of-range rate is clamped to 100 by the settings PUT → rate 1.0
    A('PUT settings tax_rate=150 → 200', (await http.put('/api/settings', { tax_rate: 150 })).status === 200);
    t = await taxFiling();
    A('rate clamped to 1.0 (settings caps 0–100)', t && Number(t.rate) === 1, JSON.stringify(t));
    A('estimatedTax = taxable × 1.0 = 1000', t && Number(t.estimatedTax) === 1000, JSON.stringify(t));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (tax rate is owner-supplied)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
