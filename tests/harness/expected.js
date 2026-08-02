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
// Seed revision 2026-07-23 (F91 + D2c): added B0 (Apr bill 300, unpaid), R0 (Apr payroll run
// 900, approved) and INV-6 (future-dated invoice, contributes 0 under D2). Only Q2 and FY move —
// every monthly figure is unchanged. Q2 bills 800→1,100 and payroll 4,200→5,100 (April rows now
// distinct from June); FY bills 1,300→1,600 and payroll 5,300→6,200.
const COMPONENTS = {
  // F58: `revenue` is GROSS invoiced revenue and `creditNotes` is the contra, kept as separate
  // components rather than folded into one net figure. Folding would make the identity check
  // below unable to see the contra at all — the reported figure would be an assertion instead
  // of a derivation. creditNotes/vendorCredits are the RECOGNIZED sums (Open+Applied); CN-2 is
  // Void and contributes 0, which is what makes it a discriminator rather than decoration.
  may: { revenue: 1000, cogs: 400, manualExpenses: 600, billsIssued: 0, payroll: 0, creditNotes: 0, vendorCredits: 0 },
  jun: { revenue: 5000, cogs: 200, manualExpenses: 750, billsIssued: 800, payroll: 4200, creditNotes: 1200, vendorCredits: 300 },
  jul: { revenue: 4000, cogs: 800, manualExpenses: 250, billsIssued: 500, payroll: 1100, creditNotes: 0, vendorCredits: 0 },
  q2: { revenue: 6000, cogs: 600, manualExpenses: 1350, billsIssued: 1100, payroll: 5100, creditNotes: 1200, vendorCredits: 300 },
  q3: { revenue: 4000, cogs: 800, manualExpenses: 250, billsIssued: 500, payroll: 1100, creditNotes: 0, vendorCredits: 0 },
  fy: { revenue: 10000, cogs: 1400, manualExpenses: 1600, billsIssued: 1600, payroll: 6200, creditNotes: 1200, vendorCredits: 300 },
};

// ── P&L, accrual (VERIFICATION.md § P&L) ────────────────────────────────────
const PL = {
  // F58: these are NET of the contra legs (what the server reports and the A5 table states).
  may: { grossProfit: 600, opex: 600, netProfit: 0 },
  jun: { grossProfit: 3600, opex: 5450, netProfit: -1850 },
  jul: { grossProfit: 3200, opex: 1850, netProfit: 1350 },
  q2: { grossProfit: 4200, opex: 7250, netProfit: -3050 },
  q3: { grossProfit: 3200, opex: 1850, netProfit: 1350 },
  fy: { grossProfit: 7400, opex: 9100, netProfit: -1700 },
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
  arOutstanding: 8500,           // INV-6 (future) excluded under D2
  apOutstanding: 1100,           // B0 300 + B1 800 (both unpaid); B2 paid ⇒ 0
  customerA: 1500,
  customerB: 7000,               // INV-3 3,000 + INV-5 4,000; INV-6 future ⇒ 0
  investments: 6000,
  rosterMonthly: 5000,
  allTimeCogs: 1650,
  paymentsReceivedTotal: 1500,   // ⚠️ source undecided — see F86
  invoiceCount: 6,               // INV-1..6
  overdueCount: 1,
};

// ── Identity self-check ──────────────────────────────────────────────────────
// The identities come from VERIFICATION.md's ACCOUNTING BASIS, not from server.js:
//   netRevenue  = revenue − credit notes                        (F58 contra; Void excluded)
//   grossProfit = netRevenue − cogs
//   opex        = manual expenses + bills ISSUED + payroll      (decisions 1 and 2;
//                 payments made are settlement and are excluded)
//                 − vendor credits                              (F58 contra)
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
  const netRevenue = c.revenue - (c.creditNotes || 0);
  const gross = netRevenue - c.cogs;
  const opex = c.manualExpenses + c.billsIssued + c.payroll - (c.vendorCredits || 0);
  const net = gross - opex;
  if (gross !== l.grossProfit) identityErrors.push(`${p}: grossProfit ${l.grossProfit} != (revenue−creditNotes)−cogs ${gross}`);
  if (opex !== l.opex) identityErrors.push(`${p}: opex ${l.opex} != manual+bills+payroll−vendorCredits ${opex}`);
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
    // H6: read as utf8 and normalize line endings before hashing. Read as a raw Buffer, a
    // CRLF/LF flip on a core.autocrlf=true checkout changed the fingerprint while the CONTENT was
    // identical — firing a phantom "superseded seed" warning that, always firing, gets ignored.
    // Content identifies the seed, not line endings. Same normalization as bundle.js norm(). What
    // is hashed is unchanged: both files still feed the hash.
    h.update(fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n'));
  }
  return h.digest('hex').slice(0, 8);
}

/** The six A5 figures for one period, in the shape the server returns them. */
function serverFigures(period) {
  return {
    // F58: the server reports revenue NET of credit notes, so that is what the A5 row states.
    revenue: COMPONENTS[period].revenue - (COMPONENTS[period].creditNotes || 0),
    cogs: COMPONENTS[period].cogs,
    grossProfit: PL[period].grossProfit,
    opex: PL[period].opex,
    netProfit: PL[period].netProfit,
    outstanding: BALANCES.arOutstanding,
  };
}

module.exports = { PERIODS, LABELS, COMPONENTS, PL, CASHFLOW, BALANCES, serverFigures, seedFingerprint };
