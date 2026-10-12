'use strict';
/**
 * C21 (Cowork end-to-end test): the inventory row's actions (+ In, − Out, Restock, Edit, ✕) are visible and usable at
 * every screen width.
 * BUG: at ≤ 768 px the row's 6th column — the whole action group — was display:none, so stock could not be moved on
 * a phone or a narrow window (Cowork: hidden at ~656 px). On desktop the header had a 7th "COGS" column no row fills,
 * so the buttons sat squeezed in a 65 px slot.
 * Executed in Chromium (browserKit), one stock item, at 1440, 1100, 900, 656 and 375 px wide.
 *   each button: displayed, on screen, inside its row                          bug (≤ 768): not displayed
 *   no two buttons overlap; the row does not overflow sideways
 */
const { runBrowser } = require('./browserKit.js');

const LABELS = ['+ In', '− Out', 'Restock', 'Edit', '✕'];

runBrowser('C21 — inventory row actions at every width', async ({ open, A }) => {
  for (const width of [1440, 1100, 900, 656, 375]) {
    const page = await open({ width, height: 800 });
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('inventory'); });
    await page.waitForTimeout(800);
    const m = await page.evaluate(labels => {
      const row = document.querySelector('#inventory-list .inv-item-row');
      if (!row) return { row: false };
      const rr = row.getBoundingClientRect();
      const btns = Array.from(row.querySelectorAll('button')).map(b => {
        const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
        return { t: b.textContent.trim(), shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !!b.offsetParent,
                 l: Math.round(r.left), r: Math.round(r.right), tp: Math.round(r.top), b: Math.round(r.bottom) };
      });
      return { row: true, vw: window.innerWidth, rowL: Math.round(rr.left), rowR: Math.round(rr.right), overflow: row.scrollWidth - row.clientWidth,
               btns: labels.map(l => btns.find(x => x.t === l) || { t: l, shown: false }) };
    }, LABELS);
    if (!m.row) { A(`${width}px: inventory row rendered`, false); continue; }
    for (const b of m.btns) A(`${width}px: "${b.t}" shown and on screen`, b.shown && b.l >= 0 && b.r <= m.vw && b.l >= m.rowL - 1 && b.r <= m.rowR + 1, JSON.stringify(b));
    const shown = m.btns.filter(b => b.shown);
    const overlap = shown.some((a, i) => shown.some((c, j) => j > i && a.l < c.r - 1 && c.l < a.r - 1 && a.tp < c.b - 1 && c.tp < a.b - 1));
    A(`${width}px: no two buttons overlap`, !overlap);
    A(`${width}px: the row does not overflow sideways (${m.overflow}px)`, m.overflow <= 1);
  }
}, { seed: async ({ J }) => { await J('POST', '/api/inventory', { name: 'Widget Deluxe', sku: 'WD-01', units: 40, max_units: 100, cost: 12.5 }); } });
