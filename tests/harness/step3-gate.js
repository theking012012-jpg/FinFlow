'use strict';
/**
 * step3-gate.js — the SERVER PROBE. A5, A7-server, and A6's server half.
 *
 *   node -r ./tests/harness/clock.js tests/harness/step3-gate.js [--keep]
 *
 * Real HTTP to the real server on the real seeded scratch database. Every figure below is
 * READ FROM A RESPONSE — nothing is recomputed here and compared to itself (Rule 6).
 *
 * Expected values come from VERIFICATION.md, which derives them from the seed by hand. They
 * are NOT derived from computeBooks. That is the whole point: the code must not grade its own
 * homework, and during the payroll double-count every consistency check passed while all three
 * surfaces were wrong together.
 *
 * SCOPE: /api/reports only. /books is deliberately NOT gated here (owner sequencing) — it
 * needs an accountant row, a verified status and a client link, none of which should block the
 * first working server probe. It comes next, because /books diverging from /api/reports is
 * exactly the multi-writer class this codebase keeps regrowing.
 *
 * This gate REPORTS. It does not diagnose and it does not fix (VERIFICATION rule 1).
 */

const bcrypt = require('bcryptjs');
const clock = require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');
const { PERIODS, toQuery } = require('./periods.js');
const { measureDrift, reportDrift } = require('./drift.js');
const { printSubstrateHeader, printBlockedRequests } = require('./substrate.js');
const EXPECTED = require('./expected.js');
const { writeResults } = require('./verification-sync.js');

const KEEP = process.argv.includes('--keep');
// F83: exit-0 by default keeps an interactive sweep readable; --strict (or STRICT=1) makes the gate a
// real regression signal for automated callers — non-zero on any FAIL or a thrown error.
const STRICT = process.argv.includes('--strict') || process.env.STRICT === '1';
const LOGIN = { email: 'seed@finflow.test', password: 'harness-password-not-a-secret' };

let pass = 0, fail = 0;
const failures = [];

function check(id, name, got, want) {
  const ok = (typeof want === 'number' && typeof got === 'number')
    ? Math.abs(got - want) < 0.005
    : got === want;
  if (ok) { pass++; console.log(`  PASS  ${id.padEnd(9)} ${name}`); }
  else {
    fail++;
    failures.push({ id, name, got, want });
    console.log(`  FAIL  ${id.padEnd(9)} ${name}`);
    console.log(`                  actual   ${JSON.stringify(got)}`);
    console.log(`                  expected ${JSON.stringify(want)}`);
    if (typeof got === 'number' && typeof want === 'number') {
      console.log(`                  delta    ${(got - want) > 0 ? '+' : ''}${Math.round((got - want) * 100) / 100}`);
    }
  }
}

// Expected values come from the SINGLE SOURCE. This file previously held its own transcribed
// copy — the third of three, and the one the Rule 4 seed revision missed. A local copy here is
// the most dangerous of the three: a stale GATE reports a real failure as green, whereas a
// stale document merely misleads a reader.
const EXPECT = {
  jun: EXPECTED.serverFigures('jun'),
  jul: EXPECTED.serverFigures('jul'),
  fy: EXPECTED.serverFigures('fy'),
};
// A5 numbering: A5.1-3 revenue, .4-6 cogs, .7-9 grossProfit, .10-12 opex, .13-15 netProfit,
// .16-18 outstanding — each triple ordered Jun / Jul / FY.
const A5_BASE = { revenue: 1, cogs: 4, grossProfit: 7, opex: 10, netProfit: 13, outstanding: 16 };
const PERIOD_OFFSET = { jun: 0, jul: 1, fy: 2 };

