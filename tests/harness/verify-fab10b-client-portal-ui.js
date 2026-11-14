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
  // N3-16 (2026-11-13): this grabbed the Portal button ONCE after a fixed 0.8 s and clicked that element. The Customers
  // list draws, then redraws when its data lands — on the owner's machine 2 of 7 runs clicked a button the redraw had
  // already replaced ("Element is not attached to the DOM"). A locator is looked up again at click time and waits for it.
  const portalBtn = app.locator('#customers-list .cust-row', { hasText: 'Acme Ltd' }).locator('button', { hasText: /^Portal$/ });
  const has = await portalBtn.first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
  eq('1  Acme\'s row has a Portal button', has, true, false);
  let url = '';
  if (has) {
    await portalBtn.first().click();
    const create = app.locator('#cust-portal-modal button', { hasText: /^Create link$/ });
    await create.waitFor({ state: 'visible', timeout: 15000 });
    await create.click();
    await app.waitForFunction(() => /\/portal#/.test((document.getElementById('cust-portal-url') || {}).value || ''), null, { timeout: 15000 }).catch(() => {});
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
  // N3-16: wait for the customer's figures to arrive instead of a fixed 0.8 s
  await cust.waitForFunction(() => /\$/.test((document.querySelector('#portal-total .v') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
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
