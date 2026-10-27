'use strict';
/**
 * FA-U2 (2026-10-27) — at phone width (375 × 812) no page scrolls sideways and no visible control is smaller than
 * 24 × 24 px (WCAG 2.2 AA target size). Real Chromium (browserKit), real server, one business with real documents.
 */
const { runBrowser } = require('./browserKit.js');
const PAGES = ['dashboard', 'invoices', 'expenses', 'bills', 'customers', 'vendors', 'inventory', 'payroll', 'banking', 'reports',
  'chart-of-accounts', 'manual-journals', 'quotes', 'sales-receipts', 'credit-notes', 'settings', 'entities', 'personal', 'audit'];
runBrowser('FA-U2 — phone width: no sideways scroll, no tiny tap targets', async ({ open, eq }) => {
  const page = await open({ width: 375, height: 812 });
  const over = [], tiny = [];
  for (const p of PAGES) {
    await page.evaluate(id => { try { window.showPage(id); } catch (_) {} }, p);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
      const pg = document.querySelector('.page.active');
      const wide = [];
      if (pg) pg.querySelectorAll('*').forEach(el => { const b = el.getBoundingClientRect(); if (b.width && b.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
        let a = el.parentElement, clipped = false; while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { clipped = true; break; } a = a.parentElement; }
        if (!clipped) wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ' ' + Math.round(b.right)); } });
      const small = [];
      if (pg) pg.querySelectorAll('button, a[href], a[onclick], input:not([type=hidden]), select, [role=button]').forEach(el => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const inline = el.tagName === 'A' && cs.display === 'inline' && el.parentElement && el.parentElement.textContent.trim().length > (el.textContent || '').trim().length + 10;   // WCAG 2.2: a link inside a sentence is exempt
        if (!inline && b.width && b.height && cs.visibility !== 'hidden' && (b.width < 24 || b.height < 24)) small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + ' "' + (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 20) + '" ' + Math.round(b.width) + '×' + Math.round(b.height)); });
      return { overflow: sw - vw, wide: wide.slice(0, 4), small };
    });
    if (r.overflow > 1 || r.wide.length) over.push(p + ' +' + r.overflow + 'px ' + r.wide.join(', '));
    r.small.forEach(s => tiny.push(p + ': ' + s));
  }
  if (process.env.FAU2_DUMP) { console.log(over.join('\n')); console.log(tiny.join('\n')); }
  eq('1  no page scrolls sideways at 375 px', over, []);
  eq('2  no visible control under 24 × 24 px at 375 px', tiny.length, 0);
});
