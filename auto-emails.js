'use strict';
/**
 * auto-emails.js — FA-B1: the automatic customer emails the Email Templates page promised ("Auto — 7 days after due",
 * "on payment", "14 days overdue", "1st of month") and the Settings switch "notify on overdue invoices" — none of which
 * anything sent. This module is PURE (no DB, no network): per-business settings, the templates (editable, with ONLY
 * the placeholders FinFlow can fill), and the rules that decide what is due today. server.js runs it from the hourly
 * job and sends through Resend; every send is claimed once in auto_email_log first (Rule 9 — idempotency at the write).
 *
 * Calendar dates are 'YYYY-MM-DD' strings compared as strings / whole days (Rule 10); "today" is the BUSINESS's today.
 */

const KINDS = ['reminder', 'overdue', 'receipt', 'statement', 'owner_alert'];

// Off until the owner turns each one on (an email to a customer is never sent by surprise).
const DEFAULT_SETTINGS = {
  reminder: { on: false, days_after_due: 7 },
  overdue: { on: false, days_overdue: 14 },
  receipt: { on: false },
  statement: { on: false },
  owner_alert: { on: false },
};

// What each placeholder means; a template may use only these (anything else is refused on save).
const PLACEHOLDERS = {
  customer_name: 'the customer', business_name: 'your business name', invoice_number: 'the invoice number',
  amount_due: 'what is still owed', due_date: 'the due date', days_overdue: 'days past the due date',
  amount_paid: 'the payment amount', payment_date: 'the payment date', statement_lines: 'the open invoices, one per line',
  total_due: 'the total owed', month: 'the statement month',
};
const ALLOWED = {
  reminder: ['customer_name', 'business_name', 'invoice_number', 'amount_due', 'due_date', 'days_overdue'],
  overdue: ['customer_name', 'business_name', 'invoice_number', 'amount_due', 'due_date', 'days_overdue'],
  receipt: ['customer_name', 'business_name', 'invoice_number', 'amount_paid', 'payment_date', 'amount_due'],
  statement: ['customer_name', 'business_name', 'statement_lines', 'total_due', 'month'],
};

const DEFAULT_TEMPLATES = {
  reminder: { subject: 'Reminder: invoice {{invoice_number}} was due on {{due_date}}',
    body: 'Hi {{customer_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} was due on {{due_date}}, and {{amount_due}} is still outstanding.\n\nIf you have already paid, thank you — please ignore this email.\n\nKind regards,\n{{business_name}}' },
  overdue: { subject: 'Overdue: invoice {{invoice_number}} is {{days_overdue}} days past due',
    body: 'Hi {{customer_name}},\n\nInvoice {{invoice_number}} was due on {{due_date}} and is now {{days_overdue}} days overdue. {{amount_due}} is outstanding.\n\nPlease arrange payment, or reply to let us know when to expect it.\n\nKind regards,\n{{business_name}}' },
  receipt: { subject: 'Payment received for invoice {{invoice_number}} — thank you',
    body: 'Hi {{customer_name}},\n\nWe received your payment of {{amount_paid}} on {{payment_date}} for invoice {{invoice_number}}. Thank you.\n\nStill outstanding on this invoice: {{amount_due}}.\n\nKind regards,\n{{business_name}}' },
  statement: { subject: 'Your statement from {{business_name}} — {{month}}',
    body: 'Hi {{customer_name}},\n\nHere is your statement of open invoices with {{business_name}}:\n\n{{statement_lines}}\n\nTotal outstanding: {{total_due}}\n\nKind regards,\n{{business_name}}' },
};

const CATCH_UP_DAYS = 7;   // a missed hourly run (down for a day) still sends — but never years of old invoices at once

