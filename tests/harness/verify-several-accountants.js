'use strict';
/**
 * verify-several-accountants — owner decision 2026-11-01: a client may work with SEVERAL accountants (a bookkeeper and a
 * tax accountant, say). Each is listed in My Accountant with its own access, chat, activity and revoke — none hidden
 * (the NEW-12 defect: a second link hid the first's live access). Replaces NEW-12's "one at a time" guard.
 * Real server, real /app in a browser, accountants' own sessions, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-several-accountants.js
 *
 * Bug values (the one-at-a-time code): the second request 409; (the original NEW-12 code): My Accountant shows one.
 */
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');
const { HarnessHttp } = require('./httpClient.js');

runBrowser('Several accountants per client — each visible, each with its own access', async ({ open, A, eq, J, http, c, uid, base }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  eq('the one-accountant index is gone', (await c.query(`SELECT count(*)::int n FROM pg_indexes WHERE indexname = 'idx_acc_clients_one_active'`)).rows[0].n, 0, 1);
  const e1 = (await J('GET', '/api/entities'))[0];
  const e2 = await J('POST', '/api/entities', { name: 'Second Co', currency: 'USD', country: 'US', timezone: 'UTC' });
  const PW = 'sev-pw-not-a-secret';
  const mk = async (email, first) => (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ($1,$2,$3,'Acct',$4,$5,'verified') RETURNING id`, [email, bcrypt.hashSync(PW, 10), first, first + ' Books', 'SEV' + first.toUpperCase()])).rows[0].id;
  const accA = await mk('sev-a@finflow.test', 'Avery'), accB = await mk('sev-b@finflow.test', 'Blake');
  const AA = new HarnessHttp(base, { xff: '203.0.113.171' }), AB = new HarnessHttp(base, { xff: '203.0.113.172' });
  eq('A signs in', (await AA.post('/api/accountants/login', { email: 'sev-a@finflow.test', password: PW })).status, 200);
  eq('B signs in', (await AB.post('/api/accountants/login', { email: 'sev-b@finflow.test', password: PW })).status, 200);

  eq('client asks A (bookkeeper)', (await http.post('/api/accountants/request-access', { accountantId: accA })).status, 200);
  eq('A approves', (await AA.post('/api/accountants/approve-request', { userId: uid })).status, 200);
  eq('client grants A business 1 (one accountant: no accountantId needed)', (await http.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [e1.id]: 'filing' }, personal: 'none' } })).status, 200);
  eq('client ALSO asks B (tax accountant)', (await http.post('/api/accountants/request-access', { accountantId: accB })).status, 200, 409);
  eq('B approves', (await AB.post('/api/accountants/approve-request', { userId: uid })).status, 200, 409);
  const my = (await http.get('/api/accountants/my-accountant')).json || {};
  eq('My Accountant lists BOTH', (my.accountants || []).map(a => a.first_name).sort(), ['Avery', 'Blake'], ['Blake']);

  const noWho = await http.put('/api/accountants/my-accountant/access', { entity_access: { entities: { [e2.id]: 'view' }, personal: 'none' } });
  eq('with two, an access change must say which accountant (400 WHICH_ACCOUNTANT)', [noWho.status, (noWho.json || {}).code], [400, 'WHICH_ACCOUNTANT']);
  eq('grant B business 2 (view) by name', (await http.put('/api/accountants/my-accountant/access?accountantId=' + accB, { entity_access: { entities: { [e2.id]: 'view' }, personal: 'none' } })).status, 200);
  const ea = async id => (await c.query(`SELECT entity_access FROM accountant_clients WHERE accountant_id = $1 AND user_id = $2`, [id, uid])).rows[0].entity_access;
  eq('A keeps its own grant (business 1, filing)', await ea(accA), { entities: { [e1.id]: 'filing' }, personal: 'none' });
  eq('B has its own (business 2, view)', await ea(accB), { entities: { [e2.id]: 'view' }, personal: 'none' });
  const ents = async (h) => (((await h.get(`/api/accountants/clients/${uid}/books?period=year`)).json || {}).entities || []).map(x => x.id);
  eq('A sees business 1 only', await ents(AA), [e1.id]);
  eq('B sees business 2 only', await ents(AB), [e2.id]);

  // chat is per accountant
  eq('client messages B', (await http.post('/api/accountants/my-accountant/messages?accountantId=' + accB, { content: 'For Blake only' })).status, 200);
  const msgsA = ((await http.get('/api/accountants/my-accountant/messages?accountantId=' + accA)).json || {}).messages || [];
  const msgsB = ((await http.get('/api/accountants/my-accountant/messages?accountantId=' + accB)).json || {}).messages || [];
  eq('the message is in B\'s thread, not A\'s', [msgsA.length, msgsB.map(m => m.content)], [0, ['For Blake only']]);

  // the page
  const page = await open({ width: 1280, height: 900 });
  await page.evaluate(() => { window._confirmModal = async () => true; });
  const ui = await page.evaluate(async (b) => {
    showPage('my-accountant'); await new Promise(r => setTimeout(r, 1500));
    const list = document.getElementById('my-acc-list');
    const btns = list ? [...list.querySelectorAll('button')].map(x => x.innerText) : [];
    window.selectAccountant(b); await new Promise(r => setTimeout(r, 800));
    return { btns, card: document.getElementById('my-acc-content').innerText.replace(/\s+/g, ' ') };
  }, accB);
  A('the page lists both accountants', ui.btns.length === 2 && ui.btns.some(t => /Avery/.test(t)) && ui.btns.some(t => /Blake/.test(t)), JSON.stringify(ui.btns));
  A('choosing B opens B', /Blake Acct/.test(ui.card), ui.card.slice(0, 200));

  // revoking one leaves the other
  const after = await page.evaluate(async (a) => {
    window.selectAccountant(a); await new Promise(r => setTimeout(r, 500));
    await window.revokeAccountant(); await new Promise(r => setTimeout(r, 800));
    return document.getElementById('my-acc-content').innerText.replace(/\s+/g, ' ');
  }, accA);
  A('after revoking A, B is still shown', /Blake Acct/.test(after), after.slice(0, 200));
  eq('A is refused; B still reads its business', [(await AA.get(`/api/accountants/clients/${uid}/books?period=year`)).status, await ents(AB)], [403, [e2.id]]);
  await wait(50);
}, {});
