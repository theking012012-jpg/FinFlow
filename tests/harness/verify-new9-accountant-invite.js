'use strict';
/**
 * verify-new9-accountant-invite — NEW-9 (owner decision 2026-11-01): an accountant's invitation to an EXISTING FinFlow
 * user becomes an in-app request the client approves with a chosen scope. It used to be a sign-up e-mail only — an
 * existing user had no way to accept it, and with e-mail down the accountant got a 502 and nothing at all.
 * Real browser on the real /app (client) and the accountant's own session, real server, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new9-accountant-invite.js
 *
 * Each promised property is executed:
 *   no enumeration (identical answer for an address with and without an account) · the client sees the request in My
 *   Accountant · approves with chosen businesses + level + end date · personal is never granted · the accountant sees
 *   only the chosen business · an end date ends access by itself · decline · one pending per address · 25 a day · a
 *   request expires · an accountant suspended since inviting cannot be accepted · one accountant at a time · a person who
 *   signs up later with the address sees it · the activity list shows what the accountant did · the e-mail's deep link.
 * Bug values (old code): the client's invitation list does not exist (404); the invite answers 503 with nothing saved.
 */
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');
const { HarnessHttp } = require('./httpClient.js');

runBrowser('NEW-9 — accountant invitation → in-app request the client approves', async ({ open, A, eq, J, http, c, uid, base }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  eq('pinned clock: 2026-07-25', new Date().toISOString().slice(0, 10), '2026-07-25');
  const OWNER = 'layout-owner@finflow.test';
  const e1 = (await J('GET', '/api/entities'))[0];
  const e2 = await J('POST', '/api/entities', { name: 'Second Co', currency: 'USD', country: 'US', timezone: 'UTC' });
  await J('PUT', '/api/settings', { personal_timezone: 'America/New_York' });
  const PW = 'n9-acc-pw-not-a-secret';
  const mkAcc = async (email, first) => (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, country, specialisation)
    VALUES ($1, $2, $3, 'Ledger', $4, $5, 'verified', 'United States', 'Bookkeeping') RETURNING id`, [email, bcrypt.hashSync(PW, 10), first, first + ' & Co', 'N9' + first.toUpperCase()])).rows[0].id;
  const accA = await mkAcc('n9-a@finflow.test', 'Robin'), accB = await mkAcc('n9-b@finflow.test', 'Sasha');
  const AA = new HarnessHttp(base, { xff: '203.0.113.91' }), AB = new HarnessHttp(base, { xff: '203.0.113.92' });
  eq('accountant A signs in', (await AA.post('/api/accountants/login', { email: 'n9-a@finflow.test', password: PW })).status, 200);
  eq('accountant B signs in', (await AB.post('/api/accountants/login', { email: 'n9-b@finflow.test', password: PW })).status, 200);

  // ── no enumeration: an address WITH an account and one WITHOUT get the same answer ─────────────────────────────
  const rExisting = await AA.post('/api/accountants/invite', { email: OWNER.toUpperCase(), name: 'Layout' });
  const rNew = await AA.post('/api/accountants/invite', { email: 'nobody-yet@finflow.test', name: 'Layout' });
  const norm = r => JSON.stringify({ s: r.status, b: JSON.stringify(r.json).replace(/layout-owner@finflow\.test|nobody-yet@finflow\.test/gi, '<email>') });
  eq('invite answers 200 (the invitation is saved even with no e-mail service)', rExisting.status, 200, 503);
  A('NO ENUMERATION: identical answer for an address with an account and one without', norm(rExisting) === norm(rNew), norm(rExisting) + ' vs ' + norm(rNew));
  A('…and it says the e-mail did not go (this server has none) — honest, without saying who exists', rExisting.json && rExisting.json.emailSent === false && /saved/.test(rExisting.json.message || ''), JSON.stringify(rExisting.json));
  const listA = ((await AA.get('/api/accountants/invites')).json || []).map(x => [x.email, x.status]).sort();
  eq('the accountant\'s list shows "pending" for both (no difference)', listA, [['layout-owner@finflow.test', 'pending'], ['nobody-yet@finflow.test', 'pending']]);
  await AA.post('/api/accountants/invite', { email: OWNER, name: 'Layout again' });
  eq('one pending invitation per address (inviting again adds none)', (await c.query(`SELECT count(*)::int n FROM accountant_invites WHERE accountant_id = $1 AND email = $2`, [accA, OWNER])).rows[0].n, 1);

  // ── the client sees it ─────────────────────────────────────────────────────────────────────────────────────────
  const inv = await http.get('/api/accountants/my-accountant/invites');
  eq('the client has an invitation list', inv.status, 200, 404);
  eq('…with accountant A, verified', (inv.json || []).map(x => [x.first_name, x.firm, x.verified]), [['Robin', 'Robin & Co', true]]);

  const page = await open({ width: 1280, height: 900 }, '/app?page=my-accountant');
  const toasts = [];
  await page.exposeFunction('__toast', t => toasts.push(t));
  await page.evaluate(() => { const o = window.notify; window.notify = function (m) { try { window.__toast(String(m)); } catch (_) {} return o && o.apply(this, arguments); }; });
  await wait(1500);
  const deep = await page.evaluate(() => document.getElementById('page-my-accountant')?.classList.contains('active'));
  A('the e-mail\'s link (/app?page=my-accountant) opens My Accountant', deep === true);
  const card = await page.evaluate(async () => { showPage('my-accountant'); await window.loadAccountantInvites(); await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('my-acc-invites'); return { shown: box.style.display !== 'none', text: box.innerText.replace(/\s+/g, ' '), ents: [...box.querySelectorAll('input[data-inv-ent]')].map(x => x.getAttribute('data-inv-ent')) }; });
  A('the invitation card is on My Accountant', card.shown && /Robin Ledger/.test(card.text) && /Verified by FinFlow/.test(card.text), card.text.slice(0, 200));
  A('…and says personal finances are never part of it', /personal finances are never part of this/.test(card.text));
  eq('…offering each of the client\'s businesses', card.ents.sort(), [String(e1.id), String(e2.id)].sort());

  // approving with nothing ticked is refused on the page and at the server
  await page.evaluate(async (id) => { await window.respondAccountantInvite(id, true, null); }, inv.json[0].id);
  A('approve with no business ticked: told to tick one', toasts.some(t => /Tick at least one business/.test(t)), JSON.stringify(toasts));
  eq('server: no business → 400 NO_BUSINESS', ((await http.post(`/api/accountants/my-accountant/invites/${inv.json[0].id}/accept`, { entity_access: { entities: {} } })).json || {}).code, 'NO_BUSINESS');
  eq('server: an end date in the past → 400', (await http.post(`/api/accountants/my-accountant/invites/${inv.json[0].id}/accept`, { entity_access: { entities: { [e1.id]: 'view' } }, access_until: '2026-07-24' })).status, 400);

  // approve on the page: business 1 view, end date 15 Aug (the client's New York day)
  toasts.length = 0;
  await page.evaluate(async ({ id, e1 }) => {
    document.querySelector(`input[data-inv-ent="${e1}"][data-inv-id="${id}"]`).checked = true;
    document.querySelector(`select[data-inv-lvl="${e1}"][data-inv-id="${id}"]`).value = 'view';
    document.querySelector(`input[data-inv-until="${id}"]`).value = '2026-08-15';
    await window.respondAccountantInvite(id, true, null); await new Promise(r => setTimeout(r, 800));
  }, { id: inv.json[0].id, e1: e1.id });
  A('approved: the client is told', toasts.some(t => /Access approved/.test(t)), JSON.stringify(toasts));
  const link = (await c.query(`SELECT status, entity_access, access_expires_at, requested_by FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`, [accA, uid])).rows[0];
  eq('the link is active, from the invitation', link && [link.status, link.requested_by], ['active', 'invite']);
  eq('scope = business 1 view, NOT business 2, personal none', link && link.entity_access, { entities: { [e1.id]: 'view' }, personal: 'none' });
  eq('access ends at the end of 15 Aug in New York (= 16 Aug 04:00 UTC)', link && new Date(link.access_expires_at).toISOString(), '2026-08-16T04:00:00.000Z');
  const shown = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 600)); return (document.getElementById('acc-perm-until') || {}).innerText || ''; });
  A('My Accountant shows when access ends', /Aug 15, 2026|15 Aug 2026/.test(shown), JSON.stringify(shown));
  eq('the accountant\'s list: accepted', ((await AA.get('/api/accountants/invites')).json || []).filter(x => x.email === OWNER).map(x => x.status), ['accepted']);

  // the accountant sees only the chosen business
  const books = await AA.get(`/api/accountants/clients/${uid}/books?period=year`);
  eq('the accountant reads the books', books.status, 200);
  eq('…and sees only business 1', ((books.json || {}).entities || []).map(x => x.id), [e1.id]);
  await AA.get(`/api/accountants/clients/${uid}/books?period=year`);
  const act = (await http.get('/api/accountants/my-accountant/activity')).json || [];
  eq('activity: the client sees the accountant opened the books — once, not once per refresh', act.filter(x => x.action === 'BOOKS_VIEWED').length, 1);
  const actUi = await page.evaluate(async () => { await window.loadAccountantActivity(); return document.getElementById('my-acc-activity-list').innerText; });
  A('…shown on My Accountant as "Opened your books"', /Opened your books/.test(actUi), JSON.stringify(actUi));

  // one accountant at a time: B's invitation cannot be accepted while A has access
  await AB.post('/api/accountants/invite', { email: OWNER });
  const invB = ((await http.get('/api/accountants/my-accountant/invites')).json || []).find(x => x.first_name === 'Sasha');
  const accB409 = await http.post(`/api/accountants/my-accountant/invites/${invB.id}/accept`, { entity_access: { entities: { [e1.id]: 'view' } } });
  eq('accepting a second accountant while A has access → 409 ONE_ACCOUNTANT', [accB409.status, (accB409.json || {}).code], [409, 'ONE_ACCOUNTANT']);
  A('…naming A', /Robin Ledger/.test((accB409.json || {}).error || ''), JSON.stringify(accB409.json));
  // decline B
  eq('the client declines B', (await http.post(`/api/accountants/my-accountant/invites/${invB.id}/decline`, {})).status, 200);
  eq('B\'s list: declined', ((await AB.get('/api/accountants/invites')).json || []).map(x => x.status), ['declined']);
  eq('B has no link', (await c.query(`SELECT count(*)::int n FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`, [accB, uid])).rows[0].n, 0);

  // the end date ends access by itself (move it into the past; the next accountant request sweeps it)
  await c.query(`UPDATE accountant_clients SET access_expires_at = $3 WHERE accountant_id = $1 AND user_id = $2`, [accA, uid, new Date(Date.now() - 60000)]);
  eq('past the end date the accountant is refused', (await AA.get(`/api/accountants/clients/${uid}/books?period=year`)).status, 403);
  eq('…the link reads "expired"', (await c.query(`SELECT status FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`, [accA, uid])).rows[0].status, 'expired');
  eq('…and the client\'s audit trail records it', (await c.query(`SELECT count(*)::int n FROM audit_trail WHERE user_id = $1 AND action = 'ACCESS_EXPIRED'`, [uid])).rows[0].n, 1);

  // a request expires after 14 days; an accountant suspended since inviting cannot be accepted
  await AA.post('/api/accountants/invite', { email: OWNER });
  const inv2 = ((await http.get('/api/accountants/my-accountant/invites')).json || []).find(x => x.first_name === 'Robin');
  A('A can invite again after the link expired', !!inv2);
  await c.query(`UPDATE accountant_invites SET expires_at = $2 WHERE id = $1`, [inv2.id, new Date(Date.now() - 1000)]);
  eq('an expired invitation is not shown', ((await http.get('/api/accountants/my-accountant/invites')).json || []).length, 0);
  eq('…and cannot be accepted (404)', (await http.post(`/api/accountants/my-accountant/invites/${inv2.id}/accept`, { entity_access: { entities: { [e1.id]: 'view' } } })).status, 404);
  eq('the accountant\'s list shows it as expired', ((await AA.get('/api/accountants/invites')).json || []).find(x => x.id === inv2.id).status, 'expired');
  await c.query(`UPDATE accountant_invites SET expires_at = $2 WHERE id = $1`, [inv2.id, new Date(Date.now() + 86400000)]);
  await c.query(`UPDATE accountants SET status = 'suspended' WHERE id = $1`, [accA]);
  eq('an accountant suspended since inviting: the invitation is hidden', ((await http.get('/api/accountants/my-accountant/invites')).json || []).length, 0);
  eq('…and cannot be accepted (404)', (await http.post(`/api/accountants/my-accountant/invites/${inv2.id}/accept`, { entity_access: { entities: { [e1.id]: 'view' } } })).status, 404);
  await c.query(`UPDATE accountants SET status = 'verified' WHERE id = $1`, [accA]);

  // personal is never granted through an invitation, whatever is sent
  const acc2 = await http.post(`/api/accountants/my-accountant/invites/${inv2.id}/accept`, { entity_access: { entities: { [e2.id]: 'filing' }, personal: 'filing' } });
  eq('accept with "personal: filing" in the body', acc2.status, 200);
  eq('…personal stays none; business 2 at filing', (await c.query(`SELECT entity_access FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`, [accA, uid])).rows[0].entity_access, { entities: { [e2.id]: 'filing' }, personal: 'none' });

  // a person who signs up later with the invited address sees the invitation
  const NEWPW = 'n9-new-user-pw-1!A';
  const U2 = new HarnessHttp(base, { xff: '203.0.113.93' });
  const reg = await U2.post('/api/auth/register', { email: 'nobody-yet@finflow.test', password: NEWPW, name: 'New Person' });
  A('the invited address signs up', reg.status === 200 || reg.status === 201, reg.status + ' ' + String(reg.text).slice(0, 160));
  eq('…and sees accountant A\'s invitation', ((await U2.get('/api/accountants/my-accountant/invites')).json || []).map(x => x.first_name), ['Robin']);

  // 25 invitations a day
  for (let i = 0; i < 25; i++) await c.query(`INSERT INTO accountant_invites (accountant_id, email, expires_at, status) VALUES ($1, $2, $3, 'declined')`, [accB, `bulk${i}@x.test`, new Date(Date.now() + 86400000)]);
  const lim = await AB.post('/api/accountants/invite', { email: 'one-more@x.test' });
  eq('the 26th invitation in a day → 429 INVITE_LIMIT', [lim.status, (lim.json || {}).code], [429, 'INVITE_LIMIT']);

  // the accountant dashboard lists the invitations
  const accPage = await (async () => {
    const { chromium } = require('playwright'); const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const host = new URL(base).hostname; await ctx.addCookies([...AA.cookies.entries()].map(([name, value]) => ({ name, value, domain: host, path: '/' })));
    const p = await ctx.newPage(); await p.goto(base + '/accountant', { waitUntil: 'load' }); await wait(2500);
    const t = await p.evaluate(async () => { showPage('invite'); await new Promise(r => setTimeout(r, 1200)); return document.getElementById('invites-body').innerText; });
    await b.close(); return t;
  })();
  A('the accountant dashboard lists sent invitations with their status', /nobody-yet@finflow\.test/.test(accPage) && /Waiting · expires/.test(accPage) && /Accepted/.test(accPage), JSON.stringify(accPage).slice(0, 300));
}, {});
