#!/usr/bin/env node
// scripts/payroll-basis-inventory.js — READ-ONLY inventory for the payroll basis-C decision.
//
// Dry-run ONLY. This tool never writes: no apply mode, no migration, no backup, no rollback,
// no DDL. Every statement is a SELECT. It answers AUDIT_MASTER Step 3a: what does payroll
// history actually look like before basis C (payroll_runs = single source of truth) is applied.
// It READS process.env.DATABASE_URL / NODE_ENV; it assigns to neither.
//
//   PowerShell, one session (this project does NOT use dotenv — .env is not read):
//     $env:DATABASE_URL = "<Railway PUBLIC connection string>"
//     $env:NODE_ENV     = "production"      # dbSsl() only enables TLS in production
//     node scripts/payroll-basis-inventory.js --user 1
//     Remove-Item Env:\DATABASE_URL         # clear the credential when done
//
//   node scripts/payroll-basis-inventory.js             # all users
//   node scripts/payroll-basis-inventory.js --user 1    # one user
//   node scripts/payroll-basis-inventory.js --json      # machine-readable
//
// THREE payroll representations exist today; C names #3 the system of record:
//   1. ROSTER          `payroll` rows — a RATE with no dates. Feeds the synthetic
//                      monthlyPayroll × elapsedMonths accrual that C deletes.
//   2. MANUAL EXPENSE  `expenses` rows in a salary-ish category — dated, hand-entered.
//                      C makes these the wrong representation.
//   3. PAYROLL RUNS    `payroll_runs` + `payroll_run_lines` — dated events. C's source.
//
// ⚠️ On category matching: the salary-category regex below is used for REPORTING ONLY. It is
// deliberately NOT the fix mechanism — regex-matching a free-text category was ruled out
// (option D) precisely because it is fragile. To keep that honest this tool also prints EVERY
// distinct expense category with counts, so anything the pattern missed is visible rather than
// silently excluded. Read that full list before deciding cleanup.
'use strict';

// Broad on purpose: over-report, then let a human narrow it. REPORTING ONLY.
const SALARY_RE = /salar|payroll|wage|paye/i;

// Render a failure so it is DIAGNOSABLE. The first version printed only `e.message`, which is
// the one field that is EMPTY on Node's dual-stack connect failure: with DATABASE_URL unset, pg
// falls back to localhost, both ::1 and 127.0.0.1 refuse, and Node raises an AggregateError whose
// .message is "" while the real causes sit in .errors and the code sits in .code. The result was
// a blank line after the colon — a failure message that says nothing, which is the same class of
// useless as a green test that proves nothing.
function _explainError(e) {
  const L = [];
  const msg = e && typeof e.message === 'string' ? e.message.trim() : '';
  L.push(msg || `(no message — error was ${e && e.constructor ? e.constructor.name : typeof e})`);
  if (e && e.code) L.push(`code: ${e.code}`);
  if (e && e.detail) L.push(`detail: ${e.detail}`);
  if (e && e.hint) L.push(`hint: ${e.hint}`);
  // AggregateError hides the real causes here.
  if (e && Array.isArray(e.errors) && e.errors.length) {
    L.push(`${e.errors.length} underlying error(s):`);
    e.errors.forEach((s, i) => L.push(`   [${i}] ${s && s.code ? s.code + ' ' : ''}${(s && s.message) || String(s)}`));
  }
  if (e && e.stack) L.push('', String(e.stack));
  return L.join('\n');
}

// Fail fast with an actionable message instead of an opaque ECONNREFUSED against localhost.
// READS process.env; never assigns to it.
function preflight() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error([
      'DATABASE_URL is not set, so pg would fall back to localhost and fail with ECONNREFUSED.',
      '',
      'This project does NOT use dotenv — a .env file is not read. Set it for the shell session:',
      '',
      '  PowerShell:  $env:DATABASE_URL = "<Railway PUBLIC connection string>"',
      '               $env:NODE_ENV     = "production"   # required: enables TLS for the proxy',
      '               node scripts/payroll-basis-inventory.js --user 1',
      '',
      'Use the PUBLIC url (proxy host), not the *.railway.internal one — internal hosts only',
      'resolve inside Railway. This tool only issues SELECTs; it changes nothing.',
    ].join('\n'));
    process.exit(2);
  }
  if (/railway\.internal/i.test(url)) {
    console.error([
      'DATABASE_URL points at a *.railway.internal host, which only resolves INSIDE Railway.',
      'From your machine this will fail with ENOTFOUND. Use the PUBLIC connection string',
      '(Railway → Postgres service → Variables → DATABASE_PUBLIC_URL, or Connect → Public Network).',
    ].join('\n'));
    process.exit(2);
  }
  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  NODE_ENV is not "production", so database.js dbSsl() disables TLS and the'
      + ' Railway proxy will likely reject the connection. Set $env:NODE_ENV = "production" for this run.');
  }
}

