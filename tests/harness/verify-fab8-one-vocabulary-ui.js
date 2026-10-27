'use strict';
/**
 * FA-B8 (2026-10-27), page half — one list per vocabulary on the real page.
 *
 * BUG (executed on the old code): Create Business offered 7 industries (Settings / onboarding 11) and 6 currencies, Settings
 * 6, onboarding 5 — FinFlow supports every currency in finflow-currency.js; the expense form, the rule form and the
 * auto-categorise page each had their own category list, the rule form and page offering "Salaries"; the budget suggested a
 * "Salaries" target that never matches the breakdown's "Payroll" row (always 0).
 * Seed: clientMoneyKit — its July payroll run is approved (gross 2,000), so a Payroll budget target has a real actual.
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./clientMoneyKit.js');
const CAT = require('../../public/finflow-categories.js');
const CUR = require('../../public/finflow-currency.js');
const html = require('./appScripts.js').pageSource('index.html');
const listOf = id => { const m = html.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>')); return m ? [...m[1].matchAll(/<option(?:\s+value="([^"]*)")?>([^<]*)<\/option>/g)].map(o => (o[1] != null ? o[1] : o[2]).replace(/&amp;/g, '&')).filter(Boolean) : []; };

run('FA-B8 UI — one list per vocabulary', async ({ w, d, settle, eq, http }) => {
  // STRUCTURAL (labelled, Rule 5): the three industry lists in the markup are the module's list.
  eq('1  STRUCTURAL: Create Business, Settings and onboarding industries are FinFlowCategories.INDUSTRIES', [listOf('nb-industry'), listOf('s-industry'), listOf('ob-industry')], [CAT.INDUSTRIES, CAT.INDUSTRIES, CAT.INDUSTRIES],
    [['Technology', 'Retail', 'Finance', 'Healthcare', 'Consulting', 'Manufacturing', 'Other'], CAT.INDUSTRIES, CAT.INDUSTRIES]);
  const opts = id => Array.from((d.getElementById(id) || { options: [] }).options).map(o => o.value);
  const n = Object.keys(CUR.CURRENCIES).length;
  eq('2  Create Business and Settings offer every supported currency (' + n + ')', ['nb-currency', 's-currency'].map(id => opts(id).length), [n, n], [6, 6]);
  eq('2  …e.g. JPY and KES', ['nb-currency', 's-currency'].map(id => opts(id).includes('JPY') && opts(id).includes('KES')), [true, true], [false, false]);
  eq('3  the expense form offers the one expense list', opts('bexp-cat'), CAT.EXPENSE_CATEGORIES);
  w.openAddRuleModal(); await settle(3, 20);
  eq('3  the rule form offers the same list — no "Salaries" / "Cost of Goods"', opts('rule-category'), CAT.EXPENSE_CATEGORIES,
    ['Software & SaaS', 'Travel', 'Meals & Entertainment', 'Office Supplies', 'Salaries', 'Marketing', 'Professional Services', 'Other']);
  w._realExpenses = [{ id: 1, category: 'Salaries', description: 'old' }, { id: 2, category: 'Other', description: 'x' }];
  eq('3  the auto-categorise page never offers a stored "Salaries"', w._autocatCats().includes('Salaries'), false, true);

  await w.openBudgetTargetsModal(); await settle(5, 30);
  const chips = Array.from(d.querySelectorAll('#_bt-suggested button')).map(b => b.textContent.trim());
  eq('4  budget suggestions are the breakdown\'s rows: Payroll (not Salaries) … Bills & vendors', [chips.includes('Payroll'), chips.includes('Salaries'), chips.includes('Bills & vendors')], [true, false, true], [false, true, false]);
  // The suggested name is the one that MATCHES: a Payroll target reads the year's payroll (the approved July run, gross
  // 2,000 — clientMoneyKit), a Salaries target reads 0 (no breakdown row is called "Salaries").
  await http.request('PUT', '/api/budget-targets', { Payroll: 24000, Salaries: 24000 });
  if (typeof w.setPeriod === 'function') { try { w.setPeriod('year'); } catch (_) {} }
  await w._loadBudgetFromDB(); await settle(10, 40);
  const act = Object.fromEntries((w.BUDGET_DATA || []).map(r => [r.cat, r.actual]));
  eq('4  a "Payroll" target reads the payroll actual 2,000; a "Salaries" one reads 0', [act.Payroll, act.Salaries], [2000, 0]);
}, {});

// (Onboarding's currency list — shown only to a user with no business yet — is checked by verify-fab8-onboarding-currency.js.)
