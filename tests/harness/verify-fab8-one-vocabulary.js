'use strict';
/**
 * FA-B8 (2026-10-27), server half — one expense vocabulary; payroll, cost of goods and transfers are never expense
 * categories (basis C / Rule 12), from any writer: the expense routes, auto-categorise rules, the rule run, the AI
 * suggestions.
 *
 * BUG (executed on the old code): a rule could be saved as "Salaries" or "Cost of Goods" and its run wrote that label onto
 * ordinary expenses; the AI's allowed list included both and "Bank Transfer"; an expense could be POSTed as "Payroll" —
 * which the breakdown then merges into its Payroll row beside the payroll runs.
 *
 * Seed "B8 Co": an uncategorised expense "ACME PAYROLL SERVICES" 300, and — as the OLD code allowed — a saved rule
 * "payroll" → "Salaries" and an expense saved as "Salaries" 50 (inserted directly: the new routes refuse both).
 */
const { run } = require('./moneyFixKit.js');

run('FA-B8 — no expense is payroll, cost of goods or a transfer, from any writer', async ({ newOwner, c, eq }) => {
  const { uid, J, http, ids: [eid] } = await newOwner('B8');
  const st = async (m, p, b) => (await http.request(m, p, b)).status;

  eq('1  a rule naming "Salaries" is refused', await st('POST', '/api/autocat-rules', { keyword: 'payroll', category: 'Salaries' }), 400, 201);
  const okRule = await J('POST', '/api/autocat-rules', { keyword: 'adobe', category: 'Software' });
  eq('1  a rule edited to "Cost of Goods" is refused', await st('PUT', '/api/autocat-rules/' + okRule.id, { category: 'Cost of Goods' }), 400, 200);
  eq('1  an expense POSTed as "Payroll" is refused', await st('POST', '/api/expenses', { description: 'Wages', category: 'Payroll', amount: 100, expense_date: '2026-07-02' }), 400, 201);
  eq('1  …and as "Bank Transfer"', await st('POST', '/api/expenses', { description: 'To savings', category: 'Bank Transfer', amount: 100, expense_date: '2026-07-02' }), 400, 201);
  eq('1  an ordinary category is fine (Office Supplies)', await st('POST', '/api/expenses', { description: 'Paper', category: 'Office Supplies', amount: 20, expense_date: '2026-07-02' }), 201);

  // What the OLD code allowed, inserted directly.
  await c.query(`INSERT INTO autocat_rules (user_id, data) VALUES ($1, $2)`, [uid, { keyword: 'payroll', match_type: 'description', category: 'Salaries', enabled: 1 }]);
  const legacyExp = (await c.query(`INSERT INTO expenses (user_id, entity_id, data) VALUES ($1, $2, $3) RETURNING id`, [uid, eid, { description: 'Old salary row', category: 'Salaries', amount: 50, expense_date: '2026-07-01' }])).rows[0].id;
  const target = await J('POST', '/api/expenses', { description: 'ACME PAYROLL SERVICES', category: 'Other', amount: 300, expense_date: '2026-07-03' });

  const runRes = await J('POST', '/api/autocat-rules/run', {});
  const cat = (await c.query(`SELECT data->>'category' c FROM expenses WHERE id = $1`, [target.id])).rows[0].c;
  eq('2  the old "Salaries" rule is skipped by the run — the expense stays "Other", the rule is reported', [cat, (runRes.skipped_rules || []).map(r => r.category)], ['Other', ['Salaries']], ['Salaries', []]);
  const ai = await http.request('POST', '/api/autocat-rules/ai-suggest', {});
  const sugg = ((ai.json && ai.json.suggestions) || []).filter(x => x.expense_id === target.id).map(x => x.category);
  eq('2  AI suggestions (rules first; no key here) never offer "Salaries"', sugg.includes('Salaries'), false, true);

  eq('3  an old "Salaries" expense can still be edited without changing its category (Rule 8 — not reclassified)', await st('PUT', '/api/expenses/' + legacyExp, { amount: 55, category: 'Salaries' }), 200, 200);
  eq('3  …but cannot be changed TO a non-expense category', await st('PUT', '/api/expenses/' + target.id, { category: 'Wages' }), 400, 200);
});
