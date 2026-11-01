'use strict';
/**
 * verify-fal5-contact-no-claims — FA-L §5 / LR29 (owner decisions 2026-11-01: no company name, no address and no contact
 * email on the public pages; the company is not registered yet). The landing named "FinFlow Inc.", pointed its
 * canonical / social links at finflow.io (a domain FinFlow does not serve) and sent every "contact" to mail addresses
 * nobody reads; the app did the same, and someone whose trial had ended got 402 TRIAL_EXPIRED from the support form the
 * trial-ended screen pointed to. Now: a public contact form (no account needed — also how a person who DELETED their
 * account makes a privacy request) that lands in the admin inbox, and in-app support that works after a trial ends.
 * Real server, real /, /contact.html and /app in Chromium, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fal5-contact-no-claims.js
 *
 * Bug values: canonical https://finflow.io/ · 8 finflow.io links · "FinFlow Inc." in the footer · 3 mailto links on the landing ·
 * /api/contact 404 · expired-trial POST /api/support 402 · the trial-ended screen links mailto:support@finflow.app.
 */
process.env.ADMIN_PASSWORD = 'harness-shared-admin-pw';
const { runBrowser } = require('./browserKit.js');
const { HarnessHttp } = require('./httpClient.js');

runBrowser('FA-L §5 — no invented company or dead contact addresses; a contact route that works for everyone', async ({ open, A, eq, http, c, uid, base }) => {
  const anon = (n) => new HarnessHttp(base, { xff: '192.0.2.' + n });
  process.env.APP_URL = 'https://books.example.test';   // after boot (boot.js scrubs APP_URL); appUrl() reads it per request

  // ── the landing, as served ──
  const land = await anon(1).get('/');
  const html = String(land.text || '');
  const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  eq('canonical link is the real public origin (APP_URL)', canon, 'https://books.example.test/', 'https://finflow.io/');
  eq('no social-card link to finflow.io', (html.match(/finflow\.io/g) || []).length, 0, 8);
  eq('no "FinFlow Inc." (no company is registered)', /FinFlow Inc/.test(html), false, true);
  eq('no mailto: links on the landing', (html.match(/mailto:/g) || []).length, 0, 3);
  eq('Contact / Enterprise / Talk to us go to the contact form', (html.match(/href="\/contact\.html[^"]*"/g) || []).length, 3, 0);
  for (const pg of ['/accountants.html', '/conduct.html']) {
    const t = String((await anon(2).get(pg)).text || '');
    A(pg + ': no mailto, no "FinFlow Inc."', !/mailto:|FinFlow Inc/.test(t), (t.match(/.{40}(mailto:|FinFlow Inc).{40}/) || [''])[0]);
  }

  // ── the public contact endpoint ──
  const v = anon(3);
  const ok = await v.post('/api/contact', { topic: 'privacy', name: 'Rhea Visitor', email: 'Rhea@Example.test', message: 'Please delete everything you hold about me.' });
  eq('a visitor (no account) can send a privacy request', [ok.status, (ok.json || {}).topic], [200, 'privacy'], [404, undefined]);
  const row = (await c.query(`SELECT user_id, data FROM support_requests WHERE data->>'actor' = 'visitor' ORDER BY id DESC LIMIT 1`)).rows[0] || { data: {} };
  eq('it is stored as a visitor ticket with the reply address', [row.user_id, row.data.email, row.data.name, row.data.category], [null, 'rhea@example.test', 'Rhea Visitor', 'privacy']);
  const days = row.data.legal_due ? Math.round((new Date(row.data.legal_due) - Date.now()) / 86400000) : null;
  eq('a privacy request carries a 30-day legal reply-by', days, 30);
  const n0 = (await c.query(`SELECT count(*)::int n FROM support_requests`)).rows[0].n;
  eq('the hidden honeypot field: answered OK, nothing stored', [(await anon(4).post('/api/contact', { email: 'bot@x.test', message: 'buy cheap things now', website: 'http://spam' })).status,
    (await c.query(`SELECT count(*)::int n FROM support_requests`)).rows[0].n], [200, n0]);
  eq('no reply address → 400 EMAIL', ((await anon(5).post('/api/contact', { email: 'nope', message: 'a real question here' })).json || {}).code, 'EMAIL');
  const flood = anon(6); let last;
  for (let i = 0; i < 6; i++) last = await flood.post('/api/contact', { email: 'f@x.test', message: 'message number ' + i });
  eq('a sixth message within the hour from one address is refused (429)', last.status, 429);

  // ── the admin inbox shows it ──
  const adm = anon(7);
  eq('admin signs in', (await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status, 200);
  const inbox = ((await adm.get('/api/admin/support?actor=visitor')).json || {}).requests || [];
  const t = inbox.find(x => x.email === 'rhea@example.test') || {};
  eq('the admin inbox lists it under "Contact form" with the name and legal reply-by', [t.actor, t.name, !!t.legalDue], ['visitor', 'Rhea Visitor', true]);

  // ── an expired trial can still ask for help (and still cannot write) ──
  await c.query(`UPDATE users SET data = data || $2 WHERE id = $1`, [uid, { plan: 'trial', trial_ends: new Date(Date.now() - 86400000).toISOString() }]);
  const sup = await http.post('/api/support', { subject: 'Upgrade question', message: 'How do I upgrade after my trial?' });
  eq('expired trial: the in-app support form works (201 Created)', sup.status, 201, 402);
  eq('expired trial: a write is still refused (402)', (await http.post('/api/customers', { name: 'Should Fail Co' })).status, 402);

  // ── the pages ──
  const page = await open({ width: 1280, height: 900 }, '/app');
  await page.waitForTimeout(1500);
  const gate = await page.evaluate(async () => {
    window._ffShowTrialExpired('Your free trial has ended.');
    const g = document.getElementById('ff-trial-gate-title'); const box = g && g.parentElement;
    const txt = box ? box.innerHTML : '';
    const link = document.getElementById('ff-trial-help');
    if (link) link.click();
    await new Promise(r => setTimeout(r, 1200));
    const help = document.getElementById('page-help');
    return { mailto: /mailto:/.test(txt), hasLink: !!link, helpActive: !!(help && help.classList.contains('active')), subj: !!document.getElementById('hc-subject'),
      helpMail: /mailto:|support@finflow/.test((document.getElementById('help-contact') || {}).innerHTML || '') };
  });
  eq('trial-ended screen: "Contact support" opens in-app support, no mail address', gate, { mailto: false, hasLink: true, helpActive: true, subj: true, helpMail: false },
    { mailto: true, hasLink: false, helpActive: false, subj: false, helpMail: true });

  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '/contact.html?topic=security', { waitUntil: 'load' });
  eq('the contact page pre-selects the topic from the link', await page.inputValue('#cf-topic'), 'security');
  await page.selectOption('#cf-topic', 'privacy');
  A('choosing "Privacy request" says it is answered within 30 days', /within 30 days/.test(await page.textContent('#cf-note')));
  await page.fill('#cf-name', 'Page Visitor'); await page.fill('#cf-email', 'page@example.test'); await page.fill('#cf-message', 'Sent from the contact page itself.');
  await page.click('#cf-send'); await page.waitForTimeout(1000);
  A('sending from the page confirms where the reply goes', /Sent\. We will reply to page@example\.test/.test(await page.textContent('#cf-msg')), await page.textContent('#cf-msg'));
  eq('…and the ticket is in the inbox', (await c.query(`SELECT count(*)::int n FROM support_requests WHERE data->>'email' = 'page@example.test'`)).rows[0].n, 1);
  eq('no page errors on the contact page', errs, []);
}, {});
