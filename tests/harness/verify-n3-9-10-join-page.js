'use strict';
/**
 * verify-n3-9-10-join-page.js — N3-9 + N3-10 (live re-audit 2026-11-11), both on the accountant sign-up page (/join).
 * Renders public/accountant-register.html in real Chromium (Playwright); every asset it asks for is served from public/
 * (and /tier-config.js from the repo root, as server.js does). Assertions are on RENDERED values (Rule 5).
 *
 * N3-9: the required Professional Conduct Policy checkbox rendered as an empty full-width text box with no tick
 *       (blanket `input { width:100%; appearance:none }`). Expected: a native checkbox ≤ 24 px wide, appearance not none,
 *       and clicking it shows it checked. Bug values: width ≈ the form width (hundreds of px), appearance 'none'.
 * N3-10: the page hardcoded its own referral ladder (Starter 1–50 → 1 month, Growth 50–500 → 3, Elite 500+ → 12, flat 4 %),
 *        while tier-config.js — what the app pays — says Bronze 1–24 → 3 months / 10 % … Elite 250+ → 12 / 2 %, first 3
 *        clients commission-free. Expected values are read from tier-config.js itself (the single source, F17), and the
 *        bug strings must be absent.
 */
const fs = require('fs'), path = require('path');
const { chromium } = (require('./browserKit.js').loadPlaywright() || (() => { throw new Error('NOT RUN — Playwright is not installed (local or global). Install once: npm i --no-save playwright && npx playwright install chromium'); })());
const ROOT = path.join(__dirname, '..', '..'), PUB = path.join(ROOT, 'public');
const T = require(path.join(ROOT, 'tier-config.js'));
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

(async () => {
  let browser;
  try {
    console.log('\n' + '='.repeat(78) + '\n  N3-9 / N3-10 — /join: a visible Conduct checkbox; the pay terms the app actually pays\n' + '='.repeat(78) + '\n');
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('http://join.test/**', route => {
      const u = new URL(route.request().url()); let p = decodeURIComponent(u.pathname);
      if (p === '/' || p === '/join') p = '/accountant-register.html';
      const f = p === '/tier-config.js' ? path.join(ROOT, 'tier-config.js') : path.join(PUB, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
    });
    await page.route(/^(?!http:\/\/join\.test)/, r => r.abort());   // nothing leaves the box
    await page.goto('http://join.test/join', { waitUntil: 'load' });
    await page.waitForTimeout(500);

    // ---- N3-10 ----
    const txt = (await page.textContent('body')).replace(/\s+/g, ' ');
    A('N3-10 old hardcoded ladder gone ("Starter — 1 to 50", "× 1 month", "4% service commission", "96% to you")',
      !/Starter — 1 to 50|Growth — 50 to 500|Elite — 500\+|transfer 96%/.test(txt) && !/^\s*4% service commission\s*$/.test(await page.textContent('#join-commission h4')),
      (txt.match(/.{0,40}(Starter — 1 to 50|transfer 96%).{0,40}/) || [])[0] || await page.textContent('#join-commission h4'));
    for (const t of T.TIERS) {
      const rng = t.max === Infinity ? t.min + '+ clients' : t.min + ' to ' + t.max + ' clients';
      const re = new RegExp(t.name + ' — ' + rng.replace('+', '\\+') + '.{0,60}paid for ' + t.referralMonths + ' months?.{0,40}' + Math.round(t.commissionRate * 100) + '% service commission');
      A('N3-10 ' + t.name + ': ' + rng + ' → ' + t.referralMonths + ' months, ' + Math.round(t.commissionRate * 100) + '% (from tier-config.js)', re.test(txt), (txt.match(new RegExp(t.name + '.{0,120}')) || ['(no ' + t.name + ' card)'])[0]);
    }
    A('N3-10 commission box: first ' + T.ONBOARDING_FREE_BELOW + ' paying clients commission-free', new RegExp('first ' + T.ONBOARDING_FREE_BELOW + ' paying clients are commission-free').test(txt), (txt.match(/Service commission.{0,200}/) || [''])[0]);

    // ---- N3-9 ---- (the box is on step 3; the CSS applies wherever it is — make it visible to measure it)
    await page.evaluate(() => window.setStep(3));   // the page's own step switch (step 3 = Pricing, where the box lives)
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => { const c = document.getElementById('conduct-accept'); const s = getComputedStyle(c), r = c.getBoundingClientRect(); return { w: r.width, h: r.height, app: s.appearance || s.webkitAppearance, type: c.type, req: c.required }; });
    A('N3-9 Conduct box is a required checkbox', m.type === 'checkbox' && m.req, JSON.stringify(m));
    A('N3-9 rendered as a checkbox: ≤ 24 px wide and appearance not "none" (bug: ~form width, appearance none)', m.w > 0 && m.w <= 24 && m.app !== 'none', JSON.stringify(m));
    await page.click('#conduct-accept', { force: true });
    const shot = await page.evaluate(() => document.getElementById('conduct-accept').checked);
    A('N3-9 clicking it checks it (state visible to the user via the native tick)', shot === true, 'checked=' + shot);
    A('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-9 / N3-10 join page)'));
  process.exit(fail ? 1 : 0);
})();
