'use strict';
/**
 * finflow-categories.js — FA-B8 (2026-10-27): ONE list per vocabulary, shared by the SERVER (require) and the CLIENT
 * (window.FinFlowCategories), like finflow-dates.js.
 *
 * Before: the expense form, the auto-categorise rule form, the auto-categorise page and the AI suggestions each had their
 * own category list, and two of them offered "Salaries" and "Cost of Goods" — so a rule or an AI suggestion could put a
 * payroll or cost-of-goods label on an ordinary expense (basis C: payroll comes ONLY from payroll runs; cost of goods
 * ONLY from inventory sales — Rule 12), and "Bank Transfer" counted a move between accounts as spending. The budget
 * suggested a "Salaries" target that could never match: the breakdown it is compared with calls payroll "Payroll".
 * Create Business offered 7 industries (Settings / onboarding 11) and 6 currencies (FinFlow supports every currency in
 * finflow-currency.js).
 */
(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // server: require()
  if (typeof window !== 'undefined') window.FinFlowCategories = api;            // client
})(function () {
  // What an expense can be. (Existing expenses keep whatever category they were saved with — Rule 8.)
  var EXPENSE_CATEGORIES = ['Rent', 'Software', 'Marketing', 'Travel', 'Meals', 'Equipment', 'Office Supplies', 'Utilities',
    'Insurance', 'Contractors', 'Professional Fees', 'Bank Fees', 'Other'];

  // Names that are NOT an ordinary expense, with where that money really comes from.
  var PAYROLL = 'Payroll comes from your payroll runs, not from expenses';
  var COGS = 'Cost of goods comes from your inventory sales, not from expenses';
  var TRANSFER = 'A move between your own accounts is not an expense';
  var NOT_AN_EXPENSE = { salaries: PAYROLL, salary: PAYROLL, payroll: PAYROLL, wages: PAYROLL,
    'cost of goods': COGS, 'cost of goods sold': COGS, cogs: COGS, 'bank transfer': TRANSFER, transfer: TRANSFER };
  function notAnExpense(cat) { var k = String(cat == null ? '' : cat).trim().toLowerCase(); return NOT_AN_EXPENSE[k] || null; }

  // Budget targets are compared with the expense breakdown's rows (app-main _expenseCategoryRows), so the suggestions
  // are exactly those row names: Payroll (runs), the expense categories, Bills & vendors.
  var BUDGET_SUGGESTIONS = ['Payroll'].concat(EXPENSE_CATEGORIES.filter(function (c) { return c !== 'Other'; })).concat(['Bills & vendors']);

  var INDUSTRIES = ['Technology', 'Retail', 'Finance', 'Healthcare', 'Consulting', 'Manufacturing', 'Construction',
    'Food & Beverage', 'Real Estate', 'Media & Creative', 'Other'];

  return { EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, NOT_AN_EXPENSE: NOT_AN_EXPENSE, notAnExpense: notAnExpense,
    BUDGET_SUGGESTIONS: BUDGET_SUGGESTIONS, INDUSTRIES: INDUSTRIES };
});
