'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * expected.js — THE single source of every expected value in the sweep.
 *
 * WHY THIS FILE EXISTS
 *   The expected values existed in THREE hand-maintained copies: VERIFICATION.md's P&L table,
 *   VERIFICATION.md's Part A check rows, and step3-gate.js. The Rule 4 seed revision updated
 *   two and missed one, and VERIFICATION.md contradicted itself for a commit — the multi-writer
 *   class (CLAUDE.md failure #2) inside the document written to catch it.
 *
 *   The next divergence could be the other way round: the GATE stale and the document right, so
 *   a real failure reports green. That is unacceptable, so the copies are collapsed to one.
 *
 * WHY IT LIVES BESIDE seedData.js
 *   Expected outputs and seed inputs must change together BY DEFINITION — an expected value is
 *   a statement about a specific seed. Separating them is what allowed them to drift.
 *
 * ── RULE 6: THESE ARE HAND-DERIVED, NOT COMPUTED BY THE CODE UNDER TEST ──────────────────
 *   Every number in COMPONENTS, PL, CASHFLOW and BALANCES is transcribed from VERIFICATION.md,
 *   where the owner derived it by hand from the seed. NOTHING here calls computeBooks or any
 *   application code. The code must never grade its own homework.
 *
 *   The identity self-check below is NOT a derivation of the expected values — it re-derives
 *   them from the COMPONENTS using the accounting identities stated in VERIFICATION.md's
 *   ACCOUNTING BASIS (owner decisions 1-3), and fails loudly if the hand-written totals
 *   disagree. That catches MY transcription errors. The value asserted against the server is
 *   always the hand-written one.
 */

const PERIODS = ['may', 'jun', 'jul', 'q2', 'q3', 'fy'];

const LABELS = {
  may: 'May 2026', jun: 'Jun 2026', jul: 'Jul 2026',
  q2: 'Q2 (Apr–Jun)', q3: 'Q3 (Jul–Sep)', fy: 'FY 2026',
};

// ── Components (VERIFICATION.md § EXPECTED VALUES → Components) ──────────────
const COMPONENTS = {
  may: { revenue: 1000, cogs: 400, manualExpenses: 600, billsIssued: 0, payroll: 0 },
  jun: { revenue: 5000, cogs: 200, manualExpenses: 750, billsIssued: 800, payroll: 4200 },
  jul: { revenue: 4000, cogs: 800, manualExpenses: 250, billsIssued: 500, payroll: 1100 },
  q2: { revenue: 6000, cogs: 600, manualExpenses: 1350, billsIssued: 800, payroll: 4200 },
  q3: { revenue: 4000, cogs: 800, manualExpenses: 250, billsIssued: 500, payroll: 1100 },
  fy: { revenue: 10000, cogs: 1400, manualExpenses: 1600, billsIssued: 1300, payroll: 5300 },
};

// ── P&L, accrual (VERIFICATION.md § P&L) ────────────────────────────────────
const PL = {
  may: { grossProfit: 600, opex: 600, netProfit: 0 },
  jun: { grossProfit: 4800, opex: 5750, netProfit: -950 },
  jul: { grossProfit: 3200, opex: 1850, netProfit: 1350 },
  q2: { grossProfit: 5400, opex: 6350, netProfit: -950 },
  q3: { grossProfit: 3200, opex: 1850, netProfit: 1350 },
  fy: { grossProfit: 8600, opex: 8200, netProfit: 400 },
};

// ── Cash flow, genuine cash basis (decision 3) ───────────────────────────────
const CASHFLOW = {
  may: { cashIn: 1000, cashOut: 600, net: 400 },
  jun: { cashIn: 500, cashOut: 750, net: -250 },
  jul: { cashIn: 0, cashOut: 1850, net: -1850 },
  q2: { cashIn: 1500, cashOut: 1350, net: 150 },
  q3: { cashIn: 0, cashOut: 1850, net: -1850 },
  fy: { cashIn: 1500, cashOut: 3200, net: -1700 },
};

// ── Balance-sheet / all-time figures (no period window by design) ────────────
const BALANCES = {
  arOutstanding: 8500,
  apOutstanding: 800,
  customerA: 1500,
  customerB: 7000,
  investments: 6000,
  rosterMonthly: 5000,
  allTimeCogs: 1650,
  paymentsReceivedTotal: 1500,   // ⚠️ source undecided — see F86
  invoiceCount: 5,
  overdueCount: 1,
};

// ── Identity self-check ──────────────────────────────────────────────────────
// The identities come from VERIFICATION.md's ACCOUNTING BASIS, not from server.js:
//   grossProfit = revenue − cogs
//   opex        = manual expenses + bills ISSUED + payroll     (decisions 1 and 2;
//                 payments made are settlement and are excluded)
//   netProfit   = grossProfit − opex
//   cash net    = cash in − cash out                            (decision 3)
//
// This does NOT make the harness grade its own homework: computeBooks is a different code path
// entirely, and a green run still requires the SERVER to produce the hand-written number. What
// this catches is a transcription slip between the document and this file — the exact failure
// that left VERIFICATION.md self-contradictory.
const identityErrors = [];
for (const p of PERIODS) {
  const c = COMPONENTS[p], l = PL[p], f = CASHFLOW[p];
  if (!c || !l || !f) { identityErrors.push(`${p}: missing a table entry`); continue; }
  const gross = c.revenue - c.cogs;
  const opex = c.manualExpenses + c.billsIssued + c.payroll;
  const net = gross - opex;
  if (gross !== l.grossProfit) identityErrors.push(`${p}: grossProfit ${l.grossProfit} != revenue−cogs ${gross}`);
  if (opex !== l.opex) identityErrors.push(`${p}: opex ${l.opex} != manual+bills+payroll ${opex}`);
  if (net !== l.netProfit) identityErrors.push(`${p}: netProfit ${l.netProfit} != gross−opex ${net}`);
  if (f.cashIn - f.cashOut !== f.net) identityErrors.push(`${p}: cash net ${f.net} != in−out ${f.cashIn - f.cashOut}`);
}
if (identityErrors.length) {
  throw new Error(
    '[expected] THE EXPECTED VALUES ARE INTERNALLY INCONSISTENT — refusing to run.\n  '
    + identityErrors.join('\n  ')
    + '\n\n  A sweep against inconsistent expectations reports failures that are transcription\n'
    + '  errors, and hides real ones. Fix tests/harness/expected.js before running anything.'
  );
}

/**
 * SEED FINGERPRINT — a short hash of the seed inputs AND the expected outputs.
 *
 * Stamped onto every result written into VERIFICATION.md. A Result cell measured against a
 * superseded seed is WORSE than an empty one: it reads as authoritative and is not. The
 * fingerprint makes staleness detectable — if the seed or the expectations change and the gate
 * is not re-run, the cell's stamp no longer matches, and verification-sync flags it.
 *
 * BOTH files feed the hash, deliberately:
 *   · seedData.js  — change the seed and prior measurements are of a different dataset.
 *   · expected.js  — change an expectation and a prior PASS/FAIL verdict may now mean the
 *                    opposite, even though the measured actual is unchanged.
 * The DateStyle/prose of VERIFICATION.md is NOT hashed — only the numbers that define what was
 * measured and what it was measured against.
 */
function seedFingerprint() {
  const h = crypto.createHash('sha256');
  for (const f of ['seedData.js', 'expected.js']) {
    h.update(fs.readFileSync(path.join(__dirname, f)));
  }
  return h.digest('hex').slice(0, 8);
}

/** The six A5 figures for one period, in the shape the server returns them. */
function serverFigures(period) {
  return {
    revenue: COMPONENTS[period].revenue,
    cogs: COMPONENTS[period].cogs,
    grossProfit: PL[period].grossProfit,
    opex: PL[period].opex,
    netProfit: PL[period].netProfit,
    outstanding: BALANCES.arOutstanding,
  };
}

module.exports = { PERIODS, LABELS, COMPONENTS, PL, CASHFLOW, BALANCES, serverFigures, seedFingerprint };
