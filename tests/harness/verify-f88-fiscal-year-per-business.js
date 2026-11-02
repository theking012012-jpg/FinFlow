'use strict';
/**
 * verify-f88-fiscal-year-per-business — F88 / F89 (the viewer-dependence class): the fiscal year belongs to the BUSINESS.
 * Before, it was one account-wide setting, and the server took the fiscal-year start from whatever the browser sent
 * (?fyStart=) on /api/reports, the tax worksheet, COGS and the GL statements — so the same books gave a different "this
 * fiscal year" depending on what a page sent, and two businesses with different years could not exist.
 * Now: entities.data.fiscal_year (a month name) per business, the account setting as the default for any business that
 * never set one; the SERVER resolves it (a sent fyStart is ignored); Settings shows and saves the viewed business's.
 * Real server + scratch Postgres + the real /app in Chromium (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f88-fiscal-year-per-business.js
 *
 * Seed (Rule 4): today 25 Jul 2026. Business A's year starts in APRIL, business B's in January (the account default).
 * Each has the same two invoices: 15 Mar 2026 ($1,000) and 10 May 2026 ($300).
 *   A this fiscal year (1 Apr 2026 →) = $300            (bug: the sent fyStart=0 → $1,300)
 *   B this fiscal year (1 Jan 2026 →) = $1,300
 */
const { runBrowser } = require('./browserKit.js');
runBrowser('F88 — the fiscal year is the business\'s, and the server decides it', async ({ open, A, eq, J, http, c, uid }) => {
  const eA = (await J('GET', '/api/entities'))[0];
  const eB = await J('POST', '/api/entities', { name: 'January Co', currency: 'USD', country: 'US', timezone: 'UTC' });
  const putA = await http.put('/api/entities/' + eA.id, { fiscal_year: 'April' });
  eq('a business can have its own fiscal year (PUT fiscal_year)', putA.status, 200);
  eq('…an invalid month is refused', (await http.put('/api/entities/' + eA.id, { fiscal_year: 'Smarch' })).status, 400);
  for (const e of [eA, eB]) {
    await http.post('/api/entities/' + e.id + '/activate', {});
    await J('POST', '/api/invoices', { client: 'March Client', amount: 1000, status: 'pending', issue_date: '2026-03-15', due_date: '2026-04-15', idempotency_key: 'f88-m-' + e.id, entity_id: e.id });
    await J('POST', '/api/invoices', { client: 'May Client', amount: 300, status: 'pending', issue_date: '2026-05-10', due_date: '2026-06-10', idempotency_key: 'f88-y-' + e.id, entity_id: e.id });
  }
  const rev = async (eid, extra) => { await http.post('/api/entities/' + eid + '/activate', {}); return ((await http.get('/api/reports?period=year' + (extra || ''))).json || {}).revenue; };
  eq('A (year from April): this fiscal year = $300 even when the page sends fyStart=0 (bug: $1,300)', await rev(eA.id, '&fyStart=0'), 300, 1300);
  eq('A with no fyStart sent: $300', await rev(eA.id), 300);
  eq('B (account default, January): $1,300 even when the page sends fyStart=3', await rev(eB.id, '&fyStart=3'), 1300, 300);
  await http.post('/api/entities/' + eA.id + '/activate', {});
  const tax = (await http.get('/api/tax-filing?fyStart=0')).json || {};
  A('the tax worksheet uses the business\'s year too (A: revenue 300)', tax && (tax.revenue === 300 || (tax.summary && tax.summary.revenue === 300)), JSON.stringify(tax).slice(0, 200));
  const gl = (await http.get('/api/gl/pnl?period=year&fyStart=0')).json || {};
  A('the GL P&L uses the business\'s year (A: revenue 300)', gl && gl.income === 300, JSON.stringify(gl).slice(0, 200));

  // the page
  const page = await open({ width: 1280, height: 900 });
  await page.waitForTimeout(1500);
  const ui = await page.evaluate(async (ids) => {
    const idx = id => (window.ENTITIES || []).findIndex(e => Number(e._dbId) === Number(id));
    await switchEntity(idx(ids.a)); await new Promise(r => setTimeout(r, 1500));
    const fyA = document.getElementById('s-fy').value, revA = document.getElementById('d-rev').textContent;
    await switchEntity(idx(ids.b)); await new Promise(r => setTimeout(r, 1500));
    const fyB = document.getElementById('s-fy').value, revB = document.getElementById('d-rev').textContent;
    return { fyA, revA, fyB, revB };
  }, { a: eA.id, b: eB.id });
  eq('Settings shows each business\'s own fiscal year (A April, B January)', [ui.fyA, ui.fyB], ['April', 'January']);
  A('the dashboard Year revenue follows it (A $300, B $1,300)', /\$300\b/.test(ui.revA) && /1,300|1\.3K/.test(ui.revB), JSON.stringify(ui));
  const saved = await page.evaluate(async () => { document.getElementById('s-fy').value = 'July'; if (typeof saveSettings === 'function') await saveSettings(); await new Promise(r => setTimeout(r, 1000)); return true; });
  const fy = async id => (await c.query(`SELECT data->>'fiscal_year' f FROM entities WHERE id = $1`, [id])).rows[0].f;
  eq('saving Settings on B sets B\'s year only (B July, A still April)', [saved && await fy(eB.id), await fy(eA.id)], ['July', 'April']);
}, {});
