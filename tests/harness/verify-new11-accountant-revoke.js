'use strict';
/**
 * verify-new11-accountant-revoke — NEW-11: "Revoke access" on My Accountant must actually revoke. It used to clear the
 * card and toast "Accountant access revoked" WITHOUT any request, so the accountant kept full books access while the
 * client believed it was gone. Executed in a real browser on the real /app, with the accountant's own session hitting
 * the real books route, against a scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new11-accountant-revoke.js
 *
 * Bug values: after the click the accountant's books request still answers 200 and the link is still 'active'.
 * Failure path (Rule 14): when the server refuses, the card stays and the client is told access was NOT revoked.
 */
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');
const { HarnessHttp } = require('./httpClient.js');

runBrowser('NEW-11 — Revoke access revokes', async ({ open, A, eq, J, http, c, uid, base }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ents = await J('GET', '/api/entities');
  const PW = 'n11-acc-pw-not-a-secret';
  const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ('n11-acc@finflow.test', $1, 'Robin', 'Ledger', 'Ledger & Co', 'N11REF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
  eq('owner grants the accountant view of the business', (await http.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [ents[0].id]: 'view' }, personal: 'none' } })).status, 200);
  const ACC = new HarnessHttp(base, { xff: '203.0.113.111' });
  eq('accountant signs in', (await ACC.post('/api/accountants/login', { email: 'n11-acc@finflow.test', password: PW })).status, 200);
  eq('premise: the accountant can read the books', (await ACC.get(`/api/accountants/clients/${uid}/books?period=year`)).status, 200);

  const page = await open({ width: 1280, height: 900 });
  const toasts = [];
  await page.exposeFunction('__toast', t => toasts.push(t));
  await page.evaluate(() => { const o = window.notify; window.notify = function (m) { try { window.__toast(String(m)); } catch (_) {} return o && o.apply(this, arguments); }; window._confirmModal = async () => true; });
  const openMyAcc = async () => page.evaluate(async () => { showPage('my-accountant'); await new Promise(r => setTimeout(r, 1200)); return document.getElementById('my-acc-content').innerText.replace(/\s+/g, ' ').trim(); });
  A('the client sees the accountant linked', /Robin Ledger/.test(await openMyAcc()));

  // ── failure path first: the server refuses → nothing changes on screen, and the client is told ──────────────
  await page.route('**/api/accountants/my-accountant/revoke', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error."}' }));
  await page.evaluate(async () => { await window.revokeAccountant(); });
  await wait(400);
  const afterRefusal = await page.evaluate(() => document.getElementById('my-acc-content').innerText.replace(/\s+/g, ' ').trim());
  A('refused revoke: the accountant card stays', /Robin Ledger/.test(afterRefusal), JSON.stringify(afterRefusal) + '  (bug: cleared to "No accountant linked")');
  A('refused revoke: no "revoked" toast', !toasts.includes('Accountant access revoked'), JSON.stringify(toasts));
  await page.unroute('**/api/accountants/my-accountant/revoke');
  toasts.length = 0;

  // ── the real revoke ────────────────────────────────────────────────────────────────────────────────────────
  await page.evaluate(async () => { await window.revokeAccountant(); });
  await wait(600);
  A('the client is told access was revoked', toasts.includes('Accountant access revoked'), JSON.stringify(toasts));
  const link = (await c.query(`SELECT status FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`, [accId, uid])).rows[0];
  eq('the link is revoked in the database', link && link.status, 'revoked', 'active');
  eq('the accountant can no longer read the books', (await ACC.get(`/api/accountants/clients/${uid}/books?period=year`)).status, 403, 200);
  const clients = (await ACC.get('/api/accountants/clients')).json;
  A('the client is gone from the accountant\'s client list', Array.isArray(clients) ? !clients.some(x => Number(x.user_id || x.id) === Number(uid) && x.status === 'active') : true, JSON.stringify(clients).slice(0, 200));
  const audit = (await c.query(`SELECT count(*)::int AS n FROM audit_trail WHERE user_id = $1 AND action = 'CLIENT_REVOKE'`, [uid])).rows[0].n;
  eq('the revoke is in the client\'s audit trail', audit, 1, 0);

  // after a reload the page agrees with the server (it used to show the accountant again — the revoke never happened)
  await page.reload({ waitUntil: 'load' }); await wait(2500);
  await page.evaluate(() => { window._confirmModal = async () => true; });
  A('after a reload: no accountant linked', !/Robin Ledger/.test(await openMyAcc()));

  // a webhook-SUSPENDED link (subscription lapsed) revoked by the client must not come back on resubscription
  await c.query(`UPDATE accountant_clients SET status = 'suspended' WHERE accountant_id = $1 AND user_id = $2`, [accId, uid]);
  eq('a suspended link can be revoked too', (await http.post('/api/accountants/my-accountant/revoke', { accountantId: accId })).status, 200);
  eq('…and is revoked (reactivation only lifts "suspended")', (await c.query(`SELECT status FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`, [accId, uid])).rows[0].status, 'revoked');
  eq('revoking again: nothing to revoke (404)', (await http.post('/api/accountants/my-accountant/revoke', { accountantId: accId })).status, 404);
}, {});
