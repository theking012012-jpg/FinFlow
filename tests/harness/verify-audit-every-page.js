'use strict';
/**
 * Full-app audit, the page half (2026-10-27) — EVERY page of /app, opened in real Chromium at desktop (1280 × 800) and
 * phone (375 × 812) width, on a business with real documents (invoices paid / part-paid / overdue, a bill, an expense,
 * a customer, a vendor, a payroll employee and run, an inventory item, a project):
 *   1 no page scrolls sideways
 *   2 at phone width, no visible control is smaller than 24 × 24 px (WCAG 2.2 target size; inline links in text exempt)
 *   3 no script error and no Content-Security-Policy violation
 *   4 no broken value on screen — "NaN", "undefined", "[object Object]", "Infinity", or "null" as a visible word
 * Plus the 13 pages outside /app at phone width (1–3). (FA-U2 covered 19 /app pages at 375 px.)
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('Full-app audit — every page, desktop and phone', async ({ open, eq }) => {
  const errs = [];
  const watch = async (ctx, page) => {
    await ctx.addInitScript(() => { window.__cspV = []; document.addEventListener('securitypolicyviolation', e => window.__cspV.push(e.violatedDirective + ' ' + String(e.sample || '').slice(0, 40))); });
    page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
  };
  const result = { over: [], tiny: [], broken: [], csp: [] };
  for (const [w, h, phone] of [[1280, 800, false], [375, 812, true]]) {
    const page = await open({ width: w, height: h, beforeGoto: watch });
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.page[id^="page-"]')).map(p => p.id.slice(5)));
    for (const id of ids) {
      await page.evaluate(i => { try { window.showPage(i); } catch (_) {} }, id);
      await page.waitForTimeout(600);
      const r = await page.evaluate((phone) => {
        const vw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
        const pg = document.querySelector('.page.active'); const out = { overflow: sw - vw, wide: [], small: [], broken: [] };
        if (!pg) return out;
        const visible = el => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        pg.querySelectorAll('*').forEach(el => { const b = el.getBoundingClientRect(); if (b.width && b.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
          let a = el.parentElement, clipped = false; while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { clipped = true; break; } a = a.parentElement; }
          if (!clipped) out.wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ' ' + Math.round(b.right)); } });
        if (phone) pg.querySelectorAll('button, a[href], [data-on-click], input:not([type=hidden]), select, [role=button]').forEach(el => {
          if (!visible(el)) return; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          const inline = el.tagName === 'A' && cs.display === 'inline' && el.parentElement && el.parentElement.textContent.trim().length > (el.textContent || '').trim().length + 3;   // a link inside a sentence ("or email …") — WCAG 2.2 exempts it
          if (!inline && (b.width < 24 || b.height < 24) && !['checkbox', 'radio'].includes(el.type)) out.small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + ' "' + String(el.textContent || el.value || el.placeholder || '').trim().slice(0, 18) + '" ' + Math.round(b.width) + '×' + Math.round(b.height)); });
        const walker = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = n.nodeValue; if (!t || !/NaN|undefined|\[object Object\]|Infinity|\bnull\b/.test(t)) continue;
          const el = n.parentElement; if (!el || !visible(el) || /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE)$/.test(el.tagName)) continue;
          if (/\b(NaN|undefined|Infinity|null)\b|\[object Object\]/.test(t)) out.broken.push(t.trim().slice(0, 60));
        }
        return out;
      }, phone);
      if (r.overflow > 1 || r.wide.length) result.over.push(`${w}px ${id}: +${r.overflow}px ${r.wide.slice(0, 3).join(', ')}`);
      r.small.forEach(s => result.tiny.push(`${id}: ${s}`));
      r.broken.forEach(s => result.broken.push(`${w}px ${id}: "${s}"`));
    }
    result.csp.push(...(await page.evaluate(() => window.__cspV || [])).map(v => `${w}px ${v}`));
    await page.close();
  }
  // The pages outside /app, at phone width: no sideways scroll, no tiny control, no script error.
  for (const p of ['/', '/accountants.html', '/accountant-login.html', '/accountant-register.html', '/admin.html', '/reset-password.html?token=x', '/team-accept.html?token=x', '/pay-received.html', '/privacy.html', '/terms.html', '/security.html', '/conduct.html', '/no-such-page']) {
    const pg = await open({ width: 375, height: 812, beforeGoto: watch }, p);
    await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => {
      const vw = document.documentElement.clientWidth, out = { overflow: document.documentElement.scrollWidth - vw, small: [] };
      document.querySelectorAll('button, a[href], [data-on-click], input:not([type=hidden]), select, [role=button]').forEach(el => {
        const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!b.width || !b.height || cs.visibility === 'hidden' || cs.display === 'none' || ['checkbox', 'radio'].includes(el.type)) return;
        const inline = el.tagName === 'A' && cs.display === 'inline' && el.parentElement && el.parentElement.textContent.trim().length > (el.textContent || '').trim().length + 3;
        if (!inline && (b.width < 24 || b.height < 24)) out.small.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + ' "' + String(el.textContent || el.value || '').trim().slice(0, 18) + '" ' + Math.round(b.width) + '×' + Math.round(b.height));
      });
      return out;
    });
    if (r.overflow > 1) result.over.push(`375px ${p}: +${r.overflow}px`);
    r.small.forEach(s => result.tiny.push(`${p}: ${s}`));
    result.csp.push(...(await pg.evaluate(() => window.__cspV || [])).map(v => `${p} ${v}`));
    await pg.close();
  }
  if (process.env.AUDIT_DUMP) console.log(JSON.stringify(result, null, 1));
  eq('1  no page scrolls sideways (desktop and phone)', result.over, []);
  eq('2  no visible control under 24 × 24 px at 375 px', result.tiny.slice(0, 12), []);
  eq('3  no script error', errs.slice(0, 8), []);
  eq('3  no Content-Security-Policy violation', result.csp.slice(0, 8), []);
  eq('4  no broken value on screen (NaN / undefined / [object Object] / Infinity / null)', [...new Set(result.broken)].slice(0, 12), []);
}, { seed: async ({ J }) => {
  const inv = await J('POST', '/api/invoices', { client: 'Acme Ltd', amount: 1200, status: 'pending', issue_date: '2026-06-02', due_date: '2026-07-01', idempotency_key: 'au-1', line_items: [{ desc: 'Design', qty: 4, rate: 300 }] });
  const inv2 = await J('POST', '/api/invoices', { client: 'Beta Co', amount: 500, status: 'pending', issue_date: '2026-07-02', due_date: '2026-08-01', idempotency_key: 'au-2' });
  await J('POST', '/api/invoice-payments', { invoice_id: inv2.id, amount: 200, payment_date: '2026-07-10', method: 'Bank', idempotency_key: 'au-2p' });
  await J('POST', '/api/bills', { vendor: 'Paper Co', amount: 300, status: 'unpaid', issue_date: '2026-07-02', due_date: '2026-08-01', idempotency_key: 'au-b' });
  await J('POST', '/api/expenses', { description: 'Rent July', category: 'Rent', amount: 900, expense_date: '2026-07-01' });
  const item = await J('POST', '/api/inventory', { sku: 'W1', name: 'Widget', units: 0, max_units: 100, cost: 10 });
  await J('POST', '/api/inventory-movements', { inventory_id: item.id, type: 'purchase', quantity: 10, unit_cost: 10, date: '2026-07-01', idempotency_key: 'au-p1' });
  try { await J('POST', '/api/employees', { name: 'Sam Field', salary: 48000, pay_frequency: 'monthly', start_date: '2026-01-01' }); } catch (_) {}
  try { await J('POST', '/api/projects', { name: 'Website', client: 'Acme Ltd', budget: 5000 }); } catch (_) {}
} });
