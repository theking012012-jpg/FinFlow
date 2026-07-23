'use strict';
/**
 * vocabulary.js — the status gate the DATABASE does not provide (F79).
 *
 * F77's stated fix assumed a real `INSERT` would have rejected the impossible `status:'final'`
 * that let 62 green assertions ship three defects. It would not have. The schema has exactly
 * ONE CHECK constraint across ~40 tables (`accountant_reviews.rating`, database.js:259);
 * `payroll_runs.status` is bare `TEXT DEFAULT 'draft'` (database.js:388), and invoice/bill
 * statuses live inside a JSONB `data` column where a column constraint is not expressible at all.
 *
 * So moving to real Postgres removes the *stub* but supplies NO vocabulary guard. Without this
 * file the rebuilt harness reproduces the exact F77 trap on a real database — where it would
 * look considerably more authoritative than it did on a hand-written pool stub.
 *
 * Every vocabulary below is READ FROM THE SHIPPED CODE, with the citation, not from memory.
 * `CLAUDE.md` Rule 11: never guess status values.
 */

// Invoices. Recognition allowlist is server.js:4053 —
//   const RECOGNIZED = new Set(['pending','overdue','partial','paid']);
// 'draft' is a VALID status that is deliberately EXCLUDED from revenue, so it is legal to
// seed but must never be recognised. The two ideas are different and are kept separate here.
const INVOICE_STATUSES  = new Set(['draft', 'pending', 'overdue', 'partial', 'paid']);
const INVOICE_RECOGNIZED = new Set(['pending', 'overdue', 'partial', 'paid']);

// Bills. server.js:3389 —
//   const RECOGNIZED_BILL = new Set(['unpaid','due_soon','overdue','partial','paid']);
// A DIFFERENT vocabulary from invoices (Rule 11: "the invoice AR helper does not apply to AP").
const BILL_STATUSES   = new Set(['unpaid', 'due_soon', 'overdue', 'partial', 'paid']);
const BILL_RECOGNIZED = new Set(['unpaid', 'due_soon', 'overdue', 'partial', 'paid']);

// Payroll runs. database.js:388 (column default) + VERIFICATION decision 2.
// NOTE: 'final' is the F77 value. It is NOT in this set, and that is the whole point.
const PAYROLL_RUN_STATUSES = new Set(['draft', 'approved', 'paid']);
// Recognition begins at 'approved'; 'paid' is DOWNSTREAM of approved and still counts.
// VERIFICATION's ⚠️ IMPLEMENTATION TRAP: `status = 'approved'` alone would make the expense
// DISAPPEAR when a run is marked paid.
const PAYROLL_RUN_RECOGNIZED = new Set(['approved', 'paid']);

const VOCABULARIES = {
  invoice: { valid: INVOICE_STATUSES, source: 'server.js:4053 (RECOGNIZED) + draft' },
  bill: { valid: BILL_STATUSES, source: 'server.js:3389 (RECOGNIZED_BILL)' },
  payroll_run: { valid: PAYROLL_RUN_STATUSES, source: 'database.js:388 + VERIFICATION decision 2' },
};

class VocabularyError extends Error {}

/**
 * Reject an unknown status BEFORE it can be inserted. Throws — never warns, never coerces.
 *
 * @param {'invoice'|'bill'|'payroll_run'} kind
 * @param {string} status
 * @param {string} label  identifies the row in the failure message (e.g. 'INV-4', 'R2')
 */
function assertStatus(kind, status, label) {
  const v = VOCABULARIES[kind];
  if (!v) throw new VocabularyError(`[vocabulary] unknown kind "${kind}" for ${label}`);
  const s = String(status || '').toLowerCase();
  if (!v.valid.has(s)) {
    throw new VocabularyError(
      `[vocabulary] REJECTED — ${label}: "${status}" is not a valid ${kind} status.\n`
      + `  Permitted: ${[...v.valid].join(' / ')}\n`
      + `  Source:    ${v.source}\n`
      + `  The database would have ACCEPTED this value — it has no CHECK constraint on status\n`
      + `  (F79), and for JSONB-backed tables it cannot have one. This gate is the only thing\n`
      + `  standing between the seed and the F77 failure: a value that cannot exist in the\n`
      + `  product, sailing through a green test run.`
    );
  }
  return s;
}

module.exports = {
  VocabularyError,
  VOCABULARIES,
  INVOICE_STATUSES, INVOICE_RECOGNIZED,
  BILL_STATUSES, BILL_RECOGNIZED,
  PAYROLL_RUN_STATUSES, PAYROLL_RUN_RECOGNIZED,
  assertStatus,
};