function settingsFor(entityData) {
  const s = (entityData && entityData.auto_emails) || {};
  const out = {};
  for (const k of KINDS) out[k] = Object.assign({}, DEFAULT_SETTINGS[k], s[k] || {});
  return out;
}
function templatesFor(entityData) {
  const t = (entityData && entityData.email_templates) || {};
  const out = {};
  for (const k of Object.keys(DEFAULT_TEMPLATES)) out[k] = Object.assign({}, DEFAULT_TEMPLATES[k], t[k] || {});
  return out;
}

// { error } or { ok, settings } — whole days 1..90; booleans for on.
function validateSettings(input) {
  const out = {};
  for (const k of KINDS) {
    const v = (input || {})[k]; if (v == null) continue;
    const o = { on: !!v.on };
    if (k === 'reminder' || k === 'overdue') {
      const key = k === 'reminder' ? 'days_after_due' : 'days_overdue';
      const n = v[key] == null ? DEFAULT_SETTINGS[k][key] : Number(v[key]);
      if (!Number.isInteger(n) || n < 1 || n > 90) return { error: 'Days must be a whole number from 1 to 90.' };
      o[key] = n;
    }
    out[k] = o;
  }
  return { ok: true, settings: out };
}
// { error } or { ok, template } — only this kind's placeholders; subject ≤ 200, body ≤ 5,000.
function validateTemplate(kind, tpl) {
  if (!ALLOWED[kind]) return { error: 'Unknown email.' };
  const subject = String((tpl && tpl.subject) || '').trim(), body = String((tpl && tpl.body) || '').trim();
  if (!subject || !body) return { error: 'Subject and message are both needed.' };
  if (subject.length > 200 || body.length > 5000) return { error: 'Subject up to 200 characters, message up to 5,000.' };
  const used = [...(subject + '\n' + body).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m => m[1]);
  const bad = used.filter(p => !ALLOWED[kind].includes(p));
  if (bad.length) return { error: 'This email cannot fill ' + [...new Set(bad)].map(p => '{{' + p + '}}').join(', ') + '. It can use: ' + ALLOWED[kind].map(p => '{{' + p + '}}').join(', ') + '.' };
  return { ok: true, template: { subject, body } };
}

function render(tpl, vars) {
  const fill = s => String(s).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k])));
  return { subject: fill(tpl.subject), body: fill(tpl.body) };
}

function daysBetween(a, b) {   // whole days a − b, both 'YYYY-MM-DD'
  const pa = String(a).slice(0, 10).split('-').map(Number), pb = String(b).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86400000);
}
const OPEN = ['pending', 'overdue', 'partial'];
const owed = inv => Math.round(((parseFloat(inv.amount) || 0) - (parseFloat(inv.amount_paid) || 0)) * 100) / 100;

// The invoices whose reminder / overdue notice is due today: open, something owed, and between N and N + CATCH_UP_DAYS
// days past due (so turning the feature on never mails every old invoice at once).
function dueInvoiceEmails(kind, invoices, settings, today) {
  const s = settings[kind]; if (!s || !s.on) return [];
  const n = kind === 'reminder' ? s.days_after_due : s.days_overdue;
  return invoices.filter(i => OPEN.includes(String(i.status || '').toLowerCase()) && owed(i) > 0.005 && i.due_date)
    .map(i => ({ inv: i, late: daysBetween(today, String(i.due_date).slice(0, 10)) }))
    .filter(x => x.late >= n && x.late < n + CATCH_UP_DAYS);
}
// The statement is due on the 1st of the business's month (catching up to the 7th).
function statementDue(settings, today) {
  return !!(settings.statement && settings.statement.on) && Number(String(today).slice(8, 10)) <= CATCH_UP_DAYS;
}

module.exports = { KINDS, DEFAULT_SETTINGS, DEFAULT_TEMPLATES, PLACEHOLDERS, ALLOWED, CATCH_UP_DAYS,
  settingsFor, templatesFor, validateSettings, validateTemplate, render, daysBetween, owed, dueInvoiceEmails, statementDue };
