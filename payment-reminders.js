'use strict';
/**
 * payment-reminders.js — the prediction + draft engine for the AI payment-reminders agent.
 *
 * PURE by design (same discipline as books-review.js): no DB, no request, no network, no money
 * mutation. It receives already-scoped arrays of plain row objects and returns reminder
 * candidates with a deterministic late-payer prediction and a ready-to-send draft. The server
 * route does the I/O (load rows, resolve the draft through AI when a key is present, send via
 * Resend); keeping the logic pure is what lets it be executed against discriminating seeds.
 *
 * NOTHING here recomputes a money KPI that another surface owns (Rule 2). `outstanding` is the
 * per-invoice (amount - amount_paid), the same arithmetic the invoice itself carries — it is a
 * row-level field, not a books total.
 *
 * Candidate = an unpaid invoice (status pending/overdue/partial, outstanding > 0) that is either
 * already overdue OR due within DUE_SOON_DAYS. "Predicted late" (for a not-yet-overdue invoice)
 * is deterministic: the customer has a history of paying PAST the due date. No AI is involved in
 * deciding who to chase — only, optionally and separately, in wording the message.
 */

const DUE_SOON_DAYS = 7;          // include not-yet-overdue invoices due within this many days
const HIGH_OVERDUE_DAYS = 30;     // > this many days overdue → 'high' severity

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const amt  = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

