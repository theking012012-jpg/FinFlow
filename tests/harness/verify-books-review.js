'use strict';
/**
 * verify-books-review.js — executes the SHIPPED cleanup/anomaly engine against a
 * discriminating seed.
 *
 * WHAT IS EXECUTED: the real, shipped buildReviewItems() from ../../books-review.js — the
 * exact function the GET /api/books-review route calls. This is not a re-implementation and
 * not a source-text extraction (Rule 5 corollary: importable over extracted). The row objects
 * fed in have the exact shape db.allByUser → rowToObj returns (data fields spread onto the row
 * with id / entity_id), so the engine runs on production-shaped input.
 *
 * WHAT IS *NOT* EXECUTED HERE, AND WHY: the thin HTTP wrapper around the engine — requireAuth,
 * scopeId, _entityScopeFilter, and the three db.allByUser reads. The embedded-postgres substrate
 * (CLAUDE.md Rule 3 / F77) cannot boot in this sandbox: as root, embedded-postgres drops to an
 * unprivileged `postgres` OS user to run initdb, and the sandbox denies that user the chmod of
 * the data directory ("Operation not permitted"). The wrapper mirrors /api/expenses' own scoping
 * line-for-line and is labelled UNEXECUTED in the commit so nobody later cites it as verified.
 *
 * Rule 4: the seed DISCRIMINATES — every detector has a POSITIVE row that must flag AND a
 * near-miss NEGATIVE row that must NOT, so an over- or under-firing detector moves a count.
 * Rule 6: the expected counts are computed by hand from the seed, never read from the engine.
 *
 * Owner oracle (hand-computed):
 *   uncategorized = 2   (Uncat A cat 'Other'  +  Uncat B no category)
 *   duplicate     = 3   (1 expense pair + 1 invoice pair + 1 bill pair → one flag each)
 *   missing       = 2   (expense with no date  +  invoice with no due_date)
 *   outlier       = 1   (Software 5000 vs median 100; Rent 9000 below MIN_N, Travel 500 below K)
 *   total         = 8
 */

const { buildReviewItems } = require('../../books-review.js');

// db.allByUser → rowToObj spreads the JSONB `data` onto the row alongside id / entity_id.
// These factories produce exactly that shape. ids are assigned in insert order so "earliest
// id = original" is exercised for the duplicate detector.
let _id = 0;
const EID = 7;
const exp = (description, category, amount, expense_date) => {
  const r = { id: ++_id, entity_id: EID, amount, deductible: 'no' };
  if (description !== undefined) r.description = description;
  if (category !== undefined) r.category = category;
  if (expense_date !== undefined) r.expense_date = expense_date;
  return r;
};

const expenses = [];
const invoices = [];
const bills = [];

// OUTLIER positive: 'Software' 6 rows, median 100 → threshold 800; only 5000 flags.
expenses.push(exp('Soft 1', 'Software', 100, '2026-07-01'));
expenses.push(exp('Soft 2', 'Software', 100, '2026-07-02'));
expenses.push(exp('Soft 3', 'Software', 100, '2026-07-03'));
expenses.push(exp('Soft 4', 'Software', 100, '2026-07-04'));
expenses.push(exp('Soft 5', 'Software', 100, '2026-07-05'));
expenses.push(exp('Soft 6 BIG', 'Software', 5000, '2026-07-06'));     // ← the only outlier

// OUTLIER negative (below MIN_N): 'Rent' 3 rows; the 9000 must NOT flag.
expenses.push(exp('Rent 1', 'Rent', 100, '2026-07-07'));
expenses.push(exp('Rent 2', 'Rent', 100, '2026-07-08'));
expenses.push(exp('Rent 3 HUGE', 'Rent', 9000, '2026-07-09'));        // below MIN_N → no flag

// OUTLIER negative (below K): 'Travel' 6 rows, median 100, 500 < 800 → no flag.
expenses.push(exp('Trav 1', 'Travel', 100, '2026-07-10'));
expenses.push(exp('Trav 2', 'Travel', 100, '2026-07-11'));
expenses.push(exp('Trav 3', 'Travel', 100, '2026-07-12'));
expenses.push(exp('Trav 4', 'Travel', 100, '2026-07-13'));
expenses.push(exp('Trav 5', 'Travel', 100, '2026-07-14'));
expenses.push(exp('Trav 6', 'Travel', 500, '2026-07-15'));            // 5× median < 8× → no flag

// DUPLICATE (expense): same description+amount+date → 1 flag. 07-21 row = date near-miss.
expenses.push(exp('Zoom Sub', 'Dues', 50, '2026-07-20'));             // original (lowest id)
expenses.push(exp('Zoom Sub', 'Dues', 50, '2026-07-20'));            // ← duplicate flag
expenses.push(exp('Zoom Sub', 'Dues', 50, '2026-07-21'));            // different date → no flag

