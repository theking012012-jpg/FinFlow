'use strict';
/**
 * verify-n3-18-session-ended.js — N3-18 (live chat check 2026-11-11).
 * When a session ended while a page was open, every /api call answered 401 and the page went quietly empty — seen live:
 * the owner's chat read "No messages yet" while the accountant had sent 3 messages (the accountant's sign-in in the same
 * browser had replaced the shared session cookie). Nothing told the user they were signed out.
 *
 * Executed in Chromium (browserKit, real server, real sessions). EXPECTED / BUG per case:
 *   A owner app: the session is ended (sign-out from another tab of the same browser), then the user opens My Accountant
 *     → a "You've been signed out" dialog; its button reloads to the sign-in screen.        BUG: no dialog, empty chat.
 *   B owner app: the same browser signs in as an ACCOUNTANT (shared cookie) → the owner page's next call shows the dialog.
 *   C accountant portal: the session ends → the dialog; its button goes to /accountant-login.
 *   D NO dialog for a 401 with the session intact: Settings → change password with a WRONG current password.
 *   E NO dialog for a signed-out visitor opening /app (sign-in screen only).
 */
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

runBrowser('N3-18 — a page tells the user when their session has ended', async ({ open, A, c, uid, http, base }) => {
  const PW = 'n318-pw-not-a-secret';
  const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
     VALUES ('n318-acc@finflow.test', $1, 'Ada', 'Ledger', 'Firm', 'N318', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1, $2, 'active', 'view')`, [acc, uid]);
  await c.query(`INSERT INTO accountant_messages (accountant_id, user_id, message, sender, created_at) VALUES ($1, $2, 'Hello from Ada', 'accountant', NOW())`, [acc, uid]);
  const OWNER_PW = require('./browserKit.js').PW_FOR_TESTS;
  // every case signs in on its own (the kit's shared session is ended by case A)
  const fresh = async (vp, path = '/app') => open({ ...vp, beforeGoto: async (ctx, pg) => {
    await ctx.clearCookies();
    // the server clock is pinned (2026-07-25), so its cookie arrives already EXPIRED for the real-clock browser —
    // sign in through the harness client and hand the browser the session cookie without an expiry (as browserKit does)
    const h = new (require('./httpClient.js').HarnessHttp)(base);
    const r = await h.post('/api/auth/login', { email: 'layout-owner@finflow.test', password: OWNER_PW });
    if (r.status !== 200) throw new Error('owner login ' + r.status);
    await ctx.addCookies([...h.cookies.entries()].map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: '/' })));
  } }, path);
  // Sign in through the harness client, carrying the browser's current cookies (as the same browser would), then give
  // the browser the resulting session cookie without an expiry (the pinned server clock would otherwise expire it).
  const signInAs = async (ctx, path, body) => {
    const h = new (require('./httpClient.js').HarnessHttp)(base);
    for (const ck of await ctx.cookies()) h.cookies.set(ck.name, ck.value);
    const r = await h.post(path, body);
    await ctx.addCookies([...h.cookies.entries()].map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: '/' })));
    return r.status;
  };
  const dialog = page => page.evaluate(() => { const d = document.getElementById('ff-session-ended'); return d ? { shown: getComputedStyle(d).display !== 'none', text: d.textContent } : null; });

  // A — owner signs out from "another tab" (same cookie jar), then uses the page
  {
    const page = await fresh({ width: 1280, height: 900 });
    await page.evaluate(() => window.showPage('dashboard')); await sleep(1200);
    A('A: signed in, no dialog yet', !(await dialog(page)));
    const other = await page.context().newPage(); await other.goto(base + '/app');
    await other.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })); await other.close();
    await page.evaluate(() => window.showPage('my-accountant')); await sleep(2500);
    const d = await dialog(page);
    A('A: after the session ended, opening My Accountant shows "You\'ve been signed out" (bug: empty chat, no dialog)', !!d && d.shown && /signed out/i.test(d.text), JSON.stringify(d));
    if (d) {
      await page.click('#ff-se-signin'); await page.waitForLoadState('load'); await sleep(1500);
      A('A: "Sign in again" lands on the sign-in screen', await page.evaluate(() => !!document.getElementById('ff-auth-gate') && !!document.getElementById('ff-lp')));
    }
    await page.context().close();
  }
  // B — same browser signs in as the accountant
  {
    const page = await fresh({ width: 1280, height: 900 });
    await page.evaluate(() => window.showPage('dashboard')); await sleep(1200);
    const st = await signInAs(page.context(), '/api/accountants/login', { email: 'n318-acc@finflow.test', password: PW });
    await page.evaluate(() => window.showPage('my-accountant')); await sleep(2500);
    const d = await dialog(page);
    A('B: after the same browser signs in as an accountant, the owner page shows the dialog (accountant login ' + st + ')', !!d && d.shown, JSON.stringify(d));
    await page.context().close();
  }
  // C — accountant portal, session ends
  {
    const page = await open({ width: 1280, height: 900, beforeGoto: async ctx => { await ctx.clearCookies(); } }, '/accountant-login');
    const stc = await signInAs(page.context(), '/api/accountants/login', { email: 'n318-acc@finflow.test', password: PW });
    if (stc !== 200) throw new Error('accountant login ' + stc);
    await page.goto(base + `/accountant-client?client=${uid}&name=Owner`); await sleep(2500);
    A('C: accountant workspace loads with no dialog', !(await dialog(page)));
    await page.evaluate(() => fetch('/api/accountants/logout', { method: 'POST', credentials: 'include' }));
    await page.evaluate(() => { const n = [...document.querySelectorAll('[data-on-click]')].find(e => /showSection\('messages'/.test(e.getAttribute('data-on-click'))); n && n.click(); });
    await page.evaluate(() => fetch('/api/accountants/clients/' + new URLSearchParams(location.search).get('client') + '/messages', { credentials: 'include' }));
    await sleep(1200);
    const d = await dialog(page);
    A('C: accountant portal shows the dialog after the session ended', !!d && d.shown, JSON.stringify(d));
    if (d) { await page.click('#ff-se-signin'); await page.waitForLoadState('load'); A('C: its button goes to /accountant-login', /\/accountant-login/.test(page.url()), page.url()); }
    await page.context().close();
  }
  // D — a 401 with the session intact
  {
    const page = await fresh({ width: 1280, height: 900 });
    await sleep(1200);
    const st = await page.evaluate(() => fetch('/api/auth/change-password', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'definitely-wrong', newPassword: 'Another-Long-Pass-9!' }) }).then(r => r.status));
    await sleep(600);
    A('D: wrong current password → 401, session intact → NO dialog', st === 401 && !(await dialog(page)), 'status ' + st + ' ' + JSON.stringify(await dialog(page)));
    const still = await page.evaluate(() => fetch('/api/auth/me', { credentials: 'include' }).then(r => r.status));
    A('D: …and the user is still signed in (200)', still === 200, String(still));
    await page.context().close();
  }
  // E — signed-out visitor
  {
    const page = await open({ width: 1280, height: 900, beforeGoto: async ctx => { await ctx.clearCookies(); } }, '/app');
    await sleep(2000);
    A('E: signed-out visitor on /app sees the sign-in screen and NO dialog', !!(await page.$('#ff-lp')) && !(await dialog(page)));
    await page.context().close();
  }
  void http;
});
