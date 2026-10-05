'use strict';
/**
 * books-review.js — the cleanup/anomaly detection engine for GET /api/books-review.
 *
 * PURE by design (Rule 5 corollary: importable over extracted). This module touches NO
 * database, NO request, NO money KPI. It receives three already-scoped arrays of plain row
 * objects (exactly what db.allByUser returns via rowToObj) and returns the flagged items +
 * a summary. The server route is the only place that does I/O; it loads the three lists with
 * the same scoping as /api/expenses and hands them here. Keeping the logic pure is what lets
 * it be executed directly against discriminating seeds (Rule 4 / Rule 14) in an environment
 * where the embedded-postgres substrate cannot boot.
 *
 * Detectors (all deterministic and explainable — no AI, no fabricated figures):
 *   • uncategorized — expense with no category or category === 'Other' (mirrors the autocat
 *     /api/autocat-rules/ai-suggest filter exactly, so the two surfaces never disagree).
 *   • duplicate     — ≥2 rows sharing the app's own create-time identity signal
 *     (expenses: description+amount; invoices: client+amount; bills: vendor+amount — the
 *     fields findRecentDuplicate matches on) AND the same calendar date. Earliest id = the
 *     original (kept); later rows are flagged. Date-exact ⇒ a legitimate monthly recurring
 *     charge (different dates) is never flagged.
 *   • missing       — a row missing a field its create route requires.
 *   • outlier       — expense whose amount is ≥ OUTLIER_K × the MEDIAN of its own category,
 *     within a category of ≥ OUTLIER_MIN_N expenses. Robust (median, not mean), conservative,
 *     reported WITH the median. A "check this", never an assertion the figure is wrong.
 */

const OUTLIER_K = 8;        // amount must be ≥ 8× the category median to flag
const OUTLIER_MIN_N = 6;    // a category needs ≥6 expenses before any outlier call is made

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const amt  = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const median = (arr) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

function buildReviewItems({ expenses = [], invoices = [], bills = [] } = {}) {
  const items = [];
  const push = (it) => items.push(it);

  // 1) UNCATEGORIZED (expenses).
  for (const e of expenses) {
    if (!e.category || e.category === 'Other') {
      push({
        id: e.id, kind: 'expense', type: 'uncategorized', severity: 'low', suggestable: true,
        title: e.description || '(no description)',
        detail: 'No category assigned.',
        amount: amt(e.amount), date: e.expense_date || null, entity_id: e.entity_id ?? null,
      });
    }
  }

  // 2) DUPLICATES — identity signal + exact date. Earliest id kept as original.
  const dupScan = (rows, kind, nameField, dateField, label) => {
    const groups = new Map();
    for (const r of rows) {
      const name = norm(r[nameField]);
      const date = r[dateField] || '';
      if (!name || !date) continue;                   // can't assert a duplicate without both
      const key = kind + '|' + name + '|' + amt(r.amount).toFixed(2) + '|' + date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => (a.id || 0) - (b.id || 0));
      const original = group[0];
      for (let i = 1; i < group.length; i++) {
        const r = group[i];
        push({
          id: r.id, kind, type: 'duplicate', severity: 'high', suggestable: false,
          title: r[nameField] || '(no ' + label + ')',
          detail: 'Possible duplicate of ' + label + ' #' + original.id + ' (same ' + label + ', amount and date).',
          amount: amt(r.amount), date: r[dateField] || null, entity_id: r.entity_id ?? null,
          duplicate_of: original.id,
        });
      }
    }
  };
  dupScan(expenses, 'expense', 'description', 'expense_date', 'expense');
  dupScan(invoices, 'invoice', 'client',      'issue_date',   'invoice');   // issue_date = recognition date (Rule 11)
  dupScan(bills,    'bill',    'vendor',       'due_date',     'bill');

  // 3) MISSING INFO — a required field (per each create route) is absent.
  for (const e of expenses) {
    const miss = [];
    if (!e.description || !String(e.description).trim()) miss.push('description');
    if (!e.expense_date) miss.push('date');
    if (miss.length) push({
      id: e.id, kind: 'expense', type: 'missing', severity: 'medium', suggestable: false,
      title: e.description || '(no description)',
      detail: 'Missing ' + miss.join(' and ') + '.',
      amount: amt(e.amount), date: e.expense_date || null, entity_id: e.entity_id ?? null,
    });
  }
  for (const inv of invoices) {
    const miss = [];
    if (!inv.client || !String(inv.client).trim()) miss.push('customer');
    if (inv.amount == null) miss.push('amount');
    if (!inv.due_date) miss.push('due date');
    if (miss.length) push({
      id: inv.id, kind: 'invoice', type: 'missing', severity: 'medium', suggestable: false,
      title: inv.client || '(no customer)',
      detail: 'Missing ' + miss.join(', ') + '.',
      amount: amt(inv.amount), date: inv.issue_date || inv.due_date || null, entity_id: inv.entity_id ?? null,
    });
  }
  for (const b of bills) {
    const miss = [];
    if (!b.vendor || !String(b.vendor).trim()) miss.push('vendor');
    if (!b.due_date) miss.push('due date');
    if (miss.length) push({
      id: b.id, kind: 'bill', type: 'missing', severity: 'medium', suggestable: false,
      title: b.vendor || '(no vendor)',
      detail: 'Missing ' + miss.join(' and ') + '.',
      amount: amt(b.amount), date: b.due_date || null, entity_id: b.entity_id ?? null,
    });
  }

  // 4) OUTLIERS — robust (median) per expense category. Conservative; reports the median.
  const byCat = new Map();
  for (const e of expenses) {
    const c = e.category || 'Other';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(e);
  }
  for (const [cat, rows] of byCat.entries()) {
    if (rows.length < OUTLIER_MIN_N) continue;
    const med = median(rows.map(r => amt(r.amount)).filter(n => n > 0));
    if (med <= 0) continue;
    const threshold = med * OUTLIER_K;
    for (const e of rows) {
      const a = amt(e.amount);
      if (a > threshold) push({
        id: e.id, kind: 'expense', type: 'outlier', severity: 'low', suggestable: false,
        title: e.description || '(no description)',
        detail: 'Unusually large for ' + cat + ' — ' + OUTLIER_K + '×+ the category median of ' + med.toFixed(2) + '. Worth a look.',
        amount: a, date: e.expense_date || null, entity_id: e.entity_id ?? null,
      });
    }
  }

  const summary = { total: items.length, uncategorized: 0, duplicate: 0, missing: 0, outlier: 0 };
  for (const it of items) summary[it.type] = (summary[it.type] || 0) + 1;
  // Severity-first so the queue reads worst-first; stable within a severity.
  const sevRank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]));
  return { items, summary };
}

module.exports = { buildReviewItems, OUTLIER_K, OUTLIER_MIN_N };
