'use strict';
/**
 * verify-new13-authed-race — NEW-13: My Accountant's boot load (the accountant directory, the client's linked
 * accountant + the unread-message badge, and NEW-9's invitations) waited for the 'ff:authed' event — but that code
 * runs inside the page's 'load' handler, and sign-in usually finishes FIRST, so the event had already fired and the
 * load never ran (measured: 3 of 5 ordinary boots made no My Accountant request at all). The client saw no unread
 * badge and no invitation until they happened to open the page.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new13-authed-race.js
 *
 * Deterministic (Rule 14): a slow image (3 s) added to the document holds 'load' back until well after sign-in — the losing order every
 * time. Bug value: no request to /api/accountants/my-accountant, no badge.
 */
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');

runBrowser('NEW-13 — My Accountant loads at boot even when sign-in finishes before the page load', async ({ open, A, eq, c, uid }) => {
  const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ('n13@finflow.test', $1, 'Kai', 'Books', 'Books Co', 'N13REF', 'verified') RETURNING id`, [bcrypt.hashSync('x', 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
  await c.query(`INSERT INTO accountant_messages (accountant_id, user_id, sender, message) VALUES ($1,$2,'accountant','Please upload your statements')`, [accId, uid]);
  const page = await open({ width: 1280, height: 900, beforeGoto: async (ctx) => {
    // A slow image added to the document before 'load' holds the load event back (nothing else is slowed).
    await ctx.route('**/__n13-slow.png', async r => { await new Promise(x => setTimeout(x, 3000)); r.fulfill({ status: 404, body: '' }); });
    await ctx.addInitScript(() => {
      window.__f = []; window.__order = [];
      const of = window.fetch; window.fetch = function (u) { try { const s = String((u && u.url) || u); if (/\/api\/accountants\//.test(s)) window.__f.push(s.replace(/^.*\/api/, '/api')); } catch (_) {} return of.apply(this, arguments); };
      const od = window.dispatchEvent; window.dispatchEvent = function (e) { if (e && e.type === 'ff:authed') window.__order.push('authed'); return od.call(this, e); };
      window.addEventListener('load', () => window.__order.push('load'));
      document.addEventListener('DOMContentLoaded', () => { const i = new Image(); i.src = '/__n13-slow.png'; i.style.display = 'none'; document.body.appendChild(i); });
    });
  } });
  await new Promise(r => setTimeout(r, 5000));
  const st = await page.evaluate(() => ({ order: window.__order, f: window.__f,
    badge: (document.querySelector('.nav-item[data-on-click*="my-accountant"]') || {}).innerText || '' }));
  eq('premise: sign-in finished before the page load (the losing order)', st.order.slice(0, 2), ['authed', 'load']);
  A('My Accountant\'s linked accountant was loaded at boot', st.f.includes('/api/accountants/my-accountant'), JSON.stringify(st.f) + '  (bug: no request)');
  A('…and the invitations', st.f.includes('/api/accountants/my-accountant/invites'), JSON.stringify(st.f));
  A('the unread badge shows on the My Accountant nav item', /1\s*$/.test(st.badge), JSON.stringify(st.badge) + '  (bug: no badge)');
}, {});
