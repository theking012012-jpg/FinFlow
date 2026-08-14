#!/usr/bin/env node
'use strict';
/**
 * verify-fx-gainloss.js — foreign-DENOMINATED FX positions: realised (settled) and unrealised (open,
 * read-time) gain/loss, surfaced by GET /api/reports (fx_realised / fx_unrealised). The Appendix B
 * residual left open by verify-a8c-fx-reconcile.js (which covered display-time conversion of native
 * rows). Driven through the REAL routes: POST /api/fx-transactions + …/settle.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fx-gainloss.js
 *
 * THE MATH UNDER TEST (server.js):
 *   base_amount   = foreign_amount × rate_at_transaction                              (create, :5420)
 *   realised GL   = (rate_at_settlement − rate_at_transaction) × foreign_amount       (settle,  :5447)
 *   unrealised GL = (current_rate      − rate_at_transaction) × foreign_amount        (read,    :5352)
 *                   → null when no current rate exists (NEVER a fabricated 0 — that phantom was F3)
 *
 * RULE 4 — the seed makes every figure a DISTINCT, SIGNED number so a formula/sign bug changes it:
 *   · OPEN EUR 10,000 @ 1.10, current 1.15 → unrealised = +500  (a GAIN)
 *   · SETTLED GBP 5,000 @ 1.30, settle 1.25 → realised  = −250  (a LOSS)
 *   A swapped subtraction gives −500 / +250; base_amount instead of foreign_amount gives other
 *   numbers; none collide. Signs are opposite, so sign handling is exercised (not an all-gain seed).
 *
 * RULE 14 — the F3 failure path is executed: an OPEN JPY position with NO seeded JPY→USD rate must
 *   report unrealised = null (not 0) and contribute nothing to the fx_unrealised total.
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'fxgl@finflow.test', password: 'harness-password-not-a-secret' };

let pass = 0, fail = 0;
const A = (name, got, want, bugWould) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else { fail++; console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want) + (bugWould ? '\n          (' + bugWould + ')' : '')); }
};
const num = v => (v == null ? null : Math.round(parseFloat(v) * 100) / 100);

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);   // runs initDB → creates the schema before we seed
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'FXGL', plan: 'business', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;
    // An active entity so req.entityId resolves (business rows are entity-scoped).
    await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
      [uid, { name: 'FXGL Co', currency: 'USD', is_active: 1 }]
    );
    // Current rate for the OPEN EUR position's unrealised P/L (EUR→USD = 1.15). No JPY→USD rate on purpose.
    await c.query(
      `INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date, source)
       VALUES ($1, NULL, 'EUR', 'USD', 1.15, '2026-07-20', 'harness')`, [uid]
    );

    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', LOGIN)).status !== 200) throw new Error('login failed');

    console.log('\n' + '='.repeat(78));
    console.log('  FX gain/loss — foreign-denominated positions (real routes + real Postgres)');
    console.log('='.repeat(78));

    // ── 1 · create the OPEN EUR position — base_amount = foreign × rate_at_transaction ──
    console.log('\n-- 1 - open EUR 10,000 @ 1.10 (base_amount = 11,000) --');
    const eur = await http.post('/api/fx-transactions', { foreign_currency: 'EUR', foreign_amount: 10000, rate_at_transaction: 1.10 });
    A('POST EUR fx-transaction → 201', eur.status, 201, `body ${eur.text.slice(0, 160)}`);
    A('base_amount = foreign × rate (10,000 × 1.10)', num(eur.json.base_amount), 11000);
    A('status open', eur.json.status, 'open');

    // ── 2 · create + SETTLE the GBP position — realised = (1.25 − 1.30) × 5,000 = −250 ──
    console.log('\n-- 2 - GBP 5,000 @ 1.30, settle 1.25 → realised −250 --');
    const gbp = await http.post('/api/fx-transactions', { foreign_currency: 'GBP', foreign_amount: 5000, rate_at_transaction: 1.30 });
    A('POST GBP fx-transaction → 201', gbp.status, 201, `body ${gbp.text.slice(0, 160)}`);
    const settled = await http.post(`/api/fx-transactions/${gbp.json.id}/settle`, { rate_at_settlement: 1.25 });
    A('POST …/settle → 200', settled.status, 200, `body ${settled.text.slice(0, 160)}`);
    A('realised_gain_loss = (1.25 − 1.30) × 5,000 = −250 (LOSS)', num(settled.json.realised_gain_loss), -250,
      'a swapped subtraction would give +250');
    A('status settled', settled.json.status, 'settled');

    // ── 3 · OPEN JPY position with NO current rate — unrealised must be null, not 0 (F3) ──
    console.log('\n-- 3 - open JPY 1,000,000 @ 0.007, NO JPY→USD rate → unrealised null (F3) --');
    const jpy = await http.post('/api/fx-transactions', { foreign_currency: 'JPY', foreign_amount: 1000000, rate_at_transaction: 0.007 });
    A('POST JPY fx-transaction → 201', jpy.status, 201, `body ${jpy.text.slice(0, 160)}`);
    const listed = await http.get('/api/fx-transactions');
    const jpyRow = (listed.json || []).find(t => t.id === jpy.json.id);
    A('F3: JPY unrealised is null (no rate), NEVER a fabricated 0',
      jpyRow ? jpyRow.unrealised_gain_loss : 'missing', null, `row ${JSON.stringify(jpyRow && jpyRow.unrealised_gain_loss)}`);

    // ── 4 · the reports totals: realised = −250, unrealised = +500 (EUR only; JPY excluded) ──
    console.log('\n-- 4 - GET /api/reports totals --');
    const rep = await http.get('/api/reports');
    A('GET /api/reports → 200', rep.status, 200);
    A('fx_realised = −250 (the one settled position)', num(rep.json.fx_realised), -250,
      'includes only settled realised GL');
    A('fx_unrealised = +500 (EUR open @ (1.15−1.10)×10,000; JPY has no rate → excluded, not 0)',
      num(rep.json.fx_unrealised), 500, 'a fabricated JPY 0 would still read 500; a JPY native-0 sum would too — the null check in §3 is what proves exclusion');

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (FX realised/unrealised gain-loss)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[fxgl] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
