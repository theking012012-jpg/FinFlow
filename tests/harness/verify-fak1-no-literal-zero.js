'use strict';
/**
 * FA-K1 (2026-10-27) — no KPI card starts as a literal "$0". 52 cards carried "$0" in the markup: a figure nobody computed,
 * in the wrong symbol for a non-USD business, shown until (or, on a card no loader fills, instead of) the real one.
 * Now they start as "—" (not computed yet). Executed on a TTD business: after load no card reads a bare "$0".
 */
const fs = require('fs'), path = require('path');
const { run } = require('./clientMoneyKit.js');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
run('FA-K1 — no literal $0 KPI cards', async ({ w, d, settle, eq }) => {
  eq('1  STRUCTURAL: KPI cards with a literal "$0" in the markup', (html.match(/<div class="mc-val[^"]*"[^>]*>\$0</g) || []).length, 0, 52);
  const bare = [];
  for (const p of ['dashboard', 'invoices', 'expenses', 'bills', 'inventory', 'payroll', 'reports', 'banking', 'chart-of-accounts']) {
    try { w.showPage(p); } catch (_) {} await settle(15, 40);
    d.querySelectorAll('#page-' + p + ' .mc-val').forEach(e => { if (/(^|[^A-Z])\$0(\D|$)/.test(e.textContent.trim())) bare.push(p + ':' + (e.id || '?') + '=' + e.textContent.trim()); });
  }
  eq('2  on a TTD business no card reads a bare "$0" after the pages load', bare, []);
}, { extraSeed: async ({ http, client, userId }) => {
  await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
  const r = await http.request('POST', '/api/entities', { name: 'Island Traders', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
  await http.request('POST', '/api/entities/' + r.json.id + '/activate', {});
} });
