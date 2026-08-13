'use strict';
/**
 * verify-f139-tax-consistency.js — PROVE (Rules 3/4/6/14) that the client Income-Tax worksheet and
 * the accountant Tax Summary compute the SAME taxable, on the ACCRUAL basis, from the REAL endpoints
 * against a REAL scratch Postgres — never a stub, never a re-implementation.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f139-tax-consistency.js
 *
 * SEED — one business, DISCRIMINATING (Rule 4). Revenue splits cash vs accrual; deductions cover
 * every factor-map variant, including the '100'/'50' the accountant Tax Summary used to MISS:
 *   INV-U  issued, status 'pending', $10,000, UNPAID  → accrual revenue YES, cash (paid-only) NO
 *   INV-P  issued, status 'paid',    $4,000,  PAID    → both bases
 *   EXP    deductible  yes $1000 · 100 $500 · half $800 · 50 $200 · no $9999
 *
 * OWNER-EXPECTED — hand-computed here, INDEPENDENT of the code under test (Rule 6):
 *   accrual revenue = 10000 + 4000               = 14000
 *   deductible      = (1000+500) + 0.5*(800+200) = 2000
 *   taxable         = 14000 − 2000               = 12000
 *
 * The bug moves the number THREE distinguishable ways, so the seed can tell the fix from the bug:
 *   · client uses CASH revenue        → client taxable = 4000 − 2000 = 2000   (≠ 12000)
 *   · accountant MISSES 100/50        → accountant deductible 1400 → taxable = 12600 (≠ 12000)
 * Fixed, both surfaces read computeBooks → client taxable === accountant taxable === 12000.
 *
 * FAIL-THEN-PASS: run once with the fix stashed (`git stash`) → this FAILS; `git stash pop` → GREEN.
 * This file is untracked, so it survives the stash.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { JSDOM } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
const { localNoonUtc } = require('./seed.js');

const CLIENT = { email: 'owner-f139@finflow.test', password: 'harness-password-not-a-secret' };
const ACC = { email: 'acc-f139@finflow.test', password: 'harness-accountant-not-a-secret' };

// Owner oracle — the numbers a human computes from the seed, never read from the app.
const EXPECT = { revenue: 14000, deductible: 2000, taxable: 12000 };

async function insertJson(c, table, userId, entityId, ymd, data) {
  const ts = localNoonUtc(ymd);
  const { rows } = await c.query(
    `INSERT INTO ${table} (user_id, entity_id, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz) RETURNING id`,
    [userId, entityId, data, ts]
  );
  return rows[0].id;
}

(async () => {
  let pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };
  const num = s => parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')) || 0;

  let scratch = null, server = null, appPool = null;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    ({ pool: appPool } = await initSchema(scratch.url));

    // ── Client (business owner) ──────────────────────────────────────────────
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: CLIENT.email, name: 'F139 Owner', plan: 'trial', role: 'owner',
         password: bcrypt.hashSync(CLIENT.password, 10) }]
    )).rows[0].id;

    // F150: business rows now require a non-null entity_id (chk_*_entity_nn added after this
    // harness was written). Create one active entity and stamp every invoice/expense to it; the
    // cash/accrual + deductible discriminating logic is unchanged — only storage now carries an entity.
    const eid = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
       VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [userId, { name: "F139 Co", currency: "USD", is_active: 1, sort_order: 0 }]
    )).rows[0].id;

    // Invoices — entity_id NULL (single business, no entity). issue_date inside FY2026, ≤ today (07-25).
    await insertJson(c, 'invoices', userId, eid, '2026-07-03', {
      client: 'Acme', amount: 10000, amount_paid: 0, status: 'pending',
      issue_date: '2026-07-03', due_date: '2026-07-03', num: 'INV-U' });
    await insertJson(c, 'invoices', userId, eid, '2026-07-04', {
      client: 'Beta', amount: 4000, amount_paid: 4000, status: 'paid',
      issue_date: '2026-07-04', due_date: '2026-07-04', num: 'INV-P' });

    // Expenses — one of every deductible variant, incl. the '100'/'50' the accountant missed.
    const exp = (ymd, amount, deductible, desc) =>
      insertJson(c, 'expenses', userId, eid, ymd, { description: desc, category: 'Ops', amount, deductible, expense_date: ymd });
    await exp('2026-07-05', 1000, 'yes', 'Full A');
    await exp('2026-07-06', 500, '100', 'Full B (100 variant)');
    await exp('2026-07-07', 800, 'half', 'Half C');
    await exp('2026-07-08', 200, '50', 'Half D (50 variant)');
    await exp('2026-07-09', 9999, 'no', 'Non-deductible (must be excluded)');

    // ── Accountant + active, verified client link ────────────────────────────
    const accId = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'verified', NOW(), NOW()) RETURNING id`,
      [ACC.email, bcrypt.hashSync(ACC.password, 10), 'Ada', 'Ledger', 'REF-F139']
    )).rows[0].id;
    await c.query(
      `INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, invited_at, activated_at)
       VALUES ($1, $2, 'active', 'edit', NOW(), NOW())`,
      [accId, userId]
    );

    // ── Boot the real server; two independent cookie sessions ────────────────
    server = await bootServer(scratch.url);
    const clientHttp = new HarnessHttp(server.baseUrl);
    const lc = await clientHttp.post('/api/auth/login', CLIENT);
    A('client login 200', lc.status === 200, `status=${lc.status} body=${(lc.text || '').slice(0, 160)}`);
    const accHttp = new HarnessHttp(server.baseUrl);
    const la = await accHttp.post('/api/accountants/login', ACC);
    A('accountant login 200 (verified)', la.status === 200, `status=${la.status} body=${(la.text || '').slice(0, 160)}`);

    // ── Client leg: the REAL /api/tax-filing (fiscal-year, January) ──────────
    const tfRes = await clientHttp.get('/api/tax-filing?fyStart=0');
    A('GET /api/tax-filing 200', tfRes.status === 200, `status=${tfRes.status} body=${(tfRes.text || '').slice(0, 160)}`);
    const tf = tfRes.json || {};

    // ── Accountant leg: the REAL /books endpoint, default scope (all entities, year) ──
    const bRes = await accHttp.get(`/api/accountants/clients/${userId}/books`);
    A('GET /api/accountants/clients/:id/books 200', bRes.status === 200, `status=${bRes.status} body=${(bRes.text || '').slice(0, 160)}`);
    const books = bRes.json || {};
    const summary = books.summary || {};

    // ── Accountant "taxable" = the SHIPPED renderTax(), fed the REAL /books response ──
    // Extract the actual function from accountant-client.html (verify-f138 technique) and run it in
    // a minimal DOM. This executes the real UI code path, not a re-implementation (Rule 14).
    const src = fs.readFileSync(path.join(process.cwd(), 'public', 'accountant-client.html'), 'utf8');
    const start = src.indexOf('function renderTax(invoices, expenses)');
    const end = src.indexOf('// ── NOTES', start);
    A('renderTax extracted from accountant-client.html', start >= 0 && end > start, `start=${start} end=${end}`);
    const fnSrc = src.slice(start, end);
    const dom = new JSDOM('<div id="tax-liability"></div><div id="tax-deductible"></div><div id="tax-taxable"></div><div id="tax-rate-warning" style="display:none"></div><div id="tax-breakdown"></div>');
    const document = dom.window.document;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const renderTax = new Function('document', 'set', 'fmt', '_data', fnSrc + '\n; return renderTax;')(document, set, fmt, books);
    // Pass the SAME rows the accountant page would (getFiltered at 'year' = all rows). Pre-fix
    // renderTax reads them; post-fix it reads _data.summary and ignores them.
    renderTax(books.allInvoices || [], books.allExpenses || []);
    const accTaxable = num(document.getElementById('tax-taxable').textContent);
    const accDeductible = num(document.getElementById('tax-deductible').textContent);

    console.log(`\n  [client /api/tax-filing]  revenue=${tf.revenue} deductible=${tf.deductible} taxableIncome=${tf.taxableIncome}`);
    console.log(`  [accountant /books.summary] revenue=${summary.revenue} deductible=${summary.deductible} full=${summary.deductibleFull} half=${summary.deductibleHalf}`);
    console.log(`  [accountant renderTax UI]  taxable=${accTaxable} deductible=${accDeductible}`);
    console.log(`  [owner-expected]           revenue=${EXPECT.revenue} deductible=${EXPECT.deductible} taxable=${EXPECT.taxable}\n`);

    // ── Assertions against the owner oracle ──────────────────────────────────
    A('client revenue is ACCRUAL 14000 (NOT cash/paid-only 4000)', tf.revenue === EXPECT.revenue, `got ${tf.revenue}`);
    A('client deductible 2000 (yes+100 full, half+50 at 50%)', tf.deductible === EXPECT.deductible, `got ${tf.deductible}`);
    A('client taxableIncome === 12000 (owner-expected)', tf.taxableIncome === EXPECT.taxable, `got ${tf.taxableIncome}`);

    A('accountant summary.revenue 14000', num(summary.revenue) === EXPECT.revenue, `got ${summary.revenue}`);
    A('accountant summary.deductible 2000 (INCLUDES 100/50 variants)', num(summary.deductible) === EXPECT.deductible, `got ${summary.deductible}`);
    A('accountant Tax Summary taxable (shipped renderTax) === 12000', accTaxable === EXPECT.taxable, `got ${accTaxable}`);

    A('CONSISTENCY: client taxableIncome === accountant taxable === 12000',
      tf.taxableIncome === accTaxable && accTaxable === EXPECT.taxable,
      `client=${tf.taxableIncome} accountant=${accTaxable}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch { /* ignore */ }
    try { if (appPool) await appPool.end(); } catch { /* ignore */ }
    try { if (scratch) await scratch.stop(); } catch { /* ignore */ }
  }
  // Force the code EXPLICITLY (not process.exitCode): embedded-postgres.stop() spawns a
  // fire-and-forget taskkill on Windows whose lingering child defeats the natural drain-and-exit
  // that process.exitCode relies on — and a money-path gate that prints FAIL but exits 0 is exactly
  // the "test that can't fail" trap. All output above is already flushed synchronously.
  const code = fail === 0 ? 0 : 1;
  console.log(`  exit code: ${code}`);
  process.exit(code);
})();
