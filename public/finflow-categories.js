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

  // E2E-4 (full test 2026-10-30, 5.4a): PERSONAL categories. A linked bank's lines kept the provider's own code —
  // Plaid's FOOD_AND_DRINK / GENERAL_MERCHANDISE / RENT_AND_UTILITIES … — so the Personal page listed raw codes and its
  // spending breakdown, which knew only the app's names, put every bank line under "Other". ONE vocabulary and ONE
  // reader: personalCategory() turns any stored value (the app's own name, a Plaid code, a Belvo name, an import's
  // "Uncategorized") into the app's name. The server applies it when a bank line is written; every reader applies it
  // when a row is shown, so lines stored before this read the same way without rewriting them (Rule 8).
  var PERSONAL_EXPENSE_CATEGORIES = ['Rent/Mortgage', 'Groceries', 'Dining out', 'Transport', 'Travel', 'Utilities',
    'Entertainment', 'Healthcare', 'Personal care', 'Shopping', 'Subscriptions', 'Fees & charges', 'Other', 'Transfer'];
  var PERSONAL_INCOME_CATEGORIES = ['Salary', 'Freelance', 'Other Income', 'Transfer'];
  // Plaid personal_finance_category: primary → name; a few DETAILED codes refine it (groceries vs eating out, rent vs
  // utilities, wages vs other income). Transfers and loan payments are moves, not spending (FA-M14) → "Transfer".
  var PLAID_PRIMARY = {
    INCOME: 'Other Income', TRANSFER_IN: 'Transfer', TRANSFER_OUT: 'Transfer', LOAN_PAYMENTS: 'Transfer',
    LOAN_DISBURSEMENTS: 'Transfer', BANK_FEES: 'Fees & charges', ENTERTAINMENT: 'Entertainment',
    FOOD_AND_DRINK: 'Dining out', GENERAL_MERCHANDISE: 'Shopping', HOME_IMPROVEMENT: 'Shopping', MEDICAL: 'Healthcare',
    PERSONAL_CARE: 'Personal care', GENERAL_SERVICES: 'Other', GOVERNMENT_AND_NON_PROFIT: 'Other',
    TRANSPORTATION: 'Transport', TRAVEL: 'Travel', RENT_AND_UTILITIES: 'Utilities',
  };
  var PLAID_DETAILED = {
    FOOD_AND_DRINK_GROCERIES: 'Groceries', RENT_AND_UTILITIES_RENT: 'Rent/Mortgage', INCOME_WAGES: 'Salary',
    GENERAL_SERVICES_INSURANCE: 'Other', GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: 'Shopping',
    ENTERTAINMENT_TV_AND_MOVIES: 'Subscriptions', ENTERTAINMENT_MUSIC_AND_AUDIO: 'Subscriptions',
    LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'Rent/Mortgage',
  };
  // Belvo's category names (Latin America bank linking).
  var BELVO = {
    'food & groceries': 'Groceries', 'transport & travel': 'Transport', 'bills & utilities': 'Utilities',
    'online platforms & leisure': 'Entertainment', 'personal shopping': 'Shopping', 'home & life': 'Shopping',
    'income & payments': 'Other Income', 'transfers': 'Transfer', 'investments & savings': 'Transfer',
    'deposits': 'Transfer', 'credits & loans': 'Transfer', 'taxes': 'Other', 'services': 'Other', 'unknown': 'Other',
  };
  var _PERS_ALL = PERSONAL_EXPENSE_CATEGORIES.concat(PERSONAL_INCOME_CATEGORIES);
  var _PERS_LC = {}; _PERS_ALL.forEach(function (c) { _PERS_LC[c.toLowerCase()] = c; });
  _PERS_LC.health = 'Healthcare'; _PERS_LC.uncategorized = 'Other'; _PERS_LC.uncategorised = 'Other'; _PERS_LC.income = 'Other Income';
  function personalCategory(raw, detailed) {
    var d = String(detailed == null ? '' : detailed).trim().toUpperCase();
    if (d && PLAID_DETAILED[d]) return PLAID_DETAILED[d];
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return 'Other';
    if (_PERS_LC[v.toLowerCase()]) return _PERS_LC[v.toLowerCase()];
    var up = v.toUpperCase();
    if (PLAID_DETAILED[up]) return PLAID_DETAILED[up];
    if (PLAID_PRIMARY[up]) return PLAID_PRIMARY[up];
    if (BELVO[v.toLowerCase()]) return BELVO[v.toLowerCase()];
    // An unknown provider code (ALL_CAPS_WITH_UNDERSCORES) reads as words, never as a code; anything else is the
    // person's own name for it and is kept.
    if (/^[A-Z0-9_]+$/.test(v) && v.indexOf('_') !== -1) { var w = v.toLowerCase().replace(/_+/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1); }
    return v;
  }

  return { EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, NOT_AN_EXPENSE: NOT_AN_EXPENSE, notAnExpense: notAnExpense,
    BUDGET_SUGGESTIONS: BUDGET_SUGGESTIONS, INDUSTRIES: INDUSTRIES,
    PERSONAL_EXPENSE_CATEGORIES: PERSONAL_EXPENSE_CATEGORIES, PERSONAL_INCOME_CATEGORIES: PERSONAL_INCOME_CATEGORIES,
    personalCategory: personalCategory };
});
