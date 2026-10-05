'use strict';
/**
 * cashflow-forecast.js — the projection math for the 13-week cash-flow forecast.
 *
 * PURE (same discipline as books-review.js / payment-reminders.js): no DB, no request, no network.
 * The server route does the sourcing — it reads the authoritative starting cash from glBalanceSheet
 * (GL account 1000, never a recomputed total — Rule 2), expands recurring invoices/bills with the
 * app's own nextRunDate helper, and hands this engine a flat list of DATED inflow/outflow events.
 * This module only buckets them into weeks and runs the cumulative balance forward.
 *
 * It is a FORECAST, not a booked figure: every event is an expectation (an unpaid invoice assumed to
 * arrive on its due date, a recurring charge assumed to fire on schedule, an estimated opex run-rate).
 * Nothing here is a revenue/expense KPI that another surface owns.
 */

// Day difference between two YYYY-MM-DD strings, both parsed as UTC midnight (viewer-independent).
function daysBetween(aYmd, bYmd) {
  if (!aYmd || !bYmd) return null;
  const a = Date.parse(String(aYmd).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(bYmd).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}
function addDaysYmd(ymd, n) {
  const t = Date.parse(String(ymd).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(t)) return null;
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}
const r2 = (n) => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;

/**
 * @param startingCash number|null  real GL cash now (null when GL cash isn't tracked)
 * @param cashTracked  boolean      whether startingCash is a real figure
 * @param inflows/outflows [{date:'YYYY-MM-DD', amount:number, kind:string, label:string}]
 * @param today 'YYYY-MM-DD'
 * @param weeks number (default 13)
 */
function buildForecast({ startingCash = null, cashTracked = false, inflows = [], outflows = [], today = '', weeks = 13 } = {}) {
  const W = Math.max(1, Math.min(52, parseInt(weeks, 10) || 13));
  const periods = [];
  for (let i = 0; i < W; i++) {
    periods.push({
      week: i + 1,
      start_date: addDaysYmd(today, i * 7),
      end_date: addDaysYmd(today, i * 7 + 6),
      inflow: 0, outflow: 0, net: 0, cumulative: 0, balance: null,
      items: [],
    });
  }
  const place = (ev, sign) => {
    if (!ev || !ev.date) return;
    const d = daysBetween(ev.date, today);
    if (d == null) return;
    // Anything already due (d < 0) lands in week 0 (expected now); beyond the horizon is ignored.
    let idx = d < 0 ? 0 : Math.floor(d / 7);
    if (idx >= W) return;
    if (idx < 0) idx = 0;
    const amt = Math.abs(parseFloat(ev.amount) || 0);
    if (amt === 0) return;
    const p = periods[idx];
    if (sign > 0) p.inflow = r2(p.inflow + amt); else p.outflow = r2(p.outflow + amt);
    p.items.push({ date: ev.date, amount: amt, direction: sign > 0 ? 'in' : 'out', kind: ev.kind || null, label: ev.label || null });
  };
  for (const ev of inflows) place(ev, +1);
  for (const ev of outflows) place(ev, -1);

  let running = 0, lowest = null, runwayWeek = null, negativeWeeks = 0;
  for (const p of periods) {
    p.net = r2(p.inflow - p.outflow);
    running = r2(running + p.net);
    p.cumulative = running;
    if (cashTracked && startingCash != null) {
      p.balance = r2(startingCash + running);
      if (lowest == null || p.balance < lowest.amount) lowest = { amount: p.balance, week: p.week, date: p.start_date };
      if (p.balance < 0) { negativeWeeks++; if (runwayWeek == null) runwayWeek = p.week; }
    }
  }

  const totalIn = r2(periods.reduce((s, p) => s + p.inflow, 0));
  const totalOut = r2(periods.reduce((s, p) => s + p.outflow, 0));
  const summary = {
    weeks: W,
    cash_tracked: !!cashTracked,
    starting_cash: cashTracked ? r2(startingCash) : null,
    total_inflow: totalIn,
    total_outflow: totalOut,
    net_change: r2(totalIn - totalOut),
    ending_balance: cashTracked && startingCash != null ? r2(startingCash + running) : null,
    lowest_balance: lowest,              // {amount, week, date} or null
    runway_weeks: runwayWeek,            // first week projected balance < 0, else null
    negative_weeks: negativeWeeks,
  };
  return { periods, summary };
}

module.exports = { buildForecast, daysBetween, addDaysYmd };
