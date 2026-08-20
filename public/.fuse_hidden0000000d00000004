// ════════════════════════════════════════════════════════════════════
// FINFLOW — STUBS WIRING  (RETIRED — F145, 2026-08-09)
// ════════════════════════════════════════════════════════════════════
// This file previously wired Quotes / Bills / Vendors / Recurring Bills /
// Recurring Invoices to the real API. Every one of those subsystems is now
// implemented in finflow-api-wiring-pages.js, which loads AFTER this file and
// therefore WON every runtime binding. Confirmed dead-shadow (F145):
//
//   • 13 window.X = function assignments here were overridden by real
//     `window.X = function` winners in pages.js (openNew*/save*/markBillPaid/
//     filterVendorsBySearch/showPage — showPage also in extra.js + postgres.js).
//   • 5 edit* openers (editQuote/editVendor/editBill/editRecurringBill/
//     editRecurringInvoice) had ZERO live callers — referenced only by this
//     file's own (also-dead) render HTML.
//   • window.render{Quotes,Vendors,Bills,RecurringBills,RecurringInvoices}
//     overridden by pages.js + postgres.js.
//   • The entity-switch reload hooks window._load{Vendors,Bills,Quotes,
//     RecurringBills,RecurringInv}FromDB are re-assigned by pages.js
//     (see pages.js:1163-1172, "overrides stubs.js — pages.js wins"); the
//     live caller (postgres.js entity-switch) therefore hits pages.js copies.
//   • The money vars window.{quotes,vendors,bills,recurringBills,
//     recurringInvoices} are set by pages.js, so removing this file's copies
//     cannot blank an AP / dashboard figure.
//
// Kept as an empty module (rather than removed from the bundle/index) so load
// order and the bundle manifest are unchanged. Do NOT re-add wiring here — it
// would be dead on arrival behind pages.js. Add to pages.js instead.
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
  // Intentionally empty. See header (F145). All wiring lives in
  // finflow-api-wiring-pages.js.
})();