// Day difference between two YYYY-MM-DD strings, parsed symmetrically as UTC midnight so the
// result is viewer-independent (Rule 10: an accounting date is a calendar date; both sides are
// parsed the same way, so no timezone can skew the diff). Positive = a is after b.
function daysBetween(aYmd, bYmd) {
  if (!aYmd || !bYmd) return null;
  const a = Date.parse(aYmd + 'T00:00:00Z');
  const b = Date.parse(bYmd + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

// Resolve an invoice's free-text `client` to a customer row (for the email + a real name).
// Matches, case-insensitively, against company, then "fname lname", then fname alone.
function resolveCustomer(clientName, customers) {
  const c = norm(clientName);
  if (!c) return null;
  for (const cust of customers) {
    const company = norm(cust.company);
    const full = norm((cust.fname || '') + ' ' + (cust.lname || ''));
    if ((company && company === c) || (full && full === c) || norm(cust.fname) === c) return cust;
  }
  return null;
}

function money(n, currency) {
  const x = amt(n);
  const s = x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (currency ? currency + ' ' : '') + s;
}

// Build a plain-text draft tuned to severity. Deterministic; the AI polish path (server) may
// replace the body, but this always works with no key.
function buildDraft({ businessName, customerName, invoiceNum, outstanding, currency, dueDate, daysOverdue, severity }) {
  const who = customerName || 'there';
  const inv = invoiceNum ? ('invoice ' + invoiceNum) : 'your invoice';
  const amtStr = money(outstanding, currency);
  const from = businessName || 'Our team';
  let subject, body;
  if (severity === 'upcoming') {
    subject = 'Reminder: ' + (invoiceNum ? 'Invoice ' + invoiceNum : 'Invoice') + ' due soon';
    body = `Hi ${who},\n\nThis is a friendly reminder that ${inv} for ${amtStr} is due on ${dueDate}. `
      + `If you've already arranged payment, please disregard this note.\n\nThank you,\n${from}`;
  } else if (severity === 'high') {
    subject = 'Overdue: ' + (invoiceNum ? 'Invoice ' + invoiceNum : 'Invoice') + ' — ' + daysOverdue + ' days past due';
    body = `Hi ${who},\n\nOur records show ${inv} for ${amtStr}, due on ${dueDate}, is now ${daysOverdue} days overdue. `
      + `We'd appreciate payment at your earliest convenience. If there's an issue with this invoice, please reply and let us know.\n\nThank you,\n${from}`;
  } else { // medium — recently overdue
    subject = 'Reminder: ' + (invoiceNum ? 'Invoice ' + invoiceNum : 'Invoice') + ' is past due';
    body = `Hi ${who},\n\nA quick follow-up — ${inv} for ${amtStr} was due on ${dueDate} and still shows as outstanding. `
      + `Would you be able to arrange payment? If you've already sent it, thank you and please disregard.\n\nThank you,\n${from}`;
  }
  return { subject, body };
}

function buildReminderCandidates({ invoices = [], customers = [], payments = [], businessName = '', currency = '', today = '' } = {}) {
  // Late-payment history per normalized client name, from real payment dates vs the invoice due date.
  const invById = new Map();
  for (const inv of invoices) invById.set(inv.id, inv);
  const lateByClient = new Map();   // normalized client -> count of invoices paid after due date
  for (const p of payments) {
    const inv = invById.get(p.invoice_id);
    if (!inv || !inv.due_date || !p.payment_date) continue;
    const pd = String(p.payment_date).slice(0, 10);
    const d = daysBetween(pd, inv.due_date);
    if (d != null && d > 0) {
      const k = norm(inv.client);
      lateByClient.set(k, (lateByClient.get(k) || 0) + 1);
    }
  }

  const UNPAID = new Set(['pending', 'overdue', 'partial']);
  const items = [];
  for (const inv of invoices) {
    const status = norm(inv.status);
    if (!UNPAID.has(status)) continue;                 // skip draft + paid
    const outstanding = amt(inv.amount) - amt(inv.amount_paid);
    if (outstanding <= 0.005) continue;                // nothing owed
    if (!inv.due_date) continue;                       // can't reason about timing without a due date
    const daysOverdue = today ? daysBetween(today, inv.due_date) : null;
    if (daysOverdue == null) continue;

    const chronic = (lateByClient.get(norm(inv.client)) || 0) > 0;

    let severity, predicted_late;
    if (daysOverdue > HIGH_OVERDUE_DAYS)      { severity = 'high';     predicted_late = false; }
    else if (daysOverdue > 0)                 { severity = 'medium';   predicted_late = false; }
    else if (daysOverdue >= -DUE_SOON_DAYS)   { severity = 'upcoming'; predicted_late = chronic; }
    else continue;                                     // due further out than the window → not yet a candidate

    const cust = resolveCustomer(inv.client, customers);
    const customerName = cust ? (cust.company || ((cust.fname || '') + ' ' + (cust.lname || '')).trim() || inv.client) : inv.client;
    const email = cust && cust.email ? cust.email : null;

    const draft = buildDraft({
      businessName, customerName, invoiceNum: inv.num || ('#' + inv.id),
      outstanding, currency, dueDate: inv.due_date, daysOverdue: Math.max(0, daysOverdue), severity,
    });

    items.push({
      invoice_id: inv.id,
      client: inv.client,
      customer_name: customerName,
      email,                         // null → the UI shows "no email on file", send is blocked
      amount_outstanding: Math.round(outstanding * 100) / 100,
      currency: currency || null,
      due_date: inv.due_date,
      days_overdue: daysOverdue,     // negative = not yet due
      status,
      severity,                      // high | medium | upcoming
      chronic_late: chronic,
      predicted_late,                // true only for an upcoming invoice whose customer pays late
      has_email: !!email,
      draft,
      entity_id: inv.entity_id ?? null,
    });
  }

  // Worst first: most overdue at the top; upcoming (negative days) last.
  items.sort((a, b) => (b.days_overdue - a.days_overdue));

  const summary = {
    total: items.length,
    overdue: items.filter(i => i.days_overdue > 0).length,
    due_soon: items.filter(i => i.days_overdue <= 0).length,
    predicted_late: items.filter(i => i.predicted_late).length,
    missing_email: items.filter(i => !i.has_email).length,
    total_outstanding: Math.round(items.reduce((s, i) => s + i.amount_outstanding, 0) * 100) / 100,
  };
  return { items, summary };
}

module.exports = { buildReminderCandidates, buildDraft, resolveCustomer, daysBetween, DUE_SOON_DAYS, HIGH_OVERDUE_DAYS };