async function main() {
  const scratch = await startScratchPostgres({ keep: KEEP });
  const c = scratch.client;

  printSubstrateHeader(scratch.facts, {
    port: scratch.port, dataDir: scratch.dataDir, keep: KEEP,
    pinnedIso: clock.PINNED_ISO, tz: clock.TZ, scrubbed: null,
  });

  const { rows: [nowRow] } = await c.query('SELECT NOW() AS n');
  const blocked = reportDrift(measureDrift(nowRow.n));

  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;

  try {
    // ── Seed, then log in as a real user over real HTTP ─────────────────────
    // The user is created in SQL (with a real bcrypt hash) and the SESSION is established by
    // POST /api/auth/login — so entity resolution runs the same path a browser takes. Nothing
    // pre-seeds session.entityId; the middleware picks the active entity itself
    // (server.js:665), which is what production does on first load.
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{
        email: LOGIN.email, name: 'Seed Owner', plan: 'trial', role: 'owner',
        password: bcrypt.hashSync(LOGIN.password, 10),
      }]
    )).rows[0].id;

    const { entityId, ids } = await seed(c, userId);

    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);

    console.log('── 0 · Session and scope ─────────────────────────────────────────────────');
    const login = await http.post('/api/auth/login', LOGIN);
    check('S0.1', 'login over real HTTP returns 200', login.status, 200);
    if (login.status !== 200) {
      console.log(`\n  Cannot probe without a session. Body: ${login.text.slice(0, 300)}\n`);
      return;
    }

    // Prove the server resolved the SEEDED entity. If it resolved null or a stale id, every
    // figure would read 0 and look like a catastrophic product failure rather than a harness
    // scoping mistake. Establish this BEFORE asserting any money.
    const me = await http.get('/api/auth/me');
    check('S0.2', 'GET /api/auth/me authenticated', me.status, 200);
    const ents = await http.get('/api/entities');
    check('S0.3', 'seeded entity is visible to the session',
      ents.json && ents.json.length === 1 && ents.json[0].id === entityId, true);

    // ── A5 · /api/reports, three periods ────────────────────────────────────
    console.log('\n── A5 · Server engine — GET /api/reports (real HTTP) ─────────────────────');
    const responses = {};
    const measured = {};
    for (const key of ['jun', 'jul', 'fy']) {
      const p = PERIODS[key];
      const url = `/api/reports?${toQuery(p)}`;
      const res = await http.get(url);
      responses[key] = res;

      console.log(`\n  ${p.label}  ${p.start.toISOString()} → ${p.end.toISOString()}  (elapsedMonths ${p.elapsedMonths})`);
      if (res.status !== 200) {
        console.log(`  !! HTTP ${res.status} — ${res.text.slice(0, 200)}`);
        for (const f of Object.keys(A5_BASE)) {
          check(`A5.${A5_BASE[f] + PERIOD_OFFSET[key]}`, `${f} (${p.label})`, `HTTP ${res.status}`, EXPECT[key][f]);
        }
        continue;
      }
      const j = res.json;
      // The response names opex `expenses` (server.js:3313: `expenses: totalExp`, and
      // totalExp = books.opex). Mapping it explicitly rather than assuming the label.
      const actual = {
        revenue: j.revenue, cogs: j.cogs, grossProfit: j.grossProfit,
        opex: j.expenses, netProfit: j.netProfit, outstanding: j.outstanding,
      };
      measured[key] = actual;
      for (const f of Object.keys(A5_BASE)) {
        check(`A5.${A5_BASE[f] + PERIOD_OFFSET[key]}`, `${f} (${p.label})`,
          typeof actual[f] === 'number' ? actual[f] : (actual[f] ?? null), EXPECT[key][f]);
      }
    }

    // ── A7 (server-reachable subset) ────────────────────────────────────────
    console.log('\n── A7 · Page-level figures reachable from the server ─────────────────────');

    // A7.1 / A7.2 / A7.20 — AR, invoice count, AP.
    const inv = await http.get('/api/invoices');
    if (inv.status === 200) {
      const rows = inv.json || [];
      const RECOGNIZED = new Set(['pending', 'overdue', 'partial', 'paid']);
      // D2 — VERIFICATION's AR formula is "recognised, non-draft, NON-FUTURE" (seedData.js:154).
      // INV-6 (2026-09-01) is scheduled, not issued, so it is excluded — the SAME exclusion the
      // server applies to computeBooks.outstanding (A5.16-18). This clause was missing here.
      const _fd = require('../../public/finflow-dates.js');
      const _today = _fd.resolvedToday(new Date());
      const ar = rows.filter(r => RECOGNIZED.has(String(r.status || '').toLowerCase()))
        .filter(r => { const d = _fd._toYmd(r.issue_date || r.created_at || r.date); return d != null && d <= _today; })
        .reduce((s, r) => s + Math.max(0, (parseFloat(r.amount) || 0) - (parseFloat(r.amount_paid) || 0)), 0);
      check('A7.1', 'invoices total outstanding', Math.round(ar * 100) / 100, 8500);
      check('A7.2', 'invoice rows returned (all 6 stored; draft excluded from revenue not the list)',
        rows.length, 6);
      check('A7.3', 'exactly one overdue invoice (subtitle must not read "all paid")',
        rows.filter(r => String(r.status).toLowerCase() === 'overdue').length, 1);
    } else {
      check('A7.1', 'GET /api/invoices', `HTTP ${inv.status}`, 200);
    }

    const bills = await http.get('/api/bills');
    if (bills.status === 200) {
      const ap = (bills.json || []).reduce(
        (s, b) => s + Math.max(0, (parseFloat(b.amount) || 0) - (parseFloat(b.amount_paid) || 0)), 0);
      check('A7.20', 'bills / AP outstanding', Math.round(ap * 100) / 100, 1100);
    } else {
      check('A7.20', 'GET /api/bills', `HTTP ${bills.status}`, 200);
    }

    // A7.4 — Payments Received. F86/F95: payments_received (Store A) is confirmed empty in
    // production (the one test row was deleted); invoice_payments (Store B) is the canonical
    // "Payments Received" figure. Expected 1,500 = the seed's own INVOICE_PAYMENTS rows
    // (INV-1 1,000 + INV-2 500 — tests/harness/seedData.js), derived fresh, not reused blind.
    // Sourced via GET /api/bank-reconciliation's unmatchedPayments (a superset-when-nothing's-
    // reconciled read of the same table, true for this seed — kept as an independent second
    // path to the same figure, cross-checked against A7.4b below which hits the route the live
    // page actually calls).
    const br = await http.get('/api/bank-reconciliation');
    if (br.status === 200) {
      const total = (br.json?.unmatchedPayments || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      check('A7.4', 'invoice_payments total (Payments Received, Store B canonical)', Math.round(total * 100) / 100, 1500);
    } else {
      check('A7.4', 'GET /api/bank-reconciliation', `HTTP ${br.status}`, 200);
    }

    // A7.4b — F95 step 2: GET /api/invoice-payments (NO invoice_id) is the route the Payments
    // Received page itself now calls (finflow-api-wiring-pages.js loadPaymentsReceived). This
    // route used to REQUIRE invoice_id and 400 without one; a no-arg list branch was added
    // specifically for this page. Verify by execution: exactly 2 rows (INV-1, INV-2), each
    // invoice_id resolves to the REAL seeded invoice id (proves the client-side customer/num
    // join in the page has something real to join against, not a coincidentally-matching
    // number), and the total is the same seed-derived 1,500 as A7.4.
    const ip = await http.get('/api/invoice-payments');
    if (ip.status === 200) {
      const ipRows = ip.json || [];
      check('A7.4b', 'GET /api/invoice-payments (no arg) row count', ipRows.length, 2);
      const invIds = new Set(ipRows.map(r => r.invoice_id));
      check('A7.4b-join', 'every row\'s invoice_id resolves to a real seeded invoice',
        invIds.has(ids.invoices['INV-1']) && invIds.has(ids.invoices['INV-2']), true);
      const ipTotal = ipRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      check('A7.4b-total', 'GET /api/invoice-payments (no arg) total', Math.round(ipTotal * 100) / 100, 1500);
    } else {
      check('A7.4b', 'GET /api/invoice-payments (no arg)', `HTTP ${ip.status}`, 200);
    }

    // A7.9-11 — Cash Flow cash-in (F95 fix). VERIFICATION.md:415 (decided pre-existing spec,
    // never previously gated): Jun 500 / Jul 0 / FY 1,500. Derived fresh from the seed's own
    // INVOICE_PAYMENTS (seedData.js:48-51) at payment_date: INV-1 1,000 on 2026-05-15 (May, not
    // Jun/Jul, counts toward FY only) + INV-2 500 on 2026-06-20 (Jun and FY). sales_receipts is
    // seeded empty this dataset, so it contributes 0 throughout. FY = sum of all months present
    // (every seeded invoice_payments row falls in calendar 2026, so totalInflow == the FY figure
    // with no separate windowing needed).
    const cf = await http.post('/api/reports/cash-flow', {});
    if (cf.status === 200) {
      const rowFor = k => (cf.json?.rows || []).find(r => r.key === k);
      const junInflow = rowFor('2026-06')?.inflow ?? 0;
      const julInflow = rowFor('2026-07')?.inflow ?? 0;
      check('A7.9',  'Cash Flow cash-in — Jun', Math.round(junInflow * 100) / 100, 500);
      check('A7.10', 'Cash Flow cash-in — Jul', Math.round(julInflow * 100) / 100, 0);
      check('A7.11', 'Cash Flow cash-in — FY',  Math.round((cf.json?.totalInflow ?? NaN) * 100) / 100, 1500);

      // A7.12-17 — cash OUT and NET. VERIFICATION.md:416-417 stated these from the beginning and
      // NOTHING EVER RAN THEM: both Result columns were empty while only cash-IN was gated. That
      // gap is precisely why F122 (no payroll leg in the cash endpoint) survived — the one leg
      // with the defect was the one leg no check touched. Adding them here closes it.
      //
      // Jun 750 = Rent 150 + Software 600 (expenses only; R1 is `approved`, NOT paid ⇒ no cash).
      // Jul 1,850 = Marketing 250 + B2 payment 500 + R3 payroll 1,100. R3 is the sole `paid` run
      //   (seedData.js), so it is the ONLY payroll contributing cash — R0/R1 approved-not-paid and
      //   R2 draft all contribute 0. That makes Jul the discriminating period: without the F122
      //   payroll leg it reads 750, and 750 != 1,850 unambiguously.
      // FY 3,200 = May 600 + Jun 750 + Jul 1,850.
      const junOut = rowFor('2026-06')?.outflow ?? 0;
      const julOut = rowFor('2026-07')?.outflow ?? 0;
      const fyOut  = cf.json?.totalOutflow ?? NaN;
      check('A7.12', 'Cash Flow cash-out — Jun', Math.round(junOut * 100) / 100, 750);
      check('A7.13', 'Cash Flow cash-out — Jul', Math.round(julOut * 100) / 100, 1850);
      check('A7.14', 'Cash Flow cash-out — FY',  Math.round(fyOut * 100) / 100, 3200);
      // Net is asserted from the ROW's own net field, not recomputed here as in−out: recomputing
      // would only re-test the two checks above and could not catch a row whose `net` disagrees
      // with its own inflow/outflow (the endpoint builds `net` separately, so that is a real
      // possibility, not a hypothetical).
      const junNet = rowFor('2026-06')?.net ?? NaN;
      const julNet = rowFor('2026-07')?.net ?? NaN;
      check('A7.15', 'Cash Flow net — Jun', Math.round(junNet * 100) / 100, -250);
      check('A7.16', 'Cash Flow net — Jul', Math.round(julNet * 100) / 100, -1850);
      check('A7.17', 'Cash Flow net — FY',
        Math.round(((cf.json?.totalInflow ?? NaN) - (cf.json?.totalOutflow ?? NaN)) * 100) / 100, -1700);
    } else {
      check('A7.9',  'POST /api/reports/cash-flow', `HTTP ${cf.status}`, 200);
    }

    // A7.22 — AP-D2 (balance-sheet AP leg): a FUTURE-dated bill is SCHEDULED, not yet payable, and
    // must contribute 0 to AP, exactly as INV-6 does to AR (A7.1). The seed has no future bill, so
    // insert a transient one via the API, confirm the server-computed AP is unchanged, then remove
    // it. Without the D2 filter this 4242 bill would inflate AP to 5342.
    const _bsBefore = await http.post('/api/reports/balance-sheet', {});
    check('A7.22a', 'balance-sheet AP baseline (no future bill)', _bsBefore.json && _bsBefore.json.accountsPayable, 1100);
    const _futBill = await http.post('/api/bills', { vendor: 'FUTURE PROBE D2', amount: 4242, status: 'unpaid', issue_date: '2027-03-15' });
    // H3: assert the insert ACTUALLY happened before trusting A7.22b. If this POST fails, no bill is
    // created and A7.22b passes trivially — AP is unchanged because nothing was added, not because D2
    // filtered it. Check 2xx + a non-null id FIRST, so a failed insert reports as a failed insert.
    const _futCreated = _futBill.status >= 200 && _futBill.status < 300 && _futBill.json && _futBill.json.id != null;
    check('A7.22-insert', 'probe future-dated bill was actually created (2xx + non-null id)',
      _futCreated ? true : `HTTP ${_futBill.status}, id ${_futBill.json && _futBill.json.id}`, true);
    const _bsAfter = await http.post('/api/reports/balance-sheet', {});
    check('A7.22b', 'future-dated bill contributes 0 to AP (D2)', _bsAfter.json && _bsAfter.json.accountsPayable, 1100);
    if (_futBill.json && _futBill.json.id != null) await http.del('/api/bills/' + _futBill.json.id);

    // A7.21 — the roster is a TEMPLATE. Basis C: it must produce no expense figure. The card
    // itself is informational and should read 5,000.
    const roster = await http.get('/api/payroll');
    if (roster.status === 200) {
      const monthly = (roster.json || []).reduce((s, e) => s + (parseFloat(e.gross) || 0), 0);
      check('A7.21', 'payroll roster card (informational only — contributes 0 to expense)',
        Math.round(monthly * 100) / 100, 5000);
    } else {
      check('A7.21', 'GET /api/payroll', `HTTP ${roster.status}`, 200);
    }

    // A7.23-25 — Record Payment settle contract (F113/F114): the exact server behavior the
    // revived modal now relies on for full payment, a stacking partial, and overpayment
    // rejection. Each probe cleans up after itself (same discipline as A7.22's transient bill)
    // so later checks — and any re-run — see the original seed state.

    // A7.23 — full payment on a fresh pending invoice (INV-3: pending, 3000, 0 paid).
    const _inv3Id = ids.invoices['INV-3'];
    const _fullPay = await http.post('/api/invoice-payments', {
      invoice_id: _inv3Id, amount: 3000, payment_date: '2026-07-20', method: 'bank_transfer',
    });
    const _fullCreated = _fullPay.status >= 200 && _fullPay.status < 300 && _fullPay.json && _fullPay.json.id != null;
    check('A7.23-insert', 'full-payment probe was actually created (2xx + non-null id)',
      _fullCreated ? true : `HTTP ${_fullPay.status}`, true);
    const _inv3After = await http.get('/api/invoices');
    const _inv3Row = (_inv3After.json || []).find(r => r.id === _inv3Id);
    check('A7.23', 'full payment settles the invoice (status paid, amount_paid == total)',
      _inv3Row ? `${_inv3Row.status}|${Math.round((parseFloat(_inv3Row.amount_paid) || 0) * 100) / 100}` : null,
      'paid|3000');
    if (_fullCreated) await http.del('/api/invoice-payments/' + _fullPay.json.id);

    // A7.24 — a SECOND partial payment on an already-partial invoice (INV-2: partial, 2000
    // total, 500 already paid via the seed) STACKS rather than replaces: status stays 'partial',
    // amount_paid increments, and a second invoice_payments row exists. Amount/date deliberately
    // differ from the seed's own INV-2 payment (500 on 2026-06-20) so the B8/C1 dedupe guard
    // (invoice+amount+date) cannot mistake this for a duplicate of it.
    const _inv2Id = ids.invoices['INV-2'];
    const _partPay = await http.post('/api/invoice-payments', {
      invoice_id: _inv2Id, amount: 300, payment_date: '2026-07-15', method: 'bank_transfer',
    });
    const _partCreated = _partPay.status >= 200 && _partPay.status < 300 && _partPay.json && _partPay.json.id != null;
    check('A7.24-insert', 'second partial-payment probe was actually created (2xx + non-null id)',
      _partCreated ? true : `HTTP ${_partPay.status}`, true);
    const _inv2After = await http.get('/api/invoices');
    const _inv2Row = (_inv2After.json || []).find(r => r.id === _inv2Id);
    check('A7.24-status', 'second partial does NOT flip status to paid', _inv2Row ? _inv2Row.status : null, 'partial');
    check('A7.24-amount', 'amount_paid INCREMENTS (500 + 300), not replaced',
      _inv2Row ? Math.round((parseFloat(_inv2Row.amount_paid) || 0) * 100) / 100 : null, 800);
    const _inv2Payments = await http.get('/api/invoice-payments?invoice_id=' + _inv2Id);
    check('A7.24-rows', 'a SECOND invoice_payments row exists for INV-2 (stacked, not replaced)',
      (_inv2Payments.json || []).length, 2);
    if (_partCreated) await http.del('/api/invoice-payments/' + _partPay.json.id);

    // A7.25 — overpayment rejected. INV-1 is already fully paid by the seed (1000/1000,
    // remaining 0), so ANY positive amount overpays it — a clean, guaranteed case needing no
    // computed "just over remaining" amount, and it touches no other check's invoice.
    const _inv1Id = ids.invoices['INV-1'];
    const _overPay = await http.post('/api/invoice-payments', {
      invoice_id: _inv1Id, amount: 100, payment_date: '2026-07-20', method: 'bank_transfer',
    });
    check('A7.25', 'overpayment rejected with HTTP 400', _overPay.status, 400);
    check('A7.25-msg', 'rejection names the remaining balance',
      typeof _overPay.json?.error === 'string' && _overPay.json.error.includes('exceeds the remaining balance'), true);
    const _inv1Payments = await http.get('/api/invoice-payments?invoice_id=' + _inv1Id);
    check('A7.25-norow', 'no new row was written on rejection', (_inv1Payments.json || []).length, 1);
    const _inv1After = await http.get('/api/invoices');
    const _inv1RowAfter = (_inv1After.json || []).find(r => r.id === _inv1Id);
    check('A7.25-unchanged', 'invoice amount_paid unchanged on rejection',
      _inv1RowAfter ? Math.round((parseFloat(_inv1RowAfter.amount_paid) || 0) * 100) / 100 : null, 1000);

    // ── A6 (server half) · cross-period coherence ───────────────────────────
    console.log('\n── A6 · Server-side coherence ────────────────────────────────────────────');
    if (responses.jun.status === 200 && responses.jul.status === 200 && responses.fy.status === 200) {
      const j = responses;
      check('A6.s1', 'grossProfit == revenue − cogs (Jun)',
        Math.round((j.jun.json.revenue - j.jun.json.cogs) * 100) / 100, j.jun.json.grossProfit);
      check('A6.s2', 'netProfit == grossProfit − opex (Jun)',
        Math.round((j.jun.json.grossProfit - j.jun.json.expenses) * 100) / 100, j.jun.json.netProfit);
      check('A6.s3', 'outstanding is identical across all three periods (all-time by design)',
        `${j.jun.json.outstanding}|${j.jul.json.outstanding}|${j.fy.json.outstanding}`,
        `${j.fy.json.outstanding}|${j.fy.json.outstanding}|${j.fy.json.outstanding}`);
      // NOT a correctness check — a divergence detector. If FY != Jun+Jul the periods do not
      // partition the year, which is a different defect from any single figure being wrong.
      check('A6.s4', 'FY revenue >= Jun + Jul revenue (May and earlier are also in FY)',
        j.fy.json.revenue >= j.jun.json.revenue + j.jul.json.revenue, true);
    }

    // ── Write the measured results INTO VERIFICATION.md ─────────────────────
    // Not a manual step afterwards. Results that live in a terminal while the document shows
    // an empty Result column is F55's mechanism, and it already happened once this session:
    // A5.10-15's failures were reported in chat and a commit message while the document
    // recorded nothing had been run.
    console.log('\n── Writing results into VERIFICATION.md ──────────────────────────────────');
    const A5_ROWS = {
      revenue: 'A5.1–3', cogs: 'A5.4–6', grossProfit: 'A5.7–9',
      opex: 'A5.10–12', netProfit: 'A5.13–15', outstanding: 'A5.16–18',
    };
    // F112 (owner decision 2026-08-07): each written cell carries ONLY the seed fingerprint,
    // no run date. The fingerprint identifies the exact dataset a result was measured against
    // (verification-sync flags it stale the moment the seed or expectations change); git blame
    // records WHEN each cell was last written. The wall-clock date added nothing the fingerprint
    // and git did not already carry, and it CHURNED — a gate run on a new calendar day rewrote
    // every cell's date even when the figure was byte-identical, forcing a decision on whether to
    // commit a pure date bump. Dropping it makes a re-run on an unchanged seed produce identical
    // cells, so VERIFICATION.md only moves when a figure or the seed actually moves.
    const fp = EXPECTED.seedFingerprint();
    const fmtN = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
    const toWrite = {};
    for (const [field, rowId] of Object.entries(A5_ROWS)) {
      if (!measured.jun || !measured.jul || !measured.fy) break;
      const got = ['jun', 'jul', 'fy'].map((k) => measured[k][field]);
      const want = ['jun', 'jul', 'fy'].map((k) => EXPECT[k][field]);
      const ok = got.every((v, i) => typeof v === 'number' && Math.abs(v - want[i]) < 0.005);
      toWrite[rowId] = ok
        ? `PASS (seed ${fp})`
        : `**FAIL** — actual ${got.map(fmtN).join(' / ')} (seed ${fp})`;
    }
    const written = writeResults(toWrite);
    console.log(`  ${written.length} Result cell(s) updated: ${written.join(', ') || '(none matched)'}`);
  } finally {
    console.log('');
    printBlockedRequests();
    if (blocked.length) {
      console.log(`  BLOCKED (clock drift): ${blocked.join(', ')} — Part B only.`);
    }
    if (KEEP) {
      console.log('\n' + '─'.repeat(78));
      console.log('  --keep: cluster still up, seeded.');
      console.log(`\n    SCRATCH_DATABASE_URL="${scratch.url}" \\`);
      console.log('      node tests/harness/query.js --seed\n');
      console.log('  Ctrl-C to shut down.');
      console.log('─'.repeat(78));
      await new Promise((resolve) => process.on('SIGINT', resolve));
    }
    if (server) await server.close();
    try { await appPool.end(); } catch { /* already ended */ }
    await scratch.stop();
  }

  console.log('\n' + '═'.repeat(78));
  console.log(`  STEP 3 GATE — ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\n  FAILURES (actual vs expected — NOT diagnosed, per VERIFICATION rule 1):');
    for (const f of failures) {
      console.log(`    ${f.id.padEnd(9)} ${f.name}`);
      console.log(`              actual ${JSON.stringify(f.got)}  ·  expected ${JSON.stringify(f.want)}`);
    }
  }
  console.log('\n  Scope: /api/reports only. /books not yet gated. Client surfaces not yet read.');
  console.log('═'.repeat(78) + '\n');
  // F83: process.exit(code), NOT process.exitCode — embedded-postgres' async-exit-hook resets
  // exitCode on natural exit; every probe exits this way. Cleanup already ran in main's finally.
  process.exit(STRICT && fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n[step3-gate] FAILED\n');
  console.error(err && err.message ? err.message : err);
  if (err && err.code) console.error('  code:   ' + err.code);
  if (err && err.detail) console.error('  detail: ' + err.detail);
  if (err instanceof AggregateError && err.errors) {
    for (const e of err.errors) console.error('  · ' + (e && e.message ? e.message : e));
  }
  if (err && err.stack) console.error('\n--- stack ---\n' + err.stack);
  process.exit(STRICT ? 1 : 0);   // F83: a thrown error is a failure under --strict
});
