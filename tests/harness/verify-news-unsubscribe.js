#!/usr/bin/env node
'use strict';
/**
 * verify-news-unsubscribe — product-news emails honour unsubscribes (Privacy Policy rewrite, 2026-11). An admin broadcast
 * is a SERVICE NOTICE (to everyone) or PRODUCT NEWS (skips unsubscribed addresses; every email has a one-click unsubscribe
 * link and the RFC 8058 List-Unsubscribe headers). The links work without signing in and cannot be forged; a link
 * scanner's GET unsubscribes nobody. Sign-up shows the Terms, the Privacy Policy and the news notice.
 * Real server, real Postgres, a capturing email client at the server's seam, Chromium (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-news-unsubscribe.js
 *
 * Bug values (old code): every broadcast went to all 3 users with no unsubscribe link or header (sent 3 every time,
 * skipped undefined); /api/unsubscribe and /unsubscribe.html did not exist; the sign-up form linked neither document.
 */
process.env.ADMIN_PASSWORD = 'harness-shared-admin-pw';
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
(async () => {
  const s = await startScratchPostgres({ keep: false }); const c = s.client; let server, browser;
  try {
    server = await bootServer(s.url); const base = server.baseUrl;
    process.env.APP_URL = base;   // links in the emails point at this server (boot scrubs APP_URL; appUrl() reads it per call)
    const app = require('../../server.js');
    const sent = []; app._setResendClientForTest({ emails: { send: async m => { sent.push(m); return { id: 'fake_' + sent.length }; } } });
    for (const e of ['Ann@x.test', 'bob@x.test', 'cy@x.test'])
      await c.query(`INSERT INTO users (data, created_at, updated_at) VALUES ($1, NOW(), NOW())`, [{ email: e, plan: 'pro' }]);
    const adm = new HarnessHttp(base, { xff: '192.0.2.60' });
    A('admin signs in', (await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
    const cast = async (kind) => { sent.length = 0; const r = await adm.post('/api/admin/broadcast', Object.assign({ audience: 'all_users', subject: 'S-' + kind, message: 'Hello' }, kind ? { kind } : {})); return { r: r.json || {}, mails: sent.slice() }; };

    const n1 = await cast('news');
    A('product news goes to all 3 before anyone unsubscribes', n1.r.sent === 3 && n1.r.skipped === 0, JSON.stringify(n1.r));
    const ann = n1.mails.find(m => m.to === 'ann@x.test') || {};
    const lu = ((ann.headers || {})['List-Unsubscribe'] || '').replace(/^<|>$/g, '');
    A('each news email carries List-Unsubscribe + List-Unsubscribe-Post (one-click)', /\/api\/unsubscribe\?e=ann%40x\.test&t=/.test(lu) && (ann.headers || {})['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', JSON.stringify(ann.headers));
    const link = ((ann.html || '').match(/href="([^"]*unsubscribe\.html[^"]*)"/) || [])[1] || '';
    A('…and a visible one-click unsubscribe link in the body', /\/unsubscribe\.html\?e=ann%40x\.test&t=/.test(link), link);

    const anon = new HarnessHttp(base, { xff: '192.0.2.61' });
    const path = lu.replace(base, '');
    await anon.get(path);
    A('a link scanner that only GETs the URL unsubscribes nobody', (await c.query(`SELECT count(*)::int n FROM email_optouts`)).rows[0].n === 0);
    const forged = await anon.post(path.replace('ann%40x.test', 'bob%40x.test'), { 'List-Unsubscribe': 'One-Click' });
    A('the same token for someone else\'s address is refused (400 BAD_LINK)', forged.status === 400 && forged.json.code === 'BAD_LINK', forged.status + ' ' + JSON.stringify(forged.json));
    const one = await anon.post(path, { 'List-Unsubscribe': 'One-Click' });
    A('the mail app\'s one-click POST unsubscribes Ann', one.status === 200 && one.json.subscribed === false && (await c.query(`SELECT email FROM email_optouts`)).rows.map(r => r.email).join() === 'ann@x.test', JSON.stringify(one.json));

    const n2 = await cast('news');
    A('the next product news skips Ann: sent 2, skipped 1 (bug: 3, undefined)', n2.r.sent === 2 && n2.r.skipped === 1 && !n2.mails.some(m => m.to === 'ann@x.test'), JSON.stringify(n2.r));
    const nk = await cast(null);
    A('a broadcast with no type is treated as news (skips Ann)', nk.r.kind === 'news' && nk.r.sent === 2, JSON.stringify(nk.r));
    const sv = await cast('service');
    const svAnn = sv.mails.find(m => m.to === 'ann@x.test') || {};
    A('a service notice still reaches everyone, Ann included', sv.r.sent === 3 && !!svAnn.to, JSON.stringify(sv.r));
    A('…with no unsubscribe header, and says it is a service notice', !svAnn.headers && /service notice about your FinFlow account/.test(svAnn.html || ''));
    const lg = (await c.query(`SELECT notes, after_data FROM admin_log WHERE action = 'broadcast' ORDER BY id`)).rows;
    A('the admin log records the type and how many were skipped', /^news · all_users \(sent 2\/2, 0 failed, 1 unsubscribed skipped\)/.test(lg[1].notes) && lg[3].after_data.kind === 'service', lg.map(r => r.notes).join(' | '));

    // ── the pages ──
    const { chromium } = (require('./browserKit.js').loadPlaywright() || (() => { throw new Error('NOT RUN — Playwright is not installed (local or global). Install once: npm i --no-save playwright && npx playwright install chromium'); })());
    browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const bobLink = (n1.mails.find(m => m.to === 'bob@x.test').html.match(/href="([^"]*unsubscribe\.html[^"]*)"/) || [])[1].replace(/&amp;/g, '&');
    await page.goto(bobLink); await page.waitForTimeout(800);
    A('opening the link in the email unsubscribes and says so', /bob@x\.test is unsubscribed/.test(await page.textContent('#un-text')) && (await c.query(`SELECT 1 FROM email_optouts WHERE email='bob@x.test'`)).rowCount === 1);
    await page.click('#un-btn'); await page.waitForTimeout(600);
    A('"Undo" puts Bob back on the list', /will get FinFlow product news again/.test(await page.textContent('#un-text')) && (await c.query(`SELECT 1 FROM email_optouts WHERE email='bob@x.test'`)).rowCount === 0);
    await page.goto(base + '/app'); await page.waitForTimeout(1200);
    const legal = await page.evaluate(() => { const el = document.getElementById('register-legal'); return el ? { t: el.textContent.replace(/\s+/g, ' '), terms: !!el.querySelector('a[href="/terms.html"]'), priv: !!el.querySelector('a[href="/privacy.html"]') } : null; });
    A('the sign-up form links the Terms and the Privacy Policy and mentions news emails', legal && legal.terms && legal.priv && /unsubscribe in one click/.test(legal.t), JSON.stringify(legal));
    const join = String((await anon.get('/join')).text || '');
    A('the accountant sign-up links the Privacy Policy too', /By registering you agree to the <a href="\/terms\.html"[^>]*>Terms of Service<\/a> and the <a href="\/privacy\.html"/.test(join));
    A('no page errors', errs.length === 0, errs.join(' | '));
  } finally { if (browser) await browser.close(); if (server && server.close) await server.close(); await s.stop(); }
  console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (news unsubscribe)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR', e && e.stack); process.exit(1); });
