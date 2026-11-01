#!/usr/bin/env node
'use strict';
/**
 * verify-new19-self-hosted-fonts — NEW-19 / NEW-20 (found writing the Privacy Policy, 2026-11-01): 15 pages fetched their
 * typefaces from Google Fonts, so every visitor's IP address went to Google on page load; the CSP also allowed a Yahoo
 * endpoint nothing calls. Now the fonts are served by FinFlow (/css/fonts.css, /fonts/*.woff2) and the CSP names neither.
 * Every page is LOADED in Chromium against the real server and every request it makes is recorded (Rule 3 / Rule 5).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new19-self-hosted-fonts.js
 *
 * Bug values: each page requests fonts.googleapis.com (+ fonts.gstatic.com); CSP style-src / font-src name Google and
 * connect-src names query1.finance.yahoo.com.
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PAGES = ['/', '/app', '/404.html', '/accountant-client.html', '/accountant-dashboard.html', '/accountant-login.html', '/join', '/accountants.html',
  '/admin', '/conduct.html', '/contact.html', '/privacy.html', '/security.html', '/terms.html', '/unsubscribe.html'];
(async () => {
  const s = await startScratchPostgres({ keep: false }); let server, browser;
  try {
    server = await bootServer(s.url); const base = server.baseUrl; const host = new URL(base).host;
    const csp = (await fetch(base + '/app')).headers.get('content-security-policy') || '';
    A('the CSP names no Google font host', csp && !/fonts\.googleapis|fonts\.gstatic/.test(csp), csp.slice(0, 200));
    A('the CSP no longer allows the unused Yahoo endpoint (NEW-20)', !/finance\.yahoo/.test(csp));
    A('fonts may load only from FinFlow (font-src \'self\')', /font-src 'self';/.test(csp));
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    // Outside requests are recorded and then ABORTED: the harness network has no internet, and an abort still proves the page asked.
    await ctx.route('**/*', r => (new URL(r.request().url()).host === host || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    for (const p of PAGES) {
      const page = await ctx.newPage();
      const outside = [], fontsOk = [], refused = [];
      page.on('request', rq => { const u = rq.url(); if (!u.startsWith('data:') && new URL(u).host !== host) outside.push(u); });
      page.on('response', rs => { if (/\/fonts\/[\w-]+\.woff2$/.test(rs.url()) && rs.status() === 200) fontsOk.push(rs.url()); });
      page.on('console', m => { if (/Refused to load|Content Security Policy/i.test(m.text())) refused.push(m.text().slice(0, 140)); });
      await page.goto(base + p, { waitUntil: 'load' }).catch(() => {});
      await page.waitForTimeout(700);
      const ready = await page.evaluate(async () => { await document.fonts.ready; const f = [...document.fonts]; const fam = n => f.some(x => x.family.replace(/"/g, '') === n && x.status === 'loaded');
        return { loaded: f.filter(x => x.status === 'loaded').map(x => x.family.replace(/"/g, '')).filter((v, i, a) => a.indexOf(v) === i), errored: f.filter(x => x.status === 'error').length, anyOurs: fam('Jost') || fam('Cormorant Garamond'), sheet: !!document.querySelector('link[href="/css/fonts.css"]') }; }).catch(e => ({ err: e.message }));
      A(`${p}: no request leaves FinFlow on load (bug: Google Fonts)`, outside.length === 0, outside.slice(0, 3).join(' '));
      A(`${p}: typefaces come from FinFlow (/css/fonts.css, woff2 200) and are usable`, ready.sheet && fontsOk.length > 0 && ready.anyOurs && ready.errored === 0, JSON.stringify(ready) + ' woff2:' + fontsOk.length);
      A(`${p}: no CSP refusals`, refused.length === 0, refused.join(' | '));
      await page.close();
    }
    const ct = (await fetch(base + '/fonts/jost-latin-400-normal.woff2')).headers.get('content-type');
    A('a font file is served as font/woff2', /font\/woff2/.test(ct || ''), ct);
  } finally { if (browser) await browser.close(); if (server && server.close) await server.close(); await s.stop(); }
  console.log('\n' + (fail === 0 ? `  ALL GREEN — ${pass} passed, 0 failed  (NEW-19 self-hosted fonts)` : `  ${fail} FAILED, ${pass} passed`) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('PROBE ERROR', e && e.stack); process.exit(1); });
