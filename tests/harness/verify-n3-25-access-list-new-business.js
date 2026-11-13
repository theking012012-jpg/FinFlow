'use strict';
/**
 * verify-n3-25-access-list-new-business.js — N3-25 (live re-audit note under N3-4, 2026-11-11; owner: "this needs to fix").
 * My Accountant → Access permissions listed only the businesses that existed when the page first loaded its accountant: a
 * business created afterwards was missing until a full page reload (it starts with no access, so nothing leaked — but the
 * owner could not grant it).
 *
 * Executed in Chromium (browserKit, real server, real accountant link). The business is created through the app's own
 * "Add business" path (submitCreateBusiness, the "Create business →" button), exactly as a user does.
 * EXPECTED: after creating it (the "Create business →" button, which lands on the dashboard), opening My Accountant lists
 * BOTH businesses, the new one at "None" (C6: an unlisted business is hidden from the accountant).
 * BUG VALUE: one row ("Layout Co") until a reload.
 */
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

runBrowser('N3-25 — a new business appears in the accountant access list without a reload', async ({ open, A, c, uid }) => {
  const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
     VALUES ('n325-acc@finflow.test', $1, 'Ada', 'Ledger', 'Firm', 'N325', 'verified') RETURNING id`, [bcrypt.hashSync('x-not-a-secret', 10)])).rows[0].id;
  // a C6-shaped grant (every link made since C6): Layout Co = view, personal none — unlisted businesses are hidden
  const layout = (await c.query(`SELECT id FROM entities WHERE user_id = $1 ORDER BY id LIMIT 1`, [uid])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, entity_access) VALUES ($1, $2, 'active', 'view', $3)`,
    [acc, uid, JSON.stringify({ entities: { [String(layout)]: 'view' }, personal: 'none' })]);
  const rows = page => page.evaluate(() => [...document.querySelectorAll('#acc-perm-matrix select[data-perm-kind="entity"]')].map(s => ({ name: (s.parentElement.firstElementChild || s.parentElement).textContent.replace(/\s+/g, ' ').trim().slice(0, 40), val: s.value })));
  // the real "Create business →" button (submitCreateBusiness — the only create path wired in index.html)
  const addBiz = async (page, name) => {
    await page.evaluate(() => window.openCreateBusinessPage()); await sleep(800);   // the real opener (fills country / timezone lists)
    await page.evaluate(n => { const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); } };
      set('nb-name', n); set('nb-country', 'US'); set('nb-currency', 'USD'); }, name);
    await page.evaluate(() => window.submitCreateBusiness());
  };
  const page = await open({ width: 1280, height: 900 });

  // (a) create on another page, then open My Accountant
  await page.evaluate(() => window.showPage('my-accountant')); await sleep(2500);
  const r0 = await rows(page);
  A('starting point: one business row ("Layout Co")', r0.length === 1, JSON.stringify(r0));
  await page.evaluate(() => window.showPage('dashboard')); await sleep(800);
  await addBiz(page, 'North Branch'); await sleep(1500);
  await page.evaluate(() => window.showPage('my-accountant')); await sleep(2000);
  const r1 = await rows(page);
  A('(a) after creating "North Branch" elsewhere, My Accountant lists 2 businesses (bug: 1)', r1.length === 2 && r1.some(r => /North Branch/.test(r.name)), JSON.stringify(r1));
  A('(a) the new business starts at "None"', (r1.find(r => /North Branch/.test(r.name)) || {}).val === 'none', JSON.stringify(r1));

});
