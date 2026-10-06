'use strict';
/**
 * segments.js — pure grouping engine for the Classes & Locations segment report.
 *
 * PURE (same discipline as books-review / payment-reminders / cashflow-forecast): no DB, no
 * request, no recognition logic of its own. The server route does recognition — it gathers the
 * ALREADY-recognized revenue and expense rows (issued invoices by issue_date, expenses by
 * expense_date, recognized bills) for the active entity in native currency, each carrying its
 * `class` and `location` tag — and hands them here. This module only buckets them by the chosen
 * dimension and sums. It therefore cannot invent a figure the books don't already recognize
 * (Rule 2): it is a reweighting of the exact rows the caller passes, like the F139 deductible leg.
 *
 * Scope is the caller's: v1 passes tagged invoices/expenses/bills for one entity, native currency.
 * An untagged row falls into the '(unassigned)' bucket so every recognized dollar is accounted for
 * and the segment totals equal the sum of the rows passed in.
 */

const UNASSIGNED = '(unassigned)';
const r2 = (n) => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;
const amt = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const key = (row, dim) => {
  const v = row && row[dim] != null ? String(row[dim]).trim() : '';
  return v || UNASSIGNED;
};

function buildSegments({ revenueRows = [], expenseRows = [], dim = 'class' } = {}) {
  if (dim !== 'class' && dim !== 'location') dim = 'class';
  const map = new Map();   // key -> { key, revenue, expense, net }
  const bump = (k, field, v) => {
    if (!map.has(k)) map.set(k, { key: k, revenue: 0, expense: 0, net: 0 });
    const row = map.get(k);
    row[field] = r2(row[field] + v);
  };
  for (const r of revenueRows) bump(key(r, dim), 'revenue', amt(r.amount));
  for (const e of expenseRows) bump(key(e, dim), 'expense', amt(e.amount));

  const segments = [];
  for (const row of map.values()) {
    row.net = r2(row.revenue - row.expense);
    segments.push(row);
  }
  // Assigned segments first (by net desc), '(unassigned)' always last so it reads as the remainder.
  segments.sort((a, b) => {
    if (a.key === UNASSIGNED) return 1;
    if (b.key === UNASSIGNED) return -1;
    return b.net - a.net;
  });

  const totals = {
    revenue: r2(segments.reduce((s, x) => s + x.revenue, 0)),
    expense: r2(segments.reduce((s, x) => s + x.expense, 0)),
    net: r2(segments.reduce((s, x) => s + x.net, 0)),
  };
  const assigned = segments.filter(s => s.key !== UNASSIGNED).length;
  return { dim, segments, totals, segment_count: assigned, has_unassigned: map.has(UNASSIGNED) };
}

module.exports = { buildSegments, UNASSIGNED };
