'use strict';
/**
 * customer-portal.js — FA-B10b (2026-10-27): what a customer sees through their private portal link, and the one
 * "which customer is this invoice's" matcher the portal AND the monthly statement email share (Rule 2: one figure, one
 * writer — the email used to match by name only).
 *
 * Pure: no database, no request. server.js loads the rows and calls portalView().
 */
const { resolveCustomer } = require('./payment-reminders');
const { owed } = require('./auto-emails');

const OPEN = ['pending', 'overdue', 'partial'];   // what is owed (Rule 11: the invoice vocabulary; draft is never shown)
const SHOWN = OPEN.concat(['paid']);

// The customer a document belongs to: its saved link (FA-B4 sets customer_id on every create and edit), else — for an
// older document saved before links existed, which carries no customer_id — the customer whose name it bears.
function customerOfDoc(doc, customers) {
  if (doc && doc.customer_id != null) return customers.find(c => String(c.id) === String(doc.customer_id)) || null;
  return resolveCustomer(doc && doc.client, customers);
}

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const ymd = v => (v ? String(v).slice(0, 10) : null);

// invoices: the business's invoices; customer: the portal's customer; today: the business's 'YYYY-MM-DD' (Rule 10 —
// a date string, compared as a string).
function portalView({ invoices, customer, customers, today }) {
  const mine = invoices.filter(i => SHOWN.includes(String(i.status || '').toLowerCase())
    && (customerOfDoc(i, customers) || {}).id === customer.id);
  const line = i => {
    const balance = OPEN.includes(String(i.status).toLowerCase()) ? Math.max(0, owed(i)) : 0;
    const due = ymd(i.due_date);
    return { id: i.id, number: i.number || null, issue_date: ymd(i.issue_date || i.date), due_date: due,
      amount: r2(i.amount), paid: r2(r2(i.amount) - balance), balance, overdue: balance > 0.005 && !!due && due < today };
  };
  const open = mine.filter(i => OPEN.includes(String(i.status).toLowerCase()) && owed(i) > 0.005).map(line)
    .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || a.id - b.id);
  const paid = mine.filter(i => !open.some(o => o.id === i.id)).map(line)
    .sort((a, b) => String(b.issue_date || '').localeCompare(String(a.issue_date || '')) || b.id - a.id).slice(0, 24);
  return { open, paid, total_due: r2(open.reduce((s, i) => s + i.balance, 0)),
    overdue_due: r2(open.filter(i => i.overdue).reduce((s, i) => s + i.balance, 0)) };
}

module.exports = { customerOfDoc, portalView, OPEN };