// MISSING (expense): no expense_date. Categorized + has description → ONLY 'missing' fires.
expenses.push(exp('No Date Exp', 'Office', 20, undefined));

// UNCATEGORIZED: cat 'Other' and no category → 2 flags. Have desc+date → not 'missing'.
expenses.push(exp('Uncat A', 'Other', 30, '2026-07-23'));
expenses.push(exp('Uncat B', undefined, 40, '2026-07-24'));

// CLEAN controls: zero flags.
expenses.push(exp('Clean 1', 'Misc', 77, '2026-07-25'));
expenses.push(exp('Clean 2', 'Misc', 88, '2026-07-26'));

// INVOICES: Acme pair (same client+amount+issue_date) → 1 dup; Beta missing due_date.
invoices.push({ id: ++_id, entity_id: EID, client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-07-03', due_date: '2026-07-10' });
invoices.push({ id: ++_id, entity_id: EID, client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-07-03', due_date: '2026-07-10' }); // ← dup
invoices.push({ id: ++_id, entity_id: EID, client: 'Beta', amount: 500, status: 'pending', issue_date: '2026-07-05' });                           // ← missing due_date

// BILLS: AWS pair (same vendor+amount+due_date) → 1 dup; a clean bill → no flag.
bills.push({ id: ++_id, entity_id: EID, vendor: 'AWS', amount: 200, status: 'unpaid', due_date: '2026-07-15' });
bills.push({ id: ++_id, entity_id: EID, vendor: 'AWS', amount: 200, status: 'unpaid', due_date: '2026-07-15' });   // ← dup
bills.push({ id: ++_id, entity_id: EID, vendor: 'Stripe', amount: 29, status: 'unpaid', due_date: '2026-07-16' });

let pass = 0, fail = 0;
const A = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
};

const { items, summary } = buildReviewItems({ expenses, invoices, bills });
const byType = (t) => items.filter(i => i.type === t);
const titles = new Set(items.map(i => i.title));

A(`uncategorized = 2 (got ${summary.uncategorized})`, summary.uncategorized === 2);
A(`duplicate = 3 (got ${summary.duplicate})`, summary.duplicate === 3);
A(`missing = 2 (got ${summary.missing})`, summary.missing === 2);
A(`outlier = 1 (got ${summary.outlier})`, summary.outlier === 1);
A(`total = 8 (got ${summary.total})`, summary.total === 8);

// Discrimination spot-checks (Rule 4): near-miss rows absent, positives present.
A('Rent 3 HUGE NOT flagged (below MIN_N)',
  !byType('outlier').some(i => i.title === 'Rent 3 HUGE'),
  'outliers: ' + byType('outlier').map(i => i.title).join(', '));
A('Soft 6 BIG IS the sole outlier',
  byType('outlier').length === 1 && byType('outlier')[0].title === 'Soft 6 BIG');
A('Travel 500 NOT flagged (below K)', !byType('outlier').some(i => i.title === 'Trav 6'));
A('third Zoom Sub (different date) NOT a duplicate',
  byType('duplicate').filter(i => i.kind === 'expense').length === 1,
  'expense dups: ' + byType('duplicate').filter(i => i.kind === 'expense').length);
A('invoice + bill duplicate each fire once',
  byType('duplicate').filter(i => i.kind === 'invoice').length === 1 &&
  byType('duplicate').filter(i => i.kind === 'bill').length === 1);
A('duplicate flag points at the earliest row (duplicate_of < id)',
  byType('duplicate').every(i => i.duplicate_of != null && i.duplicate_of < i.id));
A('No Date Exp fires missing, NOT uncategorized/outlier',
  byType('missing').some(i => i.title === 'No Date Exp') &&
  !byType('uncategorized').some(i => i.title === 'No Date Exp'));
A('Clean controls produced NO flags', !titles.has('Clean 1') && !titles.has('Clean 2'));
A('uncategorized items are suggestable:true', byType('uncategorized').every(i => i.suggestable === true));
A('non-uncategorized items are suggestable:false', items.filter(i => i.type !== 'uncategorized').every(i => i.suggestable === false));
A('high-severity (duplicates) sort first', items.length > 0 && items[0].severity === 'high');
A('every item carries id/kind/type/amount/entity_id',
  items.every(i => i.id != null && i.kind && i.type && typeof i.amount === 'number' && 'entity_id' in i));

// Empty input → empty result, no throw.
const empty = buildReviewItems({ expenses: [], invoices: [], bills: [] });
A('empty input → total 0, items []', empty.summary.total === 0 && empty.items.length === 0);
const none = buildReviewItems({});
A('no input at all → total 0 (defensive defaults)', none.summary.total === 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
