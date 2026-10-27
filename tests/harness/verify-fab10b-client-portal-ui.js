'use strict';
/**
 * FA-B10b (2026-10-27), the pages — real Chromium (which enforces the portal's strict policy), real server.
 * Seed: "Layout Co" (USD) with invoices for "Acme Ltd": 250 pending (due 2026-01-10, overdue) and 120 pending (due
 * 2099-01-01), and one for "Beta" 999. Hand-computed: Acme owes 370, of which 250 overdue; Beta's 999 never shows.
 *   owner: Customers → Acme's "Portal" → "Create link" → a /portal#… link is shown          bug: no Portal button
 *   customer, at 375 px, no session: the page renders 370 / 250, two invoices, no sideways scroll, no blocked code
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('FA-B10b UI — the owner shares a portal link; the customer opens it', async ({ open, eq }) => {
  const app = await open({ width: 1280, height: 800 });
  await app.evaluate(() => window.showPage('customers'));
  await app.waitForTimeout(800);
  const btn = await app.evaluateHandle(() => Array.from(document.querySelectorAll('#customers-list .cust-row')).filter(r => /Acme Ltd/.test(r.textContent))
    .map(r => Array.from(r.querySelectorAll('button')).find(b => b.textContent.trim() === 'Portal'))[0] || null);
  eq('1  Acme\'s row has a Portal button', !!(await btn.jsonValue() !== null && await app.evaluate(b => !!b, btn)), true, false);
  let url = '';
  if (await app.evaluate(b => !!b, btn)) {
    await btn.click(); await app.waitForTimeout(500);
    await app.evaluate(() => Array.from(document.querySelectorAll('#cust-portal-modal button')).find(b => b.textContent === 'Create link').click());
    await app.waitForTimeout(800);
    url = await app.evaluate(() => (document.getElementById('cust-portal-url') || {}).value || '');
  }
  eq('1  "Create link" shows the link to copy', /\/portal#[A-Za-z0-9_-]{43}$/.test(url), true, false);
  const meta = await app.evaluate(() => (document.getElementById('cust-portal-meta') || {}).textContent || '');
  eq('1  …with when it stops working and that it has not been opened', /Works until .+ · not opened yet/.test(meta), true);

  const blocked = [];
  const cust = await open({ width: 375, height: 812, beforeGoto: async (ctx, page) => {
    await ctx.clearCookies();   // the customer has no FinFlow session
    page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) blocked.push(m.text().slice(0, 140)); });
    page.on('pageerror', e => blocked.push('error: ' + e.message.slice(0, 140)));
  } }, url ? url.slice(url.indexOf('/portal#')) : '/portal#missing');
  await cust.waitForTimeout(800);
  const r = await cust.evaluate(() => ({
    total: (document.querySelector('#portal-total .v') || {}).textContent || '',
    overdue: (document.querySelector('#portal-overdue .v') || {}).textContent || '',
    rows: Array.from(document.querySelectorAll('.inv[data-invoice]')).map(e => e.querySelector('.amt').textContent),
    beta: /999|Beta/.test(document.body.textContent),
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  eq('2  the customer sees owed 370 and overdue 250', [r.total, r.overdue], ['$370.00', '$250.00']);
  eq('2  …their two open invoices (overdue first), nothing of Beta\'s', [r.rows, r.beta], [['$250.00', '$120.00'], false]);
  eq('2  at 375 px nothing scrolls sideways', r.over <= 1, true);
  eq('2  the strict policy blocks nothing on the page (no inline code), no script errors', blocked, []);
}, { seed: async ({ J }) => {
  await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 250, status: 'pending', issue_date: '2025-12-10', due_date: '2026-01-10', idempotency_key: 'u-1' });
  await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 120, status: 'pending', issue_date: '2026-01-02', due_date: '2099-01-01', idempotency_key: 'u-2' });
  await J('POST', '/api/invoices', { client: 'Beta', amount: 999, status: 'pending', issue_date: '2026-01-02', due_date: '2026-02-01', idempotency_key: 'u-3' });
} });
