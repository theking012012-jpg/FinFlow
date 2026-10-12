'use strict';
/**
 * C25 (Cowork end-to-end test): at phone and tablet widths nothing is squeezed, overlapped or pushed off-screen.
 * BUG (Cowork, 375 px): the Invoices card header wrapped one word per line (title squeezed to 52 px wide, 112 px tall)
 * with its buttons running past the screen edge; the Personal title ran under the Owner pill. Same class (Rule 13):
 * the narrow-screen column rules for customer, holding and invoice rows sit BEFORE their base rules (same
 * specificity) and never applied, so hidden cells left the remaining ones in the wrong columns.
 * Executed in Chromium (browserKit) at 375, 600 and 900 px with the Owner pill shown (it appears after a sign-in).
 *   page title never overlaps the topbar controls
 *   each card header's title text wraps to ≤ 2 lines (bug: ~6, one word per line) and nothing in it runs past the screen
 *   each list row (invoice, customer, holding) fits its row: no sideways overflow, no overlapping cells
 *   the page never scrolls sideways
 */
const { runBrowser } = require('./browserKit.js');

const PAGES = [
  { id: 'personal', rowSel: null },
  { id: 'invoices', rowSel: '.table-row.inv-cols' },
  { id: 'customers', rowSel: '.cust-row' },
  { id: 'investments', rowSel: '.inv-holding-row' },
];

runBrowser('C25 — phone / tablet widths: no squeeze, overlap or sideways scroll', async ({ open, A }) => {
  for (const width of [375, 600, 900]) {
    const page = await open({ width, height: 800 });
    await page.evaluate(() => { if (typeof injectRoleBadge === 'function') injectRoleBadge('owner'); });
    for (const pg of PAGES) {
      await page.evaluate(p => showPage(p), pg.id); await page.waitForTimeout(700);
      const m = await page.evaluate(rowSel => {
        const vis = e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
        const R = e => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
        const hit = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        const vw = window.innerWidth, out = { vw, docW: document.documentElement.scrollWidth };
        const title = document.getElementById('pageTitle'), tr = document.querySelector('.topbar-right');
        out.titleHits = title && tr ? Array.from(tr.children).filter(vis).filter(k => hit(R(title), R(k))).map(k => k.id || k.className) : [];
        const act = document.querySelector('.page.active');
        out.headers = Array.from(act.querySelectorAll('.card-header')).filter(vis).map(h => {
          const kids = Array.from(h.children).filter(vis);
          const t = kids[0];
          // lines a title text wraps onto: each text leaf's height ÷ its line height (bug: Invoices title ≈ 6 lines)
          const leaves = t ? [t, ...t.querySelectorAll('*')].filter(e => vis(e) && !e.children.length && e.textContent.trim()) : [];
          const lines = Math.max(0, ...leaves.map(e => { const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.25; return Math.round(R(e).h / lh); }));
          return { title: t ? t.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) : '', lines, maxR: Math.max(0, ...kids.map(k => R(k).r)) };
        });
        if (rowSel) {
          const rows = Array.from(act.querySelectorAll(rowSel)).filter(vis);
          const row = rows.find(r => r.querySelector('button, .badge, .table-actions')) || rows[rows.length - 1];
          if (row) {
            const rr = R(row), cells = Array.from(row.children).filter(vis).map(R);
            out.row = { found: true, overflow: row.scrollWidth - row.clientWidth, outside: cells.filter(c => c.l < rr.l - 1 || c.r > rr.r + 1).length,
                        overlap: cells.some((a, i) => cells.some((b, j) => j > i && hit(a, b))), cells: cells.map(c => [c.l, c.r, c.t]) };
          } else out.row = { found: false };
        }
        return out;
      }, pg.rowSel);
      const tag = `${width}px ${pg.id}`;
      A(`${tag}: title clear of the topbar controls`, m.titleHits.length === 0, JSON.stringify(m.titleHits));
      for (const h of m.headers) A(`${tag}: header "${h.title}" not squeezed and on screen (title wraps to ${h.lines} line(s), right ${h.maxR}/${m.vw})`, h.lines <= 2 && h.maxR <= m.vw);
      if (m.row) {
        A(`${tag}: a list row is shown`, m.row.found);
        if (m.row.found) A(`${tag}: row fits — no sideways overflow, cells inside, none overlapping`, m.row.overflow <= 1 && m.row.outside === 0 && !m.row.overlap, JSON.stringify(m.row));
      }
      A(`${tag}: page does not scroll sideways (${m.docW}/${m.vw})`, m.docW <= m.vw);
    }
  }
}, { seed: async ({ J }) => {
  await J('POST', '/api/invoices', { client: 'Acme Holdings International', amount: 12500, status: 'overdue', issue_date: '2026-05-01', due_date: '2026-06-01' });
  await J('POST', '/api/customers', { fname: 'Jordan', lname: 'Example', company: 'Northwind Trading Company', email: 'jordan@example.test', phone: '+1 555 0100' });
  await J('POST', '/api/holdings', { ticker: 'MSFT', name: 'Microsoft Corporation', shares: 10, avg_cost: 300, scope: 'personal' });
} });
