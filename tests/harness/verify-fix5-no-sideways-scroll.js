'use strict';
/**
 * verify-fix5-no-sideways-scroll.js — FIX-5 (Cowork live check 2026-10-19, COWORK_FIX_HANDOFF.md).
 *
 * Live: on the Invoices list the view slid sideways and clipped each row's left edge — "Bright Labs" read
 * "ight Labs", "$2,500" read ",500" (reported at "~390 px").
 * MEASURED here (real Chromium, production build): at 390 / 375 px nothing overflows — the phone layout hides the
 * top-bar text buttons and stacks the rows. The overflow is the TABLET / narrow-desktop band, where the sidebar shows:
 * the top bar's controls (Owner · ‹ › · theme · currency · Month / Quarter / Year · Export PDF · CSV · XLSX · Ask AI ·
 * bell) need 837 px but `.topbar-right` was `flex-shrink:0`, so from 769 px up to ≈1,056 px `.main` (viewport −
 * 200 px sidebar) is narrower than its content. `.main` is overflow:hidden, so any scroll-into-view (focus, a click
 * near the right edge) slides the WHOLE page sideways and clips its left edge. Class (Rule 13): every one of the 54
 * pages, not only Invoices. Why C25 stayed green: it measures 375 / 600 / 900 px but checks the document and rows,
 * not `.main`'s own scroll width.
 * Fix: the top-bar controls wrap onto a second row when they do not fit (flex-wrap, may shrink) instead of
 * overflowing; at full desktop width they still sit on one row.
 *
 * Seed: a PENDING, a PARTIAL and an OVERDUE invoice (every action set an invoice row can show — C25's only invoice
 * was overdue, Rule 4). For every page × width, MEASURED:
 *   .main does not scroll sideways (scrollWidth ≤ clientWidth + 1)        bug: 837 > 569…816 on all 54 pages, 769–1,040 px
 *   every top-bar control lies inside the screen                         bug: Ask AI / bell past the right edge
 *   the page title is not cut off (scrollWidth ≤ clientWidth + 1)
 * plus, on Invoices: each row's client name and amount fully on screen; the page never scrolls sideways.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fix5-no-sideways-scroll.js
 */
process.env.SLIM_APP = '1';
const { runBrowser } = require('./browserKit.js');

const WIDTHS = [375, 390, 600, 768, 769, 800, 900, 1024, 1040, 1100, 1280, 1440];

runBrowser('FIX-5 — no sideways scroll at any width (top bar wraps); invoice rows keep client + amount on screen', async ({ open, A, eq }) => {
  const page = await open({ width: 1280, height: 844 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { if (typeof injectRoleBadge === 'function') injectRoleBadge('owner'); });   // the Owner pill shows after sign-in (C25)
  const pages = await page.evaluate(() => Array.from(document.querySelectorAll('.page')).map(p => p.id.replace(/^page-/, '')));
  A('all app pages found', pages.length >= 50, 'pages=' + pages.length);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    const mainOver = [], ctrlOut = new Set(), titleCut = [];
    for (const p of pages) {
      await page.evaluate(x => { try { showPage(x); } catch (_) {} }, p);
      await page.waitForTimeout(80);
      const m = await page.evaluate(() => {
        const vw = innerWidth, mn = document.querySelector('.main'), t = document.getElementById('pageTitle');
        const tr = document.querySelector('.topbar-right');
        const out = tr ? Array.from(tr.querySelectorAll('button, .role-badge, [class*="role"]')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none' && (r.right > vw + 1 || r.left < -1); })
          .map(e => (e.id || e.textContent.trim().slice(0, 12))) : [];
        return { over: mn.scrollWidth - mn.clientWidth, out, cut: t ? t.scrollWidth - t.clientWidth : 0, docOver: document.documentElement.scrollWidth - vw };
      });
      if (m.over > 1 || m.docOver > 0) mainOver.push(p + ' +' + Math.max(m.over, m.docOver));
      m.out.forEach(x => ctrlOut.add(x));
      if (m.cut > 1) titleCut.push(p);
    }
    eq(`${width}px: no page scrolls sideways (of ${pages.length})`, mainOver.length, 0, pages.length);
    if (mainOver.length) console.log('          ' + mainOver.slice(0, 6).join(' · ') + (mainOver.length > 6 ? ' …' : ''));
    eq(`${width}px: every top-bar control inside the screen`, [...ctrlOut], []);
    eq(`${width}px: no page title cut off`, titleCut, []);

    // Invoices rows: client + amount fully visible, actions on screen.
    await page.evaluate(() => showPage('invoices'));
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => {
      const vw = innerWidth;
      return Array.from(document.querySelectorAll('#invoice-list .table-row.inv-cols')).map(row => {
        const R = e => e.getBoundingClientRect(); const c = R(row.children[0]), a = R(row.children[1]);
        const btnOut = Array.from(row.querySelectorAll('button')).filter(b => { const r = R(b); return r.width > 0 && (r.left < 0 || r.right > vw); }).length;
        // B1b (2026-10-23): the first cell also carries the invoice number (.inv-number, its own line) — the name is the
        // cell's first text node, and the number must be on screen too.
        const num = row.querySelector('.inv-number'); const nr = num ? R(num) : null;
        const numOk = !num || (nr.left >= 0 && nr.right <= vw);
        return { n: String((row.children[0].childNodes[0] || {}).textContent || '').trim(), ok: c.left >= 0 && c.right <= vw && a.left >= 0 && a.right <= vw && numOk, btnOut };
      });
    });
    eq(`${width}px Invoices: 3 rows, client + amount on screen, buttons on screen`, rows.map(r => [r.n, r.ok, r.btnOut]).sort(),
      [['Acme Holdings International', true, 0], ['Bright Labs', true, 0], ['Delta Retail', true, 0]]);
  }
  // The layout still uses one top-bar row at full desktop width.
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250);
  const h = await page.evaluate(() => Math.round(document.querySelector('.topbar').getBoundingClientRect().height));
  A(`1440px: the top bar is one row (height ${h}px ≤ 64)`, h <= 64);
}, { seed: async ({ J }) => {
  await J('POST', '/api/invoices', { client: 'Bright Labs', amount: 2500, status: 'pending', issue_date: '2026-07-01', due_date: '2026-08-30', idempotency_key: 'fix5-p' });
  const pt = await J('POST', '/api/invoices', { client: 'Acme Holdings International', amount: 12500, status: 'pending', issue_date: '2026-07-02', due_date: '2026-09-01', idempotency_key: 'fix5-pt' });
  await J('POST', '/api/invoice-payments', { invoice_id: pt.id, amount: 2500, payment_date: '2026-07-10', idempotency_key: 'fix5-pp' });
  await J('POST', '/api/invoices', { client: 'Delta Retail', amount: 1200, status: 'overdue', issue_date: '2026-05-01', due_date: '2026-06-01', idempotency_key: 'fix5-o' });
} });
