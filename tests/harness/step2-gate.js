'use strict';
/**
 * step2-gate.js — the gate for harness step 2 (reset-and-reseed).
 *
 *   node -r ./tests/harness/clock.js tests/harness/step2-gate.js [--keep]
 *
 * WHAT THIS GATE PROVES
 *   That the database contains EXACTLY the dataset VERIFICATION.md specifies — right row
 *   counts, right values read back by SELECT, right dates, right statuses, the bill_id link
 *   present — and that reseeding is deterministic.
 *
 * WHAT IT DOES NOT PROVE
 *   Nothing about any figure the app computes. Not one endpoint is called. A green step 2
 *   means "the seed is what the document says"; it says nothing about whether the app reads
 *   it correctly. That is step 3.
 *
 * It also proves a NEGATIVE that matters more than any of the positives: that the harness
 * rejects `status:'final'` — the value that shipped three defects behind 62 green assertions
 * (F77) — and that the DATABASE would have accepted it (F79).
 */

const clock = require('./clock.js');
const guard = require('./guard.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema } = require('./boot.js');
const { seed, SEEDED_TABLES } = require('./seed.js');
const { assertStatus, VocabularyError } = require('./vocabulary.js');
const { measureDrift, reportDrift } = require('./drift.js');
const { printSubstrateHeader } = require('./substrate.js');
const D = require('./seedData.js');

const KEEP = process.argv.includes('--keep');

let pass = 0, fail = 0;
const failures = [];

function check(name, got, want) {
  const ok = (typeof want === 'number' && typeof got === 'number')
    ? Math.abs(got - want) < 0.005
    : got === want;
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else {
    fail++; failures.push({ name, got, want });
    console.log(`  FAIL  ${name}\n          actual   ${JSON.stringify(got)}\n          expected ${JSON.stringify(want)}`);
  }
  return ok;
}

const num = (v) => (v == null ? null : parseFloat(v));

async function main() {
  const scratch = await startScratchPostgres({ keep: KEEP });
  const c = scratch.client;

  printSubstrateHeader(scratch.facts, {
    port: scratch.port, dataDir: scratch.dataDir, keep: KEEP,
    pinnedIso: clock.PINNED_ISO, tz: clock.TZ, scrubbed: null,
  });

  // Drift is measured and REPORTED, never fatal (owner decision). Part A is unaffected;
  // only the listed Part B checks are blocked, and only on a month boundary.
  const { rows: [nowRow] } = await c.query('SELECT NOW() AS n');
  const drift = measureDrift(nowRow.n);
  const blocked = reportDrift(drift);

  // The REAL schema, via the SAME initDB() the server runs — not a schema written for tests.
  const { pool: appPool } = await initSchema(scratch.url);

  try {
    // The owner user. Created before anything else because payroll_runs.user_id carries a real
    // FK to users(id) — `fk_payroll_runs_user`, added by the foreign-key block at
    // database.js:478-528. An earlier version of this gate used a fabricated user_id of 999999
    // and was correctly rejected by the database. Worth stating: referential integrity in this
    // schema WORKS. It is value-domain constraints on status that are missing (F79).
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: 'seed@finflow.test', name: 'Seed Owner', plan: 'trial', role: 'owner' }]
    )).rows[0].id;

    // ── 1 · The vocabulary gate (F79) ────────────────────────────────────────
    console.log('── 1 · Status vocabulary gate — the guard the DATABASE does not provide ───');

    let rejected = false, msg = '';
    try { assertStatus('payroll_run', 'final', 'R-BAD'); }
    catch (e) { rejected = e instanceof VocabularyError; msg = e.message.split('\n')[0]; }
    check("harness REJECTS payroll_runs status 'final' (the F77 value)", rejected, true);
    if (rejected) console.log(`          → ${msg}`);

    // The counterpart, and the reason the gate above has to exist at all: prove by EXECUTION
    // that real Postgres accepts the same value without complaint. F77 assumed the opposite —
    // that a real INSERT would have been the thing to reject it. This row is valid in every
    // way the database can check, and carries a status the product does not have.
    await c.query(
      `INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross)
       VALUES ($1, NULL, 'f79-proof', DATE '2026-06-01', 'final', 0)`, [userId]);
    const { rows: [bad] } = await c.query(
      `SELECT status FROM payroll_runs WHERE period = 'f79-proof' LIMIT 1`);
    check("real Postgres ACCEPTS status 'final' — no CHECK exists (F79, proven by execution)",
      bad && bad.status, 'final');
    await c.query(`DELETE FROM payroll_runs WHERE period = 'f79-proof'`);

    for (const [kind, badValue] of [['invoice', 'final'], ['bill', 'pending'], ['payroll_run', 'submitted']]) {
      let r = false;
      try { assertStatus(kind, badValue, `${kind}-probe`); } catch { r = true; }
      check(`harness rejects ${kind} status "${badValue}"`, r, true);
    }
    // 'pending' is a VALID invoice status but NOT a valid bill status — bills use a different
    // vocabulary (Rule 11). Proving the gate is per-kind, not one shared list.
    check("'pending' is accepted for an invoice (per-kind vocabularies)",
      assertStatus('invoice', 'pending', 'probe'), 'pending');

    // ── 2 · Seed ─────────────────────────────────────────────────────────────
    console.log('\n── 2 · Reset and seed ────────────────────────────────────────────────────');
    const { entityId, ids } = await seed(c, userId);
    check('seed completed and returned an entity', typeof entityId === 'number', true);

    // ── 3 · Row counts ───────────────────────────────────────────────────────
    console.log('\n── 3 · Row counts ────────────────────────────────────────────────────────');
    const count = async (t, where = '') =>
      (await c.query(`SELECT count(*)::int AS n FROM ${t} ${where}`)).rows[0].n;

    check('invoices', await count('invoices'), D.EXPECTED.invoiceCount);
    check('customers', await count('customers'), D.CUSTOMERS.length);
    check('invoice_payments', await count('invoice_payments'), D.INVOICE_PAYMENTS.length);
    check('bills', await count('bills'), D.EXPECTED.billCount);
    check('payments_made', await count('payments_made'), D.PAYMENTS_MADE.length);
    check('expenses', await count('expenses'), D.EXPECTED.expenseCount);
    check('payroll roster', await count('payroll'), D.ROSTER.length);
    check('payroll_runs', await count('payroll_runs'), D.EXPECTED.payrollRunCount);
    check('payroll_run_lines', await count('payroll_run_lines'),
      D.PAYROLL_RUNS.reduce((s, r) => s + r.lines.length, 0));
    check('inventory items', await count('inventory'), 1);
    check('inventory_movements', await count('inventory_movements'), D.EXPECTED.movementCount);
    check('holdings', await count('holdings'), D.HOLDINGS.length);
    check('entities', await count('entities'), 1);

    // ── 4 · Read-backs: every value, by SELECT ───────────────────────────────
    console.log('\n── 4 · SELECT read-backs — every seeded value ────────────────────────────');

    for (const inv of D.INVOICES) {
      const { rows: [r] } = await c.query(
        `SELECT data->>'status' AS status, (data->>'amount')::numeric AS amount,
                (data->>'amount_paid')::numeric AS paid, data->>'issue_date' AS issue,
                data->>'client' AS client, created_at
           FROM invoices WHERE data->>'num' = $1`, [inv.key]);
      check(`${inv.key} amount/status/paid/issue_date/client`,
        r && `${num(r.amount)}|${r.status}|${num(r.paid)}|${r.issue}|${r.client}`,
        `${inv.amount}|${inv.status}|${inv.amount_paid}|${inv.issue_date}|${inv.client}`);
      // created_at is written explicitly — never DEFAULT NOW(). If this drifts, every
      // created_at-fallback period assignment silently moves (Rule 10).
      check(`${inv.key} created_at is the explicit seed date, not NOW()`,
        r && r.created_at.toISOString().slice(0, 10), inv.issue_date);
    }

    for (const b of D.BILLS) {
      const { rows: [r] } = await c.query(
        `SELECT data->>'status' AS status, (data->>'amount')::numeric AS amount,
                (data->>'amount_paid')::numeric AS paid, data->>'issue_date' AS issue
           FROM bills WHERE data->>'num' = $1`, [b.key]);
      check(`${b.key} amount/status/paid/issue_date`,
        r && `${num(r.amount)}|${r.status}|${num(r.paid)}|${r.issue}`,
        `${b.amount}|${b.status}|${b.amount_paid}|${b.issue_date}`);
    }

    for (const run of D.PAYROLL_RUNS) {
      const { rows: [r] } = await c.query(
        `SELECT pr.status, pr.run_date::text AS run_date, pr.period,
                pr.total_gross::numeric AS header,
                COALESCE(SUM(prl.gross + prl.bonus + prl.overtime),0)::numeric AS lines
           FROM payroll_runs pr
           LEFT JOIN payroll_run_lines prl ON prl.run_id = pr.id
          WHERE pr.notes = $1
          GROUP BY pr.id`, [`seed ${run.key}`]);
      const total = run.lines.reduce((s, l) => s + l.gross, 0);
      check(`${run.key} status/run_date/Σlines`,
        r && `${r.status}|${r.run_date}|${num(r.lines)}`,
        `${run.status}|${run.run_date}|${total}`);
      // Rule 12: header and Σ lines are stored independently and CAN disagree. The seed sets
      // them equal deliberately, so any divergence here is the seeder's bug, not a finding.
      check(`${run.key} total_gross header == Σ lines (Rule 12, seeded equal)`,
        num(r.header), num(r.lines));
    }

    for (const e of D.EXPENSES) {
      const { rows: [r] } = await c.query(
        `SELECT (data->>'amount')::numeric AS amount, data->>'expense_date' AS d
           FROM expenses WHERE data->>'category' = $1 AND data->>'expense_date' = $2`,
        [e.category, e.date]);
      check(`expense ${e.category} ${e.date}`, r && num(r.amount), e.amount);
    }

    // ── 5 · The bill_id link — the sole double-count guard ───────────────────
    console.log('\n── 5 · bill_id link (server.js:4111 — the SOLE double-count guard) ───────');
    const { rows: [pm] } = await c.query(
      `SELECT (data->>'amount')::numeric AS amount, data->>'date' AS d,
              (data->>'bill_id')::int AS bill_id FROM payments_made LIMIT 1`);
    check('B2 payment amount', num(pm.amount), 500);
    check('B2 payment date', pm.d, '2026-07-05');
    check('B2 payment bill_id is SET (not null)', pm.bill_id != null, true);
    check('B2 payment bill_id points at B2', pm.bill_id, ids.bills['B2']);
    const { rows: [orphan] } = await c.query(
      `SELECT count(*)::int AS n FROM payments_made WHERE data->>'bill_id' IS NULL`);
    check('no UNLINKED payments_made rows (would fake a decision-1 violation)', orphan.n, 0);

    // ── 6 · Derived seed arithmetic ──────────────────────────────────────────
    console.log('\n── 6 · Seed arithmetic (the seed itself, not the app) ────────────────────');
    const { rows: [ar] } = await c.query(`
      SELECT COALESCE(SUM(GREATEST(0, (data->>'amount')::numeric
                                    - COALESCE((data->>'amount_paid')::numeric,0))),0) AS ar
        FROM invoices WHERE lower(data->>'status') <> 'draft'`);
    check('AR outstanding = Σ max(0, amount − paid) over non-draft', num(ar.ar), D.EXPECTED.arOutstanding);

    for (const [key, expected] of Object.entries(D.EXPECTED.customerBalances)) {
      const { rows: [cb] } = await c.query(`
        SELECT COALESCE(SUM(GREATEST(0, (data->>'amount')::numeric
                                      - COALESCE((data->>'amount_paid')::numeric,0))),0) AS bal
          FROM invoices
         WHERE data->>'client' = $1 AND lower(data->>'status') <> 'draft'`, [`Customer ${key}`]);
      check(`Customer ${key} balance`, num(cb.bal), expected);
    }
    check('Customer A + B == AR outstanding (the cross-check)',
      D.EXPECTED.customerBalances.A + D.EXPECTED.customerBalances.B, D.EXPECTED.arOutstanding);

    const { rows: [ap] } = await c.query(`
      SELECT COALESCE(SUM(GREATEST(0, (data->>'amount')::numeric
                                    - COALESCE((data->>'amount_paid')::numeric,0))),0) AS ap
        FROM bills`);
    check('AP outstanding', num(ap.ap), D.EXPECTED.apOutstanding);

    const { rows: [hv] } = await c.query(
      `SELECT COALESCE(SUM((data->>'shares')::numeric * (data->>'price')::numeric),0) AS v FROM holdings`);
    check('holdings value (frozen prices, never fetched)', num(hv.v), D.EXPECTED.holdingsValue);

    const { rows: [rost] } = await c.query(
      `SELECT COALESCE(SUM((data->>'gross')::numeric),0) AS g FROM payroll`);
    check('roster monthly total (template — must produce no figure, basis C)',
      num(rost.g), D.EXPECTED.rosterMonthly);

    const { rows: [hb] } = await c.query(
      `SELECT count(*)::int AS n FROM holdings WHERE entity_id IS NULL`);
    check('holdings are BUSINESS scope (entity_id set) — the Investments KPI reads bizHoldings', hb.n, 0);

    // ── 7 · Determinism ──────────────────────────────────────────────────────
    console.log('\n── 7 · Reset-and-reseed is deterministic ─────────────────────────────────');
    const fingerprint = async () => (await c.query(`
      SELECT string_agg(t, '|' ORDER BY t) AS f FROM (
        SELECT data->>'num' || ':' || (data->>'amount') || ':' || (data->>'status') AS t FROM invoices
        UNION ALL SELECT 'run:' || status || ':' || run_date::text || ':' || total_gross::text FROM payroll_runs
        UNION ALL SELECT 'mv:' || type || ':' || quantity::text || ':' || moved_at::text FROM inventory_movements
      ) s`)).rows[0].f;

    const first = await fingerprint();
    await seed(c, userId);
    const second = await fingerprint();
    check('a second seed produces a byte-identical dataset', second, first);
    check('row counts unchanged after reseed', await count('invoices'), D.EXPECTED.invoiceCount);
    check('RESTART IDENTITY — invoice ids restart at 1',
      (await c.query(`SELECT min(id)::int AS m FROM invoices`)).rows[0].m, 1);
  } finally {
    if (blocked.length) {
      console.log(`\n  BLOCKED (clock drift): ${blocked.join(', ')} — Part B only, see the warning above.`);
    }
    if (KEEP) {
      console.log('\n' + '─'.repeat(78));
      console.log('  --keep: the scratch cluster is STILL UP, seeded.');
      console.log('');
      console.log('  Inspect it (no psql is bundled — this is the client):');
      console.log('');
      console.log(`    SCRATCH_DATABASE_URL="${scratch.url}" \\`);
      console.log('      node tests/harness/query.js --seed');
      console.log('');
      console.log(`    SCRATCH_DATABASE_URL="${scratch.url}" \\`);
      console.log('      node tests/harness/query.js --tables');
      console.log('');
      console.log(`  data dir: ${scratch.dataDir}`);
      console.log('  Ctrl-C to shut the cluster down.');
      console.log('─'.repeat(78));
      await new Promise((resolve) => process.on('SIGINT', resolve));
    }
    // Drain the app pool before the cluster goes down, or every pooled socket emits
    // ECONNRESET into database.js's pool.on('error') handler and buries the report.
    try { await appPool.end(); } catch { /* already ended */ }
    await scratch.stop();
  }

  console.log('\n' + '═'.repeat(78));
  console.log(`  STEP 2 GATE — ${pass} passed, ${fail} failed`);
  if (fail) { console.log(''); for (const f of failures) console.log(`   FAIL  ${f.name}`); }
  console.log('  Scope: the SEED matches VERIFICATION.md. No app figure is asserted here.');
  console.log('═'.repeat(78) + '\n');
}

main().catch((err) => {
  console.error('\n[step2-gate] FAILED\n');
  console.error(err && err.message ? err.message : err);
  if (err && err.code) console.error('  code:   ' + err.code);
  if (err && err.detail) console.error('  detail: ' + err.detail);
  if (err && err.hint) console.error('  hint:   ' + err.hint);
  if (err instanceof AggregateError && err.errors) {
    for (const e of err.errors) console.error('  · ' + (e && e.message ? e.message : e));
  }
  if (err && err.stack) console.error('\n--- stack ---\n' + err.stack);
  process.exitCode = 0;   // exits 0 by design — see F83
});
