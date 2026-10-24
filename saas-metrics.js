'use strict';
// ── FinFlow SaaS metrics engine (A0 / D-D, owner decision 2026-10-23) ─────────────────────────────────────────────
// Pure functions — no DB, no Stripe. Input: subscription invoice LINES (FinFlow recurring invoices and Stripe
// subscription invoices alike): { customer, amount, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' (exclusive) }. A line's amount
// is spread evenly over the calendar months it covers (a yearly 1,200 is 100 in each of its 12 months) — monthly
// recurring revenue (MRR) per customer per month, with no timezone anywhere (Rule 10: dates are calendar dates).
// Every figure is returned with its WORKING (formula + inputs) and the customers behind it, and a figure that history
// cannot support is flagged instead of shown as a misleading number.

const ym = d => String(d).slice(0, 7);
function ymAdd(m, k) { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + k; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); }
function ymDiff(a, b) { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb * 12 + mb) - (ya * 12 + ma); }
const r2 = v => Math.round(v * 100) / 100;
const pct = v => (v == null || !isFinite(v) ? null : Math.round(v * 10000) / 100);   // 0.2542 → 25.42 (%)

// Months a line covers: from its start month up to (not including) the month its end falls in — unless the end is
// mid-month, in which case that month is covered too. A line with no end covers its start month only.
function monthsCovered(line) {
  const s = ym(line.start);
  if (!line.end) return [s];
  const e = String(line.end).slice(0, 10), eM = ym(e);
  const last = e.slice(8, 10) === '01' ? ymAdd(eM, -1) : eM;
  const n = Math.max(1, ymDiff(s, last) + 1);
  const out = []; for (let i = 0; i < n; i++) out.push(ymAdd(s, i)); return out;
}

// { 'YYYY-MM': { customer: mrr } } for every month from `from` to `to` inclusive.
function mrrSeries(lines, from, to) {
  const series = {};
  for (let m = from; ymDiff(m, to) >= 0; m = ymAdd(m, 1)) series[m] = {};
  for (const l of lines || []) {
    const months = monthsCovered(l);
    const per = (Number(l.amount) || 0) / months.length;
    for (const m of months) if (series[m]) series[m][l.customer] = (series[m][l.customer] || 0) + per;
  }
  for (const m of Object.keys(series)) for (const c of Object.keys(series[m])) { series[m][c] = r2(series[m][c]); if (!(series[m][c] > 0)) delete series[m][c]; }
  return series;
}

const sum = o => r2(Object.values(o).reduce((s, v) => s + v, 0));

// The movement from the month before M to M, by customer.
function movement(series, m) {
  const prevM = ymAdd(m, -1), prev = series[prevM], cur = series[m];
  if (!prev || !cur) return null;
  const seenBefore = new Set(); for (const k of Object.keys(series)) if (ymDiff(k, prevM) >= 0) Object.keys(series[k]).forEach(c => seenBefore.add(c));
  const mv = { newMrr: 0, reactivation: 0, expansion: 0, contraction: 0, churned: 0, newCustomers: [], reactivated: [], expanded: [], contracted: [], churnedCustomers: [] };
  for (const c of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
    const p = prev[c] || 0, q = cur[c] || 0;
    if (!p && q) { if (seenBefore.has(c)) { mv.reactivation += q; mv.reactivated.push(c); } else { mv.newMrr += q; mv.newCustomers.push(c); } }
    else if (p && !q) { mv.churned += p; mv.churnedCustomers.push(c); }
    else if (q > p) { mv.expansion += q - p; mv.expanded.push(c); }
    else if (q < p) { mv.contraction += p - q; mv.contracted.push(c); }
  }
  for (const k of ['newMrr', 'reactivation', 'expansion', 'contraction', 'churned']) mv[k] = r2(mv[k]);
  return mv;
}

