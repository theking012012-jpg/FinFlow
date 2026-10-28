'use strict';
/**
 * FA-P1 (2026-10-27) — the STRICT Content-Security-Policy is enforced and FinFlow works under it. Real Chromium (which
 * enforces the policy), real server, one business with real documents.
 *
 * BUG (executed on the old code): the enforced policy allowed 'unsafe-inline', so markup injected into a page could run
 * script — an <img onerror> set through innerHTML ran (window.__pwned = 1) — and set inline styles.
 *
 *   1 injected inline code is refused: an <img onerror="…"> through innerHTML does not run (old: it ran); an injected
 *     data-on-click whose code is not in the registry does not run; an injected style="…" is not applied
 *   2 FinFlow's own handlers run under the policy — real clicks: a nav item opens its page, "New invoice" opens the form,
 *     a View button opens the document; the FORM step of the inline-handler scope chain resolves (jsdom cannot show it)
 *   3 FinFlow's own styles apply: data-style → element.style (none left unapplied after every page is opened);
 *     run-time CSS (tour, report print) and the document view's own CSS inside its iframe
 *   4 ZERO policy violations: every page of /app at 1280 and at 375 px, the slim /app (SLIM_APP), and every other page
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('FA-P1 — strict CSP enforced, the app works under it', async ({ open, eq }) => {
  const errs = [];
  const watch = async (ctx, page) => {
    await ctx.addInitScript(() => {
      window.__cspV = [];
      document.addEventListener('securitypolicyviolation', e => window.__cspV.push(e.violatedDirective + ' ' + String(e.blockedURI || '').slice(0, 40) + ' @' + String(e.sourceFile || '').split('/').pop() + ':' + e.lineNumber + ' ' + String(e.sample || '').slice(0, 50)));
    });
    page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  };
  const violations = async page => {
    const own = await page.evaluate(() => window.__cspV || []);
    const frames = [];
    for (const f of page.frames()) if (f !== page.mainFrame()) { try { frames.push(...await f.evaluate(() => window.__cspV || [])); } catch (_) {} }
    return own.concat(frames);
  };
  const pagesOf = page => page.evaluate(() => Array.from(document.querySelectorAll('.page[id^="page-"]')).map(p => p.id.slice(5)));
  const visitAll = async (page, ids) => { for (const id of ids) { await page.evaluate(i => { try { window.showPage(i); } catch (_) {} }, id); await page.waitForTimeout(250); } };

  // ── /app at 1280 ──
  const app = await open({ width: 1280, height: 800, beforeGoto: watch });
  // 1 — the attacks
  const atk = await app.evaluate(async () => {
    const box = document.createElement('div'); document.body.appendChild(box);
    box.innerHTML = '<img src="/nope-404.png" onerror="window.__pwned = 1"><button id="atk-btn" data-on-click="window.__pwned2 = 1">x</button><div id="atk-style" style="color: rgb(1, 2, 3)">s</div>';
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('atk-btn').click();
    const col = getComputedStyle(document.getElementById('atk-style')).color;
    box.remove();
    return { pwned: window.__pwned === 1, pwned2: window.__pwned2 === 1, styled: col === 'rgb(1, 2, 3)' };
  });
  eq('1  injected <img onerror> through innerHTML does not run', atk.pwned, false, true);
  eq('1  injected data-on-click with code not in the registry does not run', atk.pwned2, false);
  eq('1  injected style="…" is not applied', atk.styled, false, true);
  const attackV = (await violations(app)).length;
  await app.evaluate(() => { window.__cspV = []; });
  eq('1  …and the browser reported the refusals (the policy is enforced, with reporting)', attackV > 0, true, false);

  // 2 — FinFlow's own handlers, real clicks
  // the first VISIBLE nav item that leads to another page (sub-items sit in collapsed groups)
  const navTarget = await app.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.nav-item[data-on-click^="showPage("]')).filter(n => n.offsetParent !== null);
    const it = items.find(n => { const m = n.getAttribute('data-on-click').match(/showPage\('([^']+)'/); return m && !document.querySelector('#page-' + m[1] + '.active'); });
    if (!it) return null; it.setAttribute('data-test-nav', '1'); return it.getAttribute('data-on-click').match(/showPage\('([^']+)'/)[1];
  });
  await app.click('[data-test-nav="1"]');
  await app.waitForTimeout(400);
  eq('2  a real click on a nav item (' + navTarget + ') opens its page', await app.evaluate(t => !!document.querySelector('#page-' + t + '.active'), navTarget), true);
  await app.evaluate(() => window.showPage('invoices')); await app.waitForTimeout(400);
  await app.click('#page-invoices [data-on-click="openInvoiceModal()"]');
  await app.waitForTimeout(400);
  eq('2  "New invoice" opens the invoice form', await app.evaluate(() => { const m = document.getElementById('invoice-modal'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; }), true);
  await app.evaluate(() => window.closeModal && window.closeModal('invoice-modal'));
  const formScope = await app.evaluate(`(function () {
    window.__ffHandlers['this.setAttribute("data-q", q.value)'] = function (event) { with (this.ownerDocument || document) { with (this.form || {}) { with (this) {
      this.setAttribute("data-q", q.value)
    } } } };
    var f = document.createElement('form'); f.innerHTML = '<input name="q" value="from-form"><button type="button" id="fs-btn" data-on-click=\\'this.setAttribute("data-q", q.value)\\'>b</button>';
    document.body.appendChild(f); document.getElementById('fs-btn').click(); var v = document.getElementById('fs-btn').getAttribute('data-q'); f.remove(); return v;
  })()`);
  eq('2  a bare name in a handler resolves through the element\'s FORM (the inline-handler scope chain)', formScope, 'from-form');

  // 3 — styles
  eq('3  data-style is applied through element.style (the off-screen heading: left -9999px)', await app.evaluate(() => { const h = Array.from(document.querySelectorAll('h2')).find(x => /FinFlow Pro/.test(x.textContent)); return h ? getComputedStyle(h).left : null; }), '-9999px');
  const ids = await pagesOf(app);
  await visitAll(app, ids);
  eq('3  after opening all ' + ids.length + ' pages, no data-style is left unapplied', await app.evaluate(() => document.querySelectorAll('[data-style]').length), 0);
  await app.evaluate(() => { window.showPage('invoices'); });
  await app.waitForTimeout(500);
  const view = await app.$('[data-on-click^="viewInvoice("]');
  if (view) { await view.click(); await app.waitForTimeout(1200); }
  const docv = await app.evaluate(() => {
    const f = document.getElementById('ff-docview-frame'); const d = f && f.contentDocument;
    if (!d || !d.body) return null;
    return { pad: getComputedStyle(d.body).paddingTop, left: d.querySelectorAll('[data-style]').length, styled: Array.from(d.querySelectorAll('div')).some(x => x.style.cssText.length > 0) };
  });
  eq('3  the document view: its CSS applies inside the frame (body padding 44px), its styles too, none left', docv, { pad: '44px', left: 0, styled: true });
  await app.evaluate(() => { const o = document.getElementById('ff-docview'); if (o) o.style.display = 'none'; });
  const tour = await app.evaluate(async () => {
    const T = window.HELP_TOURS || {}; const k = Object.keys(T)[0]; if (!k || !window.startTour) return 'no tour';
    window.startTour(k); await new Promise(r => setTimeout(r, 500));
    const ring = document.querySelector('.tour-ring'); const pos = ring ? getComputedStyle(ring).position : null;
    document.querySelectorAll('.tour-dim,.tour-ring,.tour-tip').forEach(e => e.remove());
    return pos;
  });
  eq('3  run-time CSS (the tour) applies — its ring is position:fixed', tour, 'fixed');
  await app.evaluate(() => window.showPage('reports')); await app.waitForTimeout(400);
  const rep = await app.$('[data-on-click^="generateReport("]');
  if (rep) { await rep.click(); await app.waitForTimeout(1200); }
  eq('3  run-time CSS (report printing) is a constructed stylesheet, not a <style>', await app.evaluate(() => document.adoptedStyleSheets.some(s => Array.from(s.cssRules).some(r => /report-gen-modal/.test(r.cssText)))), true);
  const v1280 = await violations(app);
  eq('4  /app at 1280 px: every page, forms, document view, tour, report — zero policy violations', v1280.slice(0, 6), []);

  // ── /app at 375 ──
  const phone = await open({ width: 375, height: 812, beforeGoto: watch });
  await visitAll(phone, ids);
  eq('4  /app at 375 px, every page — zero violations (and the mobile stylesheet is a file)', [(await violations(phone)).slice(0, 6), await phone.evaluate(() => Array.from(document.styleSheets).some(s => /\/css\/app-mobile\.css$/.test(s.href || '')))], [[], true]);

  // ── the slim /app (SLIM_APP: lazy screens, externalized build) ──
  process.env.SLIM_APP = '1';
  const slim = await open({ width: 1280, height: 800, beforeGoto: watch });
  const slimIds = await pagesOf(slim);
  await visitAll(slim, slimIds);
  eq('4  slim /app: every page — zero violations, no data-style left', [(await violations(slim)).slice(0, 6), await slim.evaluate(() => document.querySelectorAll('[data-style]').length)], [[], 0]);
  delete process.env.SLIM_APP;

  // ── every other page ──
  const other = {};
  for (const p of ['/', '/accountants.html', '/accountant-login.html', '/accountant-register.html', '/admin.html', '/reset-password.html?token=x', '/team-accept.html?token=x', '/pay-received.html', '/privacy.html', '/terms.html', '/security.html', '/conduct.html', '/no-such-page']) {
    const pg = await open({ width: 1280, height: 800, beforeGoto: watch }, p);
    const v = await violations(pg);
    if (v.length) other[p] = v.slice(0, 3);
    await pg.close();
  }
  eq('4  every other page — zero violations', other, {});
  eq('4  no script errors on any page', errs.filter(e => !/nope-404|Failed to fetch|NetworkError|Load failed/.test(e)).slice(0, 6), []);
}, { seed: async ({ J }) => {
  await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 250, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01', idempotency_key: 'csp-1', line_items: [{ desc: 'Work', qty: 1, rate: 250 }] });
  await J('POST', '/api/expenses', { description: 'Paper', category: 'Office Supplies', amount: 20, expense_date: '2026-07-03' });
} });
