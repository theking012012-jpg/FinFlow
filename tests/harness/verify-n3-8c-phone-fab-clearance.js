'use strict';
/**
 * verify-n3-8c-phone-fab-clearance.js — N3-8c (live re-audit 2026-11-11, script 8.4).
 * On a 390 px phone the floating "+" (.mobile-fab) covered the last invoice's ✕ — a control the user cannot scroll out
 * from under it, because it is at the very bottom of the page.
 * Executed in Chromium (browserKit) at 390×844 and 375×667 on every page that shows the "+" (FAB_PAGES: invoices,
 * expenses, customers, personal), each seeded with rows so the page is longer than the screen. The page is scrolled to
 * its END; every visible button / link / input inside the page is checked against the "+"'s rectangle.
 * EXPECTED: none overlaps the "+" when scrolled to the end (the page leaves room below its last control).
 * BUG VALUE: ≥ 1 control (the last row's ✕ / action) under the "+".
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('N3-8c — on a phone the floating "+" never covers a page\'s last controls', async ({ open, A, J }) => {
  for (let i = 1; i <= 14; i++) {
    const d = '2026-07-0' + (1 + (i % 9));
    await J('POST', '/api/customers', { company: 'Cust ' + i + ' Ltd', fname: '', lname: '' });
    await J('POST', '/api/invoices', { client: 'Cust ' + i + ' Ltd', amount: 100 + i, status: 'pending', issue_date: d, due_date: '2026-08-15', idempotency_key: 'i' + i });
    await J('POST', '/api/expenses', { description: 'Exp ' + i, category: 'Rent', amount: 10 + i, deductible: 'yes', expense_date: d, idempotency_key: 'e' + i });
    await J('POST', '/api/personal-transactions', { amount: 5 + i, tx_type: 'expense', category: 'Food', description: 'Lunch ' + i, tx_date: d, currency: 'USD', idempotency_key: 'p' + i });
  }
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    const page = await open(vp);
    for (const pg of ['invoices', 'expenses', 'customers', 'personal']) {
      await page.evaluate(p => window.showPage(p), pg);
      await page.waitForTimeout(900);
      const m = await page.evaluate(p => {
        const fab = document.querySelector('.mobile-fab');
        if (!fab || getComputedStyle(fab).display === 'none') return { fab: false };
        const sc = document.querySelector('.content'); sc.scrollTop = sc.scrollHeight; window.scrollTo(0, document.body.scrollHeight);
        const f = fab.getBoundingClientRect();
        const pageEl = document.getElementById('page-' + p);
        const hits = [];
        for (const el of pageEl.querySelectorAll('button, a, input, select, [data-on-click]')) {
          const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
          if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
          if (r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top) hits.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30) + ' @' + Math.round(r.top) + '-' + Math.round(r.bottom));
        }
        return { fab: true, fabTop: Math.round(f.top), fabBottom: Math.round(f.bottom), scrollH: sc.scrollHeight, clientH: sc.clientHeight, hits };
      }, pg);
      A(`${vp.width}×${vp.height} ${pg}: the "+" is shown`, m.fab, JSON.stringify(m));
      if (m.fab) A(`${vp.width}×${vp.height} ${pg}: scrolled to the end, no control under the "+" (bug: the last row's controls)`, m.hits.length === 0 && m.scrollH > m.clientH, JSON.stringify(m));
    }
  }
});
