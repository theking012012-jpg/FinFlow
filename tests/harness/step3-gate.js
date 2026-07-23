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

    const { entityId } = await seed(c, userId);

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
      const ar = rows.filter(r => RECOGNIZED.has(String(r.status || '').toLowerCase()))
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

    // A7.4 — payments received.
    const ip = await http.get('/api/invoice-payments');
    if (ip.status === 200) {
      const total = (ip.json || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      check('A7.4', 'payments received total', Math.round(total * 100) / 100, 1500);
    } else {
      check('A7.4', 'GET /api/invoice-payments', `HTTP ${ip.status}`, 200);
    }

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
    // Every written cell carries the run date AND the seed fingerprint. A result measured
    // against a superseded seed is worse than an empty cell — it looks authoritative. The
    // fingerprint lets verification-sync flag it the moment the seed or expectations change.
    const stamp = new clock.RealDate().toISOString().slice(0, 10);
    const fp = EXPECTED.seedFingerprint();
    const fmtN = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
    const toWrite = {};
    for (const [field, rowId] of Object.entries(A5_ROWS)) {
      if (!measured.jun || !measured.jul || !measured.fy) break;
      const got = ['jun', 'jul', 'fy'].map((k) => measured[k][field]);
      const want = ['jun', 'jul', 'fy'].map((k) => EXPECT[k][field]);
      const ok = got.every((v, i) => typeof v === 'number' && Math.abs(v - want[i]) < 0.005);
      toWrite[rowId] = ok
        ? `PASS (${stamp} · seed ${fp})`
        : `**FAIL** — actual ${got.map(fmtN).join(' / ')} (${stamp} · seed ${fp})`;
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
  process.exitCode = 0;   // exits 0 by design — see F83
});
