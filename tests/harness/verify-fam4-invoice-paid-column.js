'use strict';
/**
 * verify-fam4-invoice-paid-column.js — FA-M4 (full app audit 2026-10-22 M4). The Invoices list header reads
 * Client · Amount · PAID · Due date · Status / Actions, but every row wrote Client · Amount · Due · Status · Actions —
 * no paid cell — so "Paid" stood over the due date, "Due date" over the status, and nothing ever showed what was paid.
 * The header also used its own column widths (inline 1fr 90 90 100 1fr) while rows used .inv-cols, so even matching
 * cells did not line up.
 * After: the header and every row share ONE grid (.inv-cols); each row has a Paid cell (what was received; "—" when
 * nothing), and a part-paid invoice also says what is left.
 * Checked by POSITION, the way a reader reads it: the cell under each header label holds that label's value.
 * clientMoneyKit seed (clock 2026-07-25): Acme 1,000 (unpaid) · Acme 600 (250 paid) · Beta 300 (paid) · Gamma draft.
 * Bug values: every "Paid" cell holds the DUE DATE ("Aug 15", "Jun 30", "Feb 10"); "Due date" holds the status.
 */
const { run } = require('./clientMoneyKit.js');

run('FA-M4 — the Invoices list shows what was paid, under the Paid header', async ({ w, d, settle, eq, A }) => {
  try { w.showPage('invoices'); } catch (_) {}
  await settle(20, 60); try { w.renderInvoices(); } catch (_) {} await settle(4, 40);
  const list = d.getElementById('invoice-list');
  const head = list && list.previousElementSibling;
  const labels = head ? [...head.children].map(c => c.textContent.trim()) : [];
  const col = name => labels.findIndex(l => l.toLowerCase().startsWith(name));
  const rows = list ? [...list.querySelectorAll('.table-row.inv-cols')] : [];
  const txt = el => ((el || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const cell = (row, name) => { const i = col(name); return i < 0 || !row ? '' : txt(row.children[i]); };
  const amountOf = row => parseFloat(txt(row.children[1]).replace(/[^\d.]/g, ''));
  const rowOf = (client, amt) => rows.find(r => txt(r.children[0]).includes(client) && amountOf(r) === amt);
  // the app's own money format: $600 or $600.00, with thousands commas
  const has = (t, n) => { const m = String(t).match(/\$[\d,]+(?:\.\d+)?/g) || []; return m.some(s => parseFloat(s.replace(/[$,]/g, '')) === n); };

  eq('1  the header and every row have the same number of columns (invariant)', rows.length > 0 && rows.every(r => r.children.length === labels.length), true);
  A('1b the header uses the rows\' grid (.inv-cols) — same column widths', !!(head && head.classList.contains('inv-cols')), head ? head.className : 'no header');
  const a600 = rowOf('Acme', 600), a1000 = rowOf('Acme', 1000), beta = rowOf('Beta', 300);
  A('2  Acme 600 (250 paid): under "Paid" — $250, and $350 left (bug: the due date "Aug 15")', has(cell(a600, 'paid'), 250) && /\$350(\.00)? left/.test(cell(a600, 'paid')), 'Paid cell: "' + cell(a600, 'paid') + '" · labels ' + JSON.stringify(labels));
  A('3  Beta 300 (paid in full): under "Paid" — $300, nothing left', has(cell(beta, 'paid'), 300) && !/left/.test(cell(beta, 'paid')), 'Paid cell: "' + cell(beta, 'paid') + '"');
  A('4  Acme 1,000 (nothing paid): under "Paid" — "—"', cell(a1000, 'paid').replace(/^Paid\s*/, '') === '—', 'Paid cell: "' + cell(a1000, 'paid') + '"');
  A('5  under "Due date" — a date, not a status (bug: "partial")', /\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|No due date/.test(cell(a600, 'due')) && !/pending|paid|partial|overdue/i.test(cell(a600, 'due')), 'Due cell: "' + cell(a600, 'due') + '"');
  A('6  under "Status" — the status badge', /partial|pending|overdue|paid/i.test(cell(a600, 'status')), 'Status cell: "' + cell(a600, 'status') + '"');
});
