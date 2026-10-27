'use strict';
/**
 * verify-la15a-native-symbol.js — LA15a (live audit 2026-10-13 follow-up): money in the business app written with a
 * literal "$" — wrong for every non-USD business (C3 class). Each live site now renders through _fmtMoneyNative (the
 * business's own symbol, sign, "show cents"). Sites that are USD by design are left alone (subscription pricing, admin,
 * accountant earnings, USD-priced holdings, the explicit "≈$… USD" figures).
 *
 * Real SPA, real scratch Postgres. The SPA boots on a TTD business ("Island Traders", activated before load), seeded
 * through the real routes: a chart-of-accounts asset with a 2,500 opening-balance journal (FA-M7); a project with budget 5,000; a catalogue item
 * priced 150; an uncategorised expense of 75. Every surface must say TT$ — the bug says "$".
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la15a-native-symbol.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA15a — business money shows the business\'s own currency, never a literal "$"', async ({ w, d, settle, eq }) => {
  const ent = (w.ENTITIES || []).find(e => e.active);
  eq('active business is the TTD one', ent && ent.currency, 'TTD');
  const txt = id => (d.getElementById(id) || {}).textContent || '';
  const has = (s, re) => re.test(s.replace(/\s+/g, ' '));

  w.showPage('chart-of-accounts'); await settle(40, 50);
  eq('chart of accounts row: TT$2,500', has(txt('coa-list'), /TT\$2,500/), true);
  eq('chart of accounts: no bare "$2,500"', has(txt('coa-list'), /(^|[^T])\$2,500/), false, true);

  w.showPage('projects'); await settle(40, 50);
  eq('project budget: TT$5,000', has(txt('page-projects'), /TT\$5,000/), true);
  eq('projects: no bare "$5,000"', has(txt('page-projects'), /(^|[^T])\$5,000/), false, true);

  w.showPage('items'); await settle(40, 50);
  eq('item price: TT$150', has(txt('items-list'), /TT\$150/), true);
  eq('items: no bare "$150"', has(txt('items-list'), /(^|[^T])\$150/), false, true);

  w.showPage('autocat'); await settle(40, 50);
  if (typeof w.renderAutocat === 'function') { await w.renderAutocat(); await settle(5, 30); }
  eq('auto-categorise row: -TT$75', has(txt('autocat-list'), /-TT\$75/), true);

  const html = w.buildInvoiceHTML((w.invTemplatesData && w.invTemplatesData[0] || {}).id, null, {});
  eq('invoice template preview: sample total in TT$', /TT\$/.test(html) && !/[^T]\$4,800/.test(html), true, false);

  let prompt = '';
  w.sendAIQuery = q => { prompt = q; };
  w.openAIPanel = () => {};
  const inv = d.getElementById('sl-invest'); if (inv) inv.value = '20';
  w.getScenarioAI();
  eq('scenario prompt names the investment in TT$', /TT\$20K/.test(prompt) && !/[^T]\$20K/.test(prompt), true, false);
}, { extraSeed: async ({ http, client, userId }) => {
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
  // Test setup (scratch DB): a second business needs a plan above trial.
  await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
  const tt = await J('POST', '/api/entities', { name: 'Island Traders', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
  await J('POST', '/api/entities/' + tt.id + '/activate', {});
  // FA-M7: an own account has no typed balance — its 2,500 opening balance is a journal (Dr 1010 / Cr 3100 Owner's Equity).
  const opAcct = await J('POST', '/api/chart-of-accounts', { code: '1010', name: 'Operating account', category: 'Assets', idempotency_key: 'la15a-coa' });
  await J('POST', '/api/journals', { date: '2026-07-01', description: 'Opening balance', status: 'Posted', idempotency_key: 'la15a-ob',
    lines: [{ acct: 'own:' + opAcct.id, debit: 2500, credit: 0 }, { acct: 'sys:3100', debit: 0, credit: 2500 }] });
  await J('POST', '/api/projects', { name: 'Harbour fit-out', client: 'Port Co', budget: 5000 });
  await J('POST', '/api/items', { name: 'Consulting', type: 'Service', price: 150, unit: 'hr', status: 'Active' });
  await J('POST', '/api/expenses', { description: 'Mystery charge', category: 'Other', amount: 75, deductible: 'no', expense_date: '2026-07-20', idempotency_key: 'la15a-e' });
} });
