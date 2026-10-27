'use strict';
/**
 * FA-B12 (2026-10-27) — a page change closes every open form; a form belongs to the page it was opened on.
 *
 * BUG (read 2026-10-24, executed here on the old code): no showPage layer closed anything, so forms stayed open across page
 * changes — the Cowork test stacked 15. Seed: clientMoneyKit (an employee "Sam Field" for the edit-employee form).
 *   three forms opened, then a page change → 0 open (bug: 3)
 *   the edit-employee form (shown by style.display, not the "hidden" class) closes AND opens again afterwards
 *   a form opened AFTER the page change stays open; the confirm dialog (not a form) is never closed by a page change
 */
const { run } = require('./clientMoneyKit.js');

run('FA-B12 — a page change closes the open forms', async ({ w, d, settle, eq }) => {
  const openForms = () => Array.from(d.querySelectorAll('.modal-overlay')).filter(m => !m.classList.contains('hidden') && m.style.display !== 'none').map(m => m.id);
  w.showPage('invoices'); await settle(5, 20);
  w.openInvoiceModal(); w.openNewQuoteModal(); w.openNewBillModal(); await settle(5, 20);
  eq('0  setup: three forms open', openForms().sort(), ['bill-modal', 'invoice-modal', 'quote-modal']);
  w.showPage('expenses'); await settle(5, 20);
  eq('1  a page change closes them all', openForms(), [], ['bill-modal', 'invoice-modal', 'quote-modal']);

  const emp = (w.payrollEmployees || [])[0];
  w.openEditEmployee(emp && (emp._dbId || emp.id)); await settle(2, 10);
  eq('2  setup: the edit-employee form is open', openForms(), ['modal-edit-employee']);
  w.showPage('dashboard'); await settle(5, 20);
  eq('2  …a page change closes it', openForms(), [], ['modal-edit-employee']);
  w.openEditEmployee(emp && (emp._dbId || emp.id)); await settle(2, 10);
  eq('2  …and it opens again afterwards (closed the way it opens, not left with "hidden")', openForms(), ['modal-edit-employee']);
  w.closeEditEmployee && w.closeEditEmployee();

  w.showPage('invoices'); w.openInvoiceModal(); await settle(5, 20);
  eq('3  a form opened after the page change stays open', openForms(), ['invoice-modal']);
  w.closeModal('invoice-modal');
  const p = w._confirmModal('Delete?'); await settle(1, 10);
  w.showPage('expenses'); await settle(3, 10);
  eq('3  the confirm dialog is not a form — still there after a page change', !!d.getElementById('_confirm-overlay'), true);
  d.getElementById('_confirm-no').click(); await p;
});