const _n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const _month = v => {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const _range = arr => {
  const xs = arr.filter(Boolean).sort();
  return xs.length ? { from: xs[0], to: xs[xs.length - 1] } : { from: null, to: null };
};

// Pure, DB-free so the logic can be proven against a fixture without a live connection.
function classifyPayrollBasis({ expenses = [], runs = [], lines = [], roster = [], entities = [] }) {
  const curOf = new Map();  // entity_id -> currency (expenses carry no currency of their own)
  const nameOf = new Map();
  for (const e of entities) { curOf.set(e.id, e.currency || 'USD'); nameOf.set(e.id, e.name || `entity ${e.id}`); }
  const cur = eid => (eid == null ? '(unassigned)' : (curOf.get(eid) || 'USD'));

  // ── 1. Manual salary expense rows ──────────────────────────────────────────
  const salaryRows = expenses.filter(e => SALARY_RE.test(String(e.category || '')));
  const byCurrency = {};
  for (const r of salaryRows) {
    const c = cur(r.entity_id);
    byCurrency[c] = byCurrency[c] || { count: 0, total: 0 };
    byCurrency[c].count++; byCurrency[c].total += _n(r.amount);
  }
  const salaryMonths = salaryRows.map(r => _month(r.expense_date || r.date || r.created_at));

  // Every distinct category, so a missed variant is visible rather than silently dropped.
  const allCategories = {};
  for (const e of expenses) {
    const c = String(e.category || '(none)');
    allCategories[c] = allCategories[c] || { count: 0, total: 0, matchedBySalaryRegex: SALARY_RE.test(c) };
    allCategories[c].count++; allCategories[c].total += _n(e.amount);
  }

  // ── 2. Payroll runs + lines ────────────────────────────────────────────────
  const linesByRun = new Map();
  for (const l of lines) {
    if (!linesByRun.has(l.run_id)) linesByRun.set(l.run_id, []);
    linesByRun.get(l.run_id).push(l);
  }
  const runReport = runs.map(r => {
    const ls = linesByRun.get(r.id) || [];
    // Σ lines vs the run header total — if they disagree, the fix must know which to read.
    const lineGross = ls.reduce((s, l) => s + _n(l.gross) + _n(l.bonus) + _n(l.overtime), 0);
    const lineNet = ls.reduce((s, l) => s + _n(l.net_pay), 0);
    return {
      id: r.id, user_id: r.user_id, entity_id: r.entity_id ?? null,
      period: r.period || null, run_date: r.run_date || null, status: r.status || null,
      month: _month(r.run_date) || _month(r.period),
      currency: cur(r.entity_id),
      headerGross: _n(r.total_gross), headerNet: _n(r.total_net),
      lineCount: ls.length, lineGross: Math.round(lineGross * 100) / 100, lineNet: Math.round(lineNet * 100) / 100,
      headerMatchesLines: Math.abs(_n(r.total_gross) - lineGross) < 0.01,
      orphanLines: ls.length === 0,
    };
  });

  // ── 3. Overlap — months history currently double-counts ────────────────────
  const salaryByMonth = {};
  for (const r of salaryRows) {
    const m = _month(r.expense_date || r.date || r.created_at); if (!m) continue;
    const k = `${r.user_id}|${r.entity_id ?? 'null'}|${m}`;
    salaryByMonth[k] = salaryByMonth[k] || { user_id: r.user_id, entity_id: r.entity_id ?? null, month: m, count: 0, total: 0 };
    salaryByMonth[k].count++; salaryByMonth[k].total += _n(r.amount);
  }
  const runByMonth = {};
  for (const r of runReport) {
    if (!r.month) continue;
    const k = `${r.user_id}|${r.entity_id ?? 'null'}|${r.month}`;
    runByMonth[k] = runByMonth[k] || { count: 0, total: 0 };
    runByMonth[k].count++; runByMonth[k].total += r.lineGross || r.headerGross;
  }
  const overlap = Object.keys(salaryByMonth)
    .filter(k => runByMonth[k])
    .map(k => ({ ...salaryByMonth[k], runCount: runByMonth[k].count, runTotal: Math.round(runByMonth[k].total * 100) / 100,
                 doubleCounted: Math.round((salaryByMonth[k].total + runByMonth[k].total) * 100) / 100 }));

  // ── Roster — the synthetic figure C deletes ────────────────────────────────
  const rosterByEntity = {};
  for (const p of roster) {
    const k = p.entity_id ?? 'null';
    rosterByEntity[k] = rosterByEntity[k] || { entity_id: p.entity_id ?? null, entity: nameOf.get(p.entity_id) || '(unassigned)',
                                               currency: cur(p.entity_id), headcount: 0, monthlyGross: 0 };
    rosterByEntity[k].headcount++; rosterByEntity[k].monthlyGross += _n(p.gross);
  }

  return {
    manualSalary: {
      count: salaryRows.length,
      total: Math.round(salaryRows.reduce((s, r) => s + _n(r.amount), 0) * 100) / 100,
      byCurrency, dateRange: _range(salaryMonths),
      rows: salaryRows.map(r => ({ id: r.id, user_id: r.user_id, entity_id: r.entity_id ?? null,
        category: r.category, amount: _n(r.amount), date: r.expense_date || r.date || null,
        description: r.description || '', currency: cur(r.entity_id) })),
    },
    allCategories,
    runs: {
      count: runReport.length,
      dateRange: _range(runReport.map(r => r.month)),
      totalLineGross: Math.round(runReport.reduce((s, r) => s + r.lineGross, 0) * 100) / 100,
      totalHeaderGross: Math.round(runReport.reduce((s, r) => s + r.headerGross, 0) * 100) / 100,
      totalLines: runReport.reduce((s, r) => s + r.lineCount, 0),
      headerLineMismatches: runReport.filter(r => !r.headerMatchesLines).map(r => r.id),
      runsWithNoLines: runReport.filter(r => r.orphanLines).map(r => r.id),
      detail: runReport,
    },
    roster: { entities: Object.values(rosterByEntity),
              totalMonthlyGross: Math.round(Object.values(rosterByEntity).reduce((s, e) => s + e.monthlyGross, 0) * 100) / 100 },
    overlap,
  };
}

function render(res, elapsedMonths) {
  const m = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const L = [];
  L.push('=== Payroll basis C — READ-ONLY inventory ===');
  L.push('(nothing below was modified; every statement was a SELECT)');
  L.push('');

  L.push('── 1. MANUAL SALARY EXPENSE ROWS (C makes these the wrong representation) ──');
  L.push(`rows ......................... ${res.manualSalary.count}`);
  L.push(`total ........................ ${m(res.manualSalary.total)}`);
  L.push(`date range ................... ${res.manualSalary.dateRange.from || '—'} → ${res.manualSalary.dateRange.to || '—'}`);
  for (const [c, v] of Object.entries(res.manualSalary.byCurrency)) L.push(`   ${c}: ${v.count} row(s), ${m(v.total)}`);
  for (const r of res.manualSalary.rows) {
    L.push(`   • id ${r.id}  ${r.currency} ${m(r.amount)}  ${r.date || '(no date)'}  cat="${r.category}"  "${String(r.description).slice(0, 40)}"`);
  }
  if (!res.manualSalary.count) L.push('   (none — nothing to clean up)');
  L.push('');

  L.push('── ALL expense categories (so a missed variant is visible, not silently excluded) ──');
  for (const [c, v] of Object.entries(res.allCategories).sort((a, b) => b[1].total - a[1].total)) {
    L.push(`   ${v.matchedBySalaryRegex ? '►' : ' '} ${c.padEnd(24)} ${String(v.count).padStart(4)} row(s)  ${m(v.total).padStart(14)}`);
  }
  L.push('   ► = matched the salary pattern above. Check the unmarked ones for anything that is really payroll.');
  L.push('');

  L.push('── 2. PAYROLL RUNS (C\'s system of record) ──');
  L.push(`runs ......................... ${res.runs.count}`);
  L.push(`lines ........................ ${res.runs.totalLines}`);
  L.push(`run_date range ............... ${res.runs.dateRange.from || '—'} → ${res.runs.dateRange.to || '—'}`);
  L.push(`Σ line gross(+bonus+OT) ...... ${m(res.runs.totalLineGross)}`);
  L.push(`Σ run header gross ........... ${m(res.runs.totalHeaderGross)}`);
  if (res.runs.headerLineMismatches.length) L.push(`   ⚠ header ≠ Σ lines on run id(s): ${res.runs.headerLineMismatches.join(', ')} — the fix must read ONE of these; flag before Step 4`);
  if (res.runs.runsWithNoLines.length) L.push(`   ⚠ run(s) with ZERO lines: ${res.runs.runsWithNoLines.join(', ')} — would contribute 0 payroll under C`);
  for (const r of res.runs.detail) {
    L.push(`   • run ${r.id}  ${r.currency}  period="${r.period}"  run_date=${r.run_date || '(none)'}  month=${r.month || '—'}  lines=${r.lineCount}  gross=${m(r.lineGross)}  status=${r.status}`);
  }
  if (!res.runs.count) L.push('   (none — C would report ZERO payroll expense until a run exists; see the note below)');
  L.push('');

  L.push('── 3. OVERLAP — months history currently DOUBLE-COUNTS ──');
  if (!res.overlap.length) L.push('   (none — no month has both a manual salary row and a payroll run)');
  for (const o of res.overlap) {
    L.push(`   • user ${o.user_id} entity ${o.entity_id ?? '(none)'} ${o.month}: manual ${m(o.total)} (${o.count} row(s)) + run ${m(o.runTotal)} (${o.runCount}) = ${m(o.doubleCounted)} currently counted`);
  }
  L.push('');

  L.push('── ROSTER — the synthetic figure C deletes ──');
  for (const e of res.roster.entities) {
    L.push(`   • ${e.entity} (${e.currency}): ${e.headcount} on roster, ${m(e.monthlyGross)}/month`);
  }
  if (!res.roster.entities.length) L.push('   (roster empty)');
  L.push(`   Σ monthly gross .......... ${m(res.roster.totalMonthlyGross)}`);
  if (elapsedMonths) {
    L.push(`   synthetic accrual now .... ${m(res.roster.totalMonthlyGross * elapsedMonths)}  (= Σ gross × ${elapsedMonths} elapsed months)`);
    L.push('   ^ this is the phantom figure currently in your Year expenses. Under C it becomes 0.');
  }
  L.push('');
  L.push('── WHAT C WOULD CHANGE (projection only — nothing applied) ──');
  L.push(`   payroll expense today ≈ synthetic ${m(res.roster.totalMonthlyGross * (elapsedMonths || 0))} + manual ${m(res.manualSalary.total)}`);
  L.push(`   payroll expense under C = ${m(res.runs.totalLineGross)}  (run lines only)`);
  L.push('');
  L.push('This tool wrote nothing. Any cleanup of the rows above is a separate, owner-gated step.');
  return L.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const uIdx = argv.indexOf('--user');
  const userId = uIdx >= 0 ? Number(argv[uIdx + 1]) : null;
  const asJson = argv.includes('--json');
  preflight();                                   // before the require: database.js reads DATABASE_URL at import
  const { pool, rowToObj } = require('../database.js');
  const where = userId != null ? ' WHERE user_id = $1' : '';
  const p = userId != null ? [userId] : [];
  try {
    const [exp, runs, roster, ents] = await Promise.all([
      pool.query(`SELECT * FROM expenses${where}`, p),
      pool.query(`SELECT * FROM payroll_runs${where} ORDER BY run_date, id`, p),
      pool.query(`SELECT * FROM payroll${where}`, p),
      pool.query(`SELECT * FROM entities${where}`, p),
    ]);
    // Lines join through their parent run, so scope by the run ids we just read.
    const runIds = runs.rows.map(r => r.id);
    const lines = runIds.length
      ? await pool.query(`SELECT * FROM payroll_run_lines WHERE run_id = ANY($1::int[])`, [runIds])
      : { rows: [] };

    // Elapsed fiscal months, Jan-start default — matches the client's _fyContext default so the
    // projected synthetic figure lines up with what the dashboard is showing right now.
    const now = new Date();
    const elapsedMonths = now.getMonth() + 1;

    const res = classifyPayrollBasis({
      expenses: exp.rows.map(rowToObj),
      runs: runs.rows,                       // typed table — no JSONB unwrap
      lines: lines.rows,                     // typed table
      roster: roster.rows.map(rowToObj),
      entities: ents.rows.map(rowToObj),
    });
    console.log(asJson ? JSON.stringify({ ...res, elapsedMonths }, null, 2) : render(res, elapsedMonths));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[payroll-basis-inventory] failed:\n' + _explainError(e)); process.exit(1); });
}

module.exports = { classifyPayrollBasis, render, SALARY_RE };