// Everything for month M. opts: { grossMargin (0..1, from the books), acquisitionSpend (for M), minHistoryMonths (3) }
function metricsFor(series, m, opts) {
  const o = Object.assign({ minHistoryMonths: 3 }, opts || {});
  const cur = series[m] || {}, prevM = ymAdd(m, -1), prev = series[prevM];
  const mrr = sum(cur), customers = Object.keys(cur).length;
  const out = { month: m, mrr, arr: r2(mrr * 12), customers: Object.keys(cur).sort(), flags: [], working: {} };
  out.working.mrr = { formula: 'Σ each customer\'s monthly recurring revenue in ' + m, inputs: cur };
  out.arpa = customers ? r2(mrr / customers) : null;
  out.working.arpa = { formula: 'MRR ÷ customers', inputs: { mrr, customers } };
  const mv = prev ? movement(series, m) : null;
  if (!mv) { out.flags.push('Not enough history yet — needs the month before ' + m + '.'); return out; }
  const startMrr = sum(prev), startCustomers = Object.keys(prev).length;
  Object.assign(out, { newMrr: mv.newMrr, reactivation: mv.reactivation, expansion: mv.expansion, contraction: mv.contraction, churnedMrr: mv.churned,
    newCustomers: mv.newCustomers.sort(), churnedCustomers: mv.churnedCustomers.sort(), expandedCustomers: mv.expanded.sort(), contractedCustomers: mv.contracted.sort() });
  out.customerChurnRate = startCustomers ? pct(mv.churnedCustomers.length / startCustomers) : null;
  out.working.customerChurnRate = { formula: 'customers lost ÷ customers at the start of the month', inputs: { lost: mv.churnedCustomers.length, atStart: startCustomers } };
  out.revenueChurnRate = startMrr ? pct((mv.churned + mv.contraction) / startMrr) : null;
  out.working.revenueChurnRate = { formula: '(churned MRR + contraction) ÷ MRR at the start of the month', inputs: { churned: mv.churned, contraction: mv.contraction, startMrr } };
  out.nrr = startMrr ? pct((startMrr + mv.expansion - mv.contraction - mv.churned) / startMrr) : null;
  out.working.nrr = { formula: '(start MRR + expansion − contraction − churned) ÷ start MRR', inputs: { startMrr, expansion: mv.expansion, contraction: mv.contraction, churned: mv.churned } };
  out.grr = startMrr ? pct((startMrr - mv.contraction - mv.churned) / startMrr) : null;
  out.working.grr = { formula: '(start MRR − contraction − churned) ÷ start MRR', inputs: { startMrr, contraction: mv.contraction, churned: mv.churned } };

  // Acquisition cost and payback (spend in M ÷ new customers in M)
  const gm = o.grossMargin == null ? null : Number(o.grossMargin);
  if (o.acquisitionSpend != null) {
    const n = mv.newCustomers.length;
    out.cac = n ? r2(o.acquisitionSpend / n) : null;
    out.working.cac = { formula: 'acquisition spend in ' + m + ' ÷ new customers in ' + m, inputs: { spend: r2(o.acquisitionSpend), newCustomers: n } };
    if (!n) out.flags.push('No new customers in ' + m + ' — acquisition cost per customer cannot be worked out.');
    if (out.cac != null && gm != null && out.arpa) {
      out.paybackMonths = r2(out.cac / (out.arpa * gm));
      out.working.paybackMonths = { formula: 'CAC ÷ (ARPA × gross margin)', inputs: { cac: out.cac, arpa: out.arpa, grossMargin: gm } };
    }
  }
  // Lifetime value: ARPA × gross margin ÷ average monthly revenue churn over the last 3 months (the industry formula,
  // margin-adjusted). Needs 3 months of movement; with no churn at all it is not finite and is flagged, never shown.
  const rates = [];
  for (let i = 0; i < o.minHistoryMonths; i++) {
    const mm = ymAdd(m, -i), pm = ymAdd(mm, -1);
    if (!series[mm] || !series[pm]) break;
    const sm = sum(series[pm]), mvi = movement(series, mm);
    if (!sm || !mvi) break;
    rates.push((mvi.churned + mvi.contraction) / sm);
  }
  if (rates.length < o.minHistoryMonths) out.flags.push('Lifetime value needs ' + o.minHistoryMonths + ' months of history — ' + rates.length + ' so far.');
  else if (gm == null) out.flags.push('Lifetime value needs the gross margin from your books.');
  else {
    const avg = rates.reduce((s, v) => s + v, 0) / rates.length;
    if (!(avg > 0)) out.flags.push('No revenue churn in the last ' + rates.length + ' months — lifetime value is not meaningful yet.');
    else {
      out.ltv = r2(out.arpa * gm / avg);
      out.working.ltv = { formula: 'ARPA × gross margin ÷ average monthly revenue churn (last ' + rates.length + ' months)', inputs: { arpa: out.arpa, grossMargin: gm, monthlyRevenueChurn: rates.map(v => Math.round(v * 1e6) / 1e6), average: Math.round(avg * 1e6) / 1e6 } };
    }
  }
  return out;
}

// Retention cohorts: customers grouped by their first month; for each later month, the share still paying (customers)
// and the share of the cohort's starting MRR still there (revenue).
function cohorts(series) {
  const months = Object.keys(series).sort();
  const first = {};
  for (const m of months) for (const c of Object.keys(series[m])) if (!first[c]) first[c] = m;
  const groups = {};
  for (const [c, m] of Object.entries(first)) (groups[m] = groups[m] || []).push(c);
  return Object.keys(groups).sort().map(start => {
    const members = groups[start].sort();
    const startMrr = r2(members.reduce((s, c) => s + (series[start][c] || 0), 0));
    const rows = months.filter(m => ymDiff(start, m) >= 0).map(m => {
      const still = members.filter(c => (series[m][c] || 0) > 0);
      const mrrNow = r2(members.reduce((s, c) => s + (series[m][c] || 0), 0));
      return { month: m, offset: ymDiff(start, m), customers: still.length, customerPct: pct(still.length / members.length), mrr: mrrNow, mrrPct: startMrr ? pct(mrrNow / startMrr) : null };
    });
    return { start, size: members.length, members, startMrr, months: rows };
  });
}

module.exports = { monthsCovered, mrrSeries, movement, metricsFor, cohorts, ymAdd, ymDiff };
