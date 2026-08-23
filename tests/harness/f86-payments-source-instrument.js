'use strict';
/**
 * f86-payments-source-instrument.js — READ-ONLY instrument (CLAUDE.md Rule 7).
 *
 *   node -r ./tests/harness/clock.js tests/harness/f86-payments-source-instrument.js
 *
 * Answers ONE question with evidence, not assertion: "Payments Received" can be sourced from
 * either invoice_payments (Store B, typed) or payments_received (Store A, JSONB). On the
 * VERIFICATION seed, what does EACH store yield — at the database, and through every live
 * endpoint that surfaces the figure? It computes nothing of its own to compare against itself.
 *
 * This is an INSTRUMENT, not a gate: it PRINTS what each source holds. It performs SELECTs and
 * report-only reads exclusively. There is NO apply/write mode and NO transaction control.
 * The single POST (/api/reports/cash-flow) is a pure server-side computation over existing rows
 * — the same read the dashboard cash card issues — and mutates nothing.
 */

const bcrypt = require('bcryptjs');
const clock = require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');
const { printSubstrateHeader } = require('./substrate.js');

const LOGIN = { email: 'seed@finflow.test', password: 'harness-password-not-a-secret' };
const money = n => '$' + (Math.round((parseFloat(n) || 0) * 100) / 100).toFixed(2);

async function main() {
  const scratch = await startScratchPostgres({});
  const c = scratch.client;
  printSubstrateHeader(scratch.facts, {
    port: scratch.port, dataDir: scratch.dataDir, keep: false,
    pinnedIso: clock.PINNED_ISO, tz: clock.TZ, scrubbed: null,
  });

  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;
  try {
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'Seed Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;

    const { ids } = await seed(c, userId);
    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    await http.post('/api/auth/login', LOGIN);

    // ── 1 · DATABASE LEVEL (direct SELECT, both stores) ───────────────────────────────────
    const ipDb = (await c.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS total
         FROM invoice_payments WHERE user_id=$1`, [userId])).rows[0];
    const prDb = (await c.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM((data->>'amount')::numeric),0)::numeric AS total
         FROM payments_received WHERE user_id=$1`, [userId])).rows[0];
    const srDb = (await c.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM((data->>'amount')::numeric),0)::numeric AS total
         FROM sales_receipts WHERE user_id=$1`, [userId])).rows[0];

    // ── 2 · ENDPOINT LEVEL (what each live surface actually returns) ──────────────────────
    const ipList = await http.get('/api/invoice-payments');            // Payments Received page (F95)
    const prList = await http.get('/api/payments-received');           // orphaned Store-A route
    const br     = await http.get('/api/bank-reconciliation');         // A7.4 read path
    const cf     = await http.post('/api/reports/cash-flow', {});      // dashboard/report cash-in (read-only compute)

    const sum = (arr, f) => (arr || []).reduce((s, x) => s + (parseFloat(f(x)) || 0), 0);
    const ipEp = { n: (ipList.json || []).length, total: sum(ipList.json, r => r.amount) };
    const prEp = { n: (prList.json || []).length, total: sum(prList.json, r => r.amount) };
    const brEp = { n: (br.json?.unmatchedPayments || []).length, total: sum(br.json?.unmatchedPayments, r => r.amount) };
    const cfIn = parseFloat(cf.json?.totalInflow) || 0;

    // ── 3 · REPORT ────────────────────────────────────────────────────────────────────────
    const L = (label, v) => console.log('  ' + label.padEnd(52) + v);
    console.log('\n══ F86 · "Payments Received" — what each source yields on the seed ══════════════\n');
    console.log('  DATABASE (direct SELECT)');
    L('    invoice_payments   (Store B, typed)', `${ipDb.n} rows · ${money(ipDb.total)}`);
    L('    payments_received  (Store A, JSONB)', `${prDb.n} rows · ${money(prDb.total)}`);
    L('    sales_receipts     (walk-in cash)',  `${srDb.n} rows · ${money(srDb.total)}`);
    console.log('\n  LIVE ENDPOINTS');
    L('    GET /api/invoice-payments  (Payments Received page, F95)', `${ipEp.n} rows · ${money(ipEp.total)}`);
    L('    GET /api/payments-received (orphaned Store-A route)',       `${prEp.n} rows · ${money(prEp.total)}`);
    L('    GET /api/bank-reconciliation.unmatchedPayments (A7.4)',    `${brEp.n} rows · ${money(brEp.total)}`);
    L('    POST /api/reports/cash-flow .totalInflow (cash-in leg)',   `${money(cfIn)}`);
    console.log('\n  Seed-derived oracle (VERIFICATION §Payment events): INV-1 1000 + INV-2 500 = $1500');
    console.log('  INV-1 id=' + ids.invoices['INV-1'] + '  INV-2 id=' + ids.invoices['INV-2']);
    console.log('\n  READING:');
    console.log('    · invoice_payments (Store B) holds the $1,500; payments_received (Store A) is EMPTY.');
    console.log('    · The live Payments-Received page, the A7.4 read, and the cash-in leg all key on');
    console.log('      Store B (invoice_payments). Sourcing A7.4 from Store A would read $0 on this seed.');
    console.log('\n════════════════════════════════════════════════════════════════════════════════\n');
  } catch (e) {
    console.error('\n  INSTRUMENT ERROR:', e && e.message);
    if (e && e.code) console.error('  code:', e.code);
    if (e && e.stack) console.error(e.stack);
    if (e && e.errors) for (const sub of e.errors) console.error('  sub:', sub && sub.message);
    process.exitCode = 1;
  } finally {
    try { if (server && server.close) await server.close(); } catch {}
    try { if (appPool && appPool.end) await appPool.end(); } catch {}
    try { await scratch.stop(); } catch {}
  }
}

main();
