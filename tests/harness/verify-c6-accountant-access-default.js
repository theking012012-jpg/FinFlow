'use strict';
/**
 * C6 (Cowork end-to-end test 6.4 / 6.5a):
 *   (1) a NEW accountant link starts with nothing granted — the accountant sees no business and no personal data until
 *       the owner grants them. BUG: a new link had entity_access NULL (the legacy meaning: every business visible),
 *       so Island Traders was visible before the owner had chosen anything.
 *   (2) the accountant's personal panel shows income and spending for the year to date. BUG: the panel showed net
 *       worth / portfolio / assets / liabilities only — the server's income and expense figures were never drawn.
 * Seed: owner with businesses A and B; personal income 1,800 (2026-03-02) and spending 320 (2026-04-03), USD.
 *   link entity_access          → {entities:{}, personal:'none'}      bug: null (all businesses)
 *   accountant reads A's books  → refused (no access)                 bug: 200 with A's figures
 *   panel income / spending     → "USD 1,800.00" / "USD 320.00"       bug: no income or spending on the panel
 * The panel check runs the page's own openPersonalPanel (lifted from accountant-client.html — labelled: structural
 * extraction) on the server's real /books response.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { JSDOM } = require('jsdom');
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

run('C6 — accountant links start with nothing granted; personal panel has income and spending', async ({ newOwner, c, eq, A, server }) => {
  const o = await newOwner('C6', [{ name: 'A Co', currency: 'USD' }, { name: 'B Co', currency: 'USD' }]);
  const [eA] = o.ids;
  await o.J('POST', '/api/personal-transactions', { description: 'Consulting', category: 'Income', amount: 1800, tx_type: 'income', tx_date: '2026-03-02', currency: 'USD' });
  await o.J('POST', '/api/personal-transactions', { description: 'Groceries', category: 'Groceries', amount: 320, tx_type: 'expense', tx_date: '2026-04-03', currency: 'USD' });
  const PW = 'c6-acc-pw-not-a-secret';
  const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ('c6-acc@finflow.test', $1, 'C', 'Six', 'Firm', 'C6REF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;

  eq('owner requests a link', (await o.http.post('/api/accountants/request-access', { accountantId: accId })).status, 200);
  const row = (await c.query(`SELECT entity_access FROM accountant_clients WHERE accountant_id=$1 AND user_id=$2`, [accId, o.uid])).rows[0];
  eq('new link grants nothing', row && row.entity_access, { entities: {}, personal: 'none' }, null);
  await c.query(`UPDATE accountant_clients SET status='active' WHERE accountant_id=$1 AND user_id=$2`, [accId, o.uid]);   // the accountant approves

  const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.240' });
  A('accountant login', (await ACC.post('/api/accountants/login', { email: 'c6-acc@finflow.test', password: PW })).status === 200);
  const before = await ACC.get(`/api/accountants/clients/${o.uid}/books?period=year&entity_id=${eA}`);
  eq("accountant cannot read A's books before any grant", before.status >= 400 || !((before.json || {}).summary), true, false);

  A('owner grants A (view) and personal (view)', (await o.http.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [eA]: 'view' }, personal: 'view' } })).status === 200);
  const books = (await ACC.get(`/api/accountants/clients/${o.uid}/books?period=year&entity_id=${eA}`)).json || {};
  A("after the grant the accountant reads A's books", !!books.summary);

  // The panel: the page's own openPersonalPanel on the server's real response.
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'accountant-client.html'), 'utf8');
  const m = html.match(/window\.openPersonalPanel = function\(\) \{[\s\S]*?\n\};/);
  A('[STRUCTURAL] openPersonalPanel found in accountant-client.html', !!m);
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  w._data = { personal: books.personal, personalAccess: 'view' };
  w.eval('var _data = window._data; var esc = window.esc;\n' + (m ? m[0] : ''));
  w.openPersonalPanel();
  const t = id => ((w.document.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').trim();
  eq('panel: income for the year', /USD 1,800\.00/.test(t('pp-income')), true, false);
  eq('panel: spending for the year', /USD 320\.00/.test(t('pp-expense')), true, false);
});
