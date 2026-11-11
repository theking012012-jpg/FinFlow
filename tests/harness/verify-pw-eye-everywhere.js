'use strict';
/**
 * verify-pw-eye-everywhere.js — owner request 2026-11-11: "the eye to show the password needs to be fixed across the app".
 * Before: no eye on the sign-in gate, accountant sign-in / sign-up, admin, reset-password, team invite, Settings; the
 * legacy in-app login modal had two eyes wired to ffPwToggle, which was never defined (a click threw).
 *
 * Executed in Chromium (browserKit, real server) on every page that has a password field. For EVERY
 * <input type="password"> on the page (hidden ones included — they become visible on a later step):
 *   · an eye button (aria-label "Show password") sits with it;
 * and for every VISIBLE one, the eye is clicked for real (mouse):
 *   · the field becomes type="text" and the button says "Hide password" (aria-pressed true); click again → password.
 * No page errors, no CSP violations.
 * BUG VALUES: fields without an eye; on /app's modal, a click that throws "ffPwToggle is not defined".
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('Show/hide password on every password field', async ({ open, A }) => {
  const loggedOut = { beforeGoto: async ctx => { await ctx.clearCookies(); } };
  const pages = [
    ['/app (signed out — sign-in gate)', '/app', loggedOut],
    ['/accountant-login', '/accountant-login', loggedOut],
    ['/accountant-register', '/accountant-register.html', loggedOut],
    ['/admin', '/admin', loggedOut],
    ['/reset-password', '/reset-password.html?token=x', loggedOut],
    ['/team-accept', '/team-accept.html?token=x', loggedOut],
    ['/app (signed in — Settings + modals)', '/app', {}],
  ];
  for (const [label, url, extra] of pages) {
    const page = await open({ width: 1280, height: 900, ...extra }, url);
    const errs = [], csp = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
    if (/signed in/.test(label)) { await page.evaluate(() => { try { window.showPage('settings'); } catch (_) {} }); await page.waitForTimeout(800); }
    await page.waitForTimeout(600);
    const fields = await page.evaluate(() => [...document.querySelectorAll('input[type="password"], input.__was_pw')].map(i => {
      const holder = i.parentElement; const eye = holder && holder.querySelector('button[aria-label="Show password"], button[aria-label="Hide password"]');
      try { i.scrollIntoView({ block: 'center' }); } catch (_) {}
      const r = i.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const top = (r.width && r.height && cy > 0 && cy < innerHeight) ? document.elementFromPoint(cx, cy) : null;
      return { id: i.id || i.name || '(no id)', eye: !!eye, visible: !!(top && (top === i || holder.contains(top))) };   // on screen AND not under an overlay
    }));
    A(`${label}: has password fields (${fields.length})`, fields.length > 0, JSON.stringify(fields));
    const missing = fields.filter(f => !f.eye).map(f => f.id);
    A(`${label}: every password field has an eye (bug: none)`, missing.length === 0, 'no eye: ' + JSON.stringify(missing));
    for (const f of fields.filter(x => x.visible && x.eye && x.id !== '(no id)')) {
      const sel = '#' + f.id;
      const btn = page.locator(sel).locator('xpath=..').locator('button[aria-label="Show password"]').first();
      await btn.click({ timeout: 5000 });
      const on = await page.evaluate(s => { const i = document.querySelector(s); const b = i.parentElement.querySelector('button[aria-pressed]'); return { type: i.type, label: b && b.getAttribute('aria-label'), pressed: b && b.getAttribute('aria-pressed') }; }, sel);
      await page.locator(sel).locator('xpath=..').locator('button[aria-label="Hide password"]').first().click({ timeout: 5000 });
      const off = await page.evaluate(s => document.querySelector(s).type, sel);
      A(`${label}: ${f.id} — eye shows (text, "Hide password") then hides (password)`, on.type === 'text' && on.label === 'Hide password' && on.pressed === 'true' && off === 'password', JSON.stringify({ on, off }));
    }
    A(`${label}: no page errors / CSP refusals`, errs.length === 0 && csp.length === 0, JSON.stringify({ errs, csp }).slice(0, 300));
    await page.context().close();
  }
});
