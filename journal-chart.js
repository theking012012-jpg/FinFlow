'use strict';
/**
 * journal-chart.js — FA-M7 (2026-10-27): ONE chart of accounts per business.
 *
 * Before: the journal picker offered a fixed 16-account template (app-main.js COA_ACCOUNTS, copied into the accountant
 * portal) whose codes collide with the ledger's own chart (template 5000 "Salaries & Wages" vs ledger 5000 "Cost of
 * Goods Sold"; template 3000/3100 the swap of the ledger's 3000/3100). Every journal line was posted to a separate
 * J-namespaced ledger account named "Journal 5000", so the Chart of Accounts page showed a second, nameless account
 * for every one the user picked, and a journal to the business's OWN account (6950 Website costs) left that account
 * at 0 while a "J6950 Journal 6950" held the money.
 *
 * Now: the chart is what the Chart of Accounts page shows — the built-in accounts, the business's own accounts, and
 * any journal account already in its ledger from before — and the journal picker (owner and accountant) offers exactly
 * that chart. A line picked from it carries `acct`; the server resolves it here and the line posts to THAT account.
 * Lines without `acct` (journals stored before this change, API callers) keep the old J-namespace posting, so no
 * existing ledger entry changes meaning on a re-sync (Rule 8).
 *
 * Built-in accounts a journal may NOT use, and why (each figure comes from its own documents):
 *   1250 / 2200 / 6100 — payroll: payroll runs are the only source of payroll figures (Rule 12, basis C)
 *   5000 Cost of Goods Sold — FIFO from inventory movements; a journal expense is booked as operating expense
 *   7000 FX Gain/Loss — FX settlements
 */

const CAT_TYPE = { Assets: 'asset', Liabilities: 'liability', Equity: 'equity', Revenue: 'income', Expenses: 'expense' };
const TYPE_CAT = Object.fromEntries(Object.entries(CAT_TYPE).map(([c, t]) => [t, c]));
const NORMAL = t => (t === 'asset' || t === 'expense') ? 'debit' : 'credit';

const NOT_FOR_JOURNALS = {
  '1250': 'Payroll — comes from your payroll runs',
  '2200': 'Payroll — comes from your payroll runs',
  '6100': 'Payroll — comes from your payroll runs',
  '5000': 'Cost of goods sold — comes from your inventory sales',
  '7000': 'FX gain / loss — comes from settling foreign-currency positions',
};

// The old template's names, for journal accounts posted before FA-M7 whose ledger row was named "Journal <code>".
const LEGACY_NAMES = {
  J1000: 'Cash', J1010: 'Checking Account', J1020: 'Savings Account', J1100: 'Accounts Receivable', J1200: 'Inventory',
  J1500: 'Equipment', J2000: 'Accounts Payable', J2100: 'Credit Card', J2200: 'Tax Payable', J3000: "Owner's Equity",
  J3100: 'Retained Earnings', J4000: 'Service Revenue', J4100: 'Product Sales', J5000: 'Salaries & Wages', J5100: 'Rent',
  J5200: 'Software Subscriptions', J5300: 'Marketing',
};

// An own account's code: letters / digits / . - (max 20), not starting with J (reserved for older journal accounts).
const OWN_CODE_RE = /^(?![Jj])[A-Za-z0-9][A-Za-z0-9.\-]{0,19}$/;

/**
 * The business's chart. builtIn = DEFAULT_COA; ledger = glFinancials(...).accounts ({code,name,type,balance});
 * own = chart_of_accounts rows of this business ({id, code, name, category}).
 * Returns rows { acct, code, name, type, category, normal, balance, kind: 'builtin'|'own'|'older', journal, why }.
 */
function buildChart({ builtIn, ledger, own }) {
  const rows = [], byCode = new Map((ledger || []).map(a => [String(a.code), a]));
  const builtCodes = new Set((builtIn || []).map(b => b.code));
  for (const b of builtIn || []) {
    const g = byCode.get(b.code);
    const why = NOT_FOR_JOURNALS[b.code] || null;
    rows.push({ acct: 'sys:' + b.code, code: b.code, name: b.name, type: b.type, kind: 'builtin', balance: g ? Number(g.balance) || 0 : 0, journal: !why, why });
  }
  for (const o of own || []) {
    const code = String(o.code || '').trim();
    const type = CAT_TYPE[o.category];
    if (!code || !type || builtCodes.has(code) || !OWN_CODE_RE.test(code)) continue;   // never shadow a built-in account
    const g = byCode.get(code);
    rows.push({ acct: 'own:' + o.id, code, name: String(o.name || '').trim() || code, type: g ? g.type : type, kind: 'own',
      balance: g ? Number(g.balance) || 0 : 0, journal: true, why: null });
  }
  const taken = new Set(rows.map(r => r.code));
  for (const a of ledger || []) {
    const code = String(a.code);
    if (taken.has(code) || !/^J/.test(code)) continue;
    const nm = String(a.name || '').trim();
    rows.push({ acct: 'led:' + code, code, name: (!nm || /^Journal\s/.test(nm)) ? (LEGACY_NAMES[code] || nm || code) : nm, type: a.type,
      kind: 'older', balance: Number(a.balance) || 0, journal: true, why: null });
  }
  for (const r of rows) { r.category = TYPE_CAT[r.type] || 'Other'; r.normal = NORMAL(r.type); r.balance = Math.round(r.balance * 100) / 100; }
  const order = { asset: 1, liability: 2, equity: 3, income: 4, expense: 5 };
  return rows.sort((x, y) => (order[x.type] || 9) - (order[y.type] || 9) || x.code.replace(/^J/, '').localeCompare(y.code.replace(/^J/, '')) || x.code.localeCompare(y.code));
}

/**
 * Resolve picked lines against the chart. Returns { lines } or { error }. A line with `acct` must name a journal
 * account of this chart; the stored line carries the server's own { acct, code, name, type, ledger } — never a
 * client-sent `ledger` / `type`. A line without `acct` is kept as sent (minus those two fields): the old posting path.
 */
function resolveLines(lines, chart) {
  const byAcct = new Map((chart || []).map(r => [r.acct, r]));
  const out = [];
  for (const l of lines || []) {
    const { ledger, type, ...rest } = l || {};   // eslint-disable-line no-unused-vars
    if (rest.acct == null || rest.acct === '') { out.push(rest); continue; }
    const r = byAcct.get(String(rest.acct));
    if (!r) return { error: 'An account on this journal is not in this business\'s chart of accounts. Pick it again from the list.' };
    if (!r.journal) return { error: (r.code + ' ' + r.name) + ' cannot take a journal: ' + r.why + '.' };
    out.push(Object.assign({}, rest, { acct: r.acct, code: r.code, name: r.name, type: r.type, ledger: r.code }));
  }
  return { lines: out };
}

module.exports = { buildChart, resolveLines, CAT_TYPE, TYPE_CAT, NOT_FOR_JOURNALS, LEGACY_NAMES, OWN_CODE_RE, NORMAL };
