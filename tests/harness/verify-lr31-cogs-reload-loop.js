'use strict';
/**
 * LR31 (found 2026-10-22 chasing the owner's sweep TIMEOUTs — verify-bankrec-render / verify-f106-client-controls hung
 * at 100% CPU). renderInventory (finflow-api-wiring-medium.js, the runtime winner) asks loadCOGS for the stock value
 * while window._inventoryValue is null, and loadCOGS (index.html) repaints renderInventory when its reply lands. A
 * reply WITHOUT inventoryValue — any error body from /api/cogs (expired session 401, a 500) or a bare {} — leaves the
 * value null, so the repaint asks again: an endless /api/cogs loop (in a browser a request storm; with an instant
 * reply a microtask spin that froze the page — the hang the sweep caught). Same root, second symptom: loadCOGS read the
 * error body as books, so COGS became parseFloat(undefined)||0 = 0 — dashboard Net silently overstated.
 * Latent since C7 (0982e0b, 2026-10-11).
 *
 * clientMoneyKit seed (hand-computed): Widget bought 10 @ 5, sold 4 + 2 ⇒ 4 on hand @ 5 = stock value 20; Year COGS 30.
 * /api/cogs replies are served on a macrotask, so the bug shows as a request COUNT instead of freezing the harness.
 *   1  500 error reply, value unknown → renderInventory makes exactly 1 request          bug: dozens (loop)
 *   1b the same error reply leaves COGS at its last real figure (30)                       bug: 0
 *   2  200 reply without inventoryValue → exactly 1 request                               bug: dozens (loop)
 *   3  CONTROL (business switch shape): value unknown + good reply → 1 request, value 20  bug: same (not discriminating)
 *   4  CONTROL (period change): two explicit loadCOGS calls → 2 requests — none dropped   bug: same (not discriminating)
 */
const { run } = require('./clientMoneyKit.js');

run('LR31 — renderInventory ↔ loadCOGS never loops; an error reply is not books', async ({ w, settle, eq, A }) => {
  const realFetch = w.fetch;
  let mode = 'real', n = 0;
  w.fetch = function (url, opts) {
    if (!/\/api\/cogs(\?|$)/.test(String(url))) return realFetch.apply(this, arguments);
    n++;
    if (mode === 'real') return realFetch.apply(this, arguments);
    const status = mode === '500' ? 500 : 200, body = mode === '500' ? { error: 'An unexpected error occurred.' } : {};
    return new Promise(r => setTimeout(() => r({ ok: status < 300, status, json: async () => body }), 0));
  };
  const measure = async (m, prep) => { mode = m; prep(); n = 0; try { w.renderInventory(); } catch (_) {} await settle(12, 70); const c = n; mode = 'real'; await settle(6, 50); return c; };

  // real figures first (the year COGS the dashboard subtracts)
  w.eval(`setPeriod(document.getElementById('pY'), 'year')`); await settle(20, 50);
  await w.loadCOGS(); await settle(4, 40);
  eq('premise: real COGS for the year = 30 and stock value = 20', [w._cogsTotal, w._inventoryValue], [30, 20]);

  const c1 = await measure('500', () => { w._inventoryValue = null; });
  eq('1  error reply (500), stock value unknown → /api/cogs requests', c1, 1, 'dozens — the render↔load loop');
  // 1b — measured on its own (the loop above ends once replies are real again, which also resets COGS)
  mode = '500'; w._cogsTotal = 30; w._inventoryValue = 20; n = 0;
  try { await w.loadCOGS(); } catch (_) {}
  await settle(4, 40); mode = 'real';
  eq('1b error reply keeps COGS at its last real figure', w._cogsTotal, 30, 0);

  const c2 = await measure('empty', () => { w._inventoryValue = null; });
  eq('2  200 reply without inventoryValue → /api/cogs requests', c2, 1, 'dozens — the render↔load loop');

  const c3 = await measure('real', () => { w._inventoryValue = null; });
  eq('3  CONTROL business-switch shape: one request and the value loads', [c3, w._inventoryValue], [1, 20]);

  n = 0; await Promise.all([w.loadCOGS(), w.loadCOGS()]); await settle(4, 40);
  A('4  CONTROL explicit loads are never dropped (period change): 2 calls → 2 requests', n === 2, 'requests=' + n);
  w.fetch = realFetch;
});
