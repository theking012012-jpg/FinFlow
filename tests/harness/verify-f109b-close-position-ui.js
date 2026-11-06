'use strict';
/**
 * verify-f109b-close-position-ui — F109 on the page: every holding row has Close; the Close window (a named dialog)
 * previews the realized gain; submitting records it, the holding shrinks, and a "Realized gains" line appears under the
 * list with its total and an Undo that puts the shares back.
 *
 * Executed: the real /app in jsdom (real server + scratch Postgres). Hand-computed: AAPL 10 @ cost 100; close 4 at 150
 * → realized gain 200.00; 6 left. Bug values (old code): no Close button, no realized line.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f109b-close-position-ui.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
(async () => {
  let h;
  console.log('\nF109b — close a position from the Investments page\n');
  try {
    h = await bootSpaInJsdom({}); await h.idle();
    const w = h.window, d = w.document, c = h.client;
    const add = await h.http.post('/api/holdings', { ticker: 'AAPL', shares: 10, cost_per: 100, price: 150 });
    if (add.status >= 300) throw new Error('seed holding ' + add.status);
    await w._loadHoldingsFromDB(); await h.settle(10, 50);
    w.renderInvestments(); await h.settle(5, 50);
    const btn = [...d.querySelectorAll('#inv-holdings-list button')].find(b => b.textContent.trim() === 'Close');
    A('the AAPL row has a Close button (bug: Edit / remove only)', !!btn);
    if (!btn) throw new Error('no Close button');
    btn.click(); await h.settle(5, 50);
    const m = d.getElementById('ff-close-pos');
    A('the Close window is a named dialog "Close AAPL"', m && m.getAttribute('role') === 'dialog' && m.getAttribute('aria-label') === 'Close AAPL', m && m.outerHTML.slice(0, 160));
    d.getElementById('cp-shares').value = '4'; d.getElementById('cp-price').value = '150';
    d.getElementById('cp-shares').dispatchEvent(new w.Event('input', { bubbles: true })); await h.settle(2, 50);
    A('the preview says "Realized gain" 200.00 before saving', /Realized gain\s*\$?200(\.00)?\b/.test(d.getElementById('cp-preview').textContent), d.getElementById('cp-preview').textContent);
    d.getElementById('cp-submit').click(); await h.settle(20, 50); await h.idle();
    const row = (await c.query(`SELECT data FROM realized_gains`)).rows;
    A('saved: one realized gain of 200 (4 at 150, cost 100)', row.length === 1 && Number(row[0].data.gain) === 200 && Number(row[0].data.shares_closed) === 4, JSON.stringify(row));
    const left = (await c.query(`SELECT data->>'shares' s FROM holdings WHERE data->>'ticker' = 'AAPL'`)).rows[0];
    A('the holding now has 6', left && Number(left.s) === 6, JSON.stringify(left));
    const box = d.getElementById('inv-realized');
    A('the "Realized gains" line under the list: total +200 (money shown without cents), labelled not operating profit', box && /Realized gains/.test(box.textContent) && /^\+\$?200(\.00)?$/.test(((d.getElementById('inv-realized-total') || {}).textContent || '').trim()) && /not part of operating profit/.test(box.textContent), box && box.textContent.replace(/\s+/g, ' ').trim().slice(0, 240));
    w._confirmModal = async () => true;
    const undo = [...box.querySelectorAll('button')].find(b => b.textContent.trim() === 'Undo');
    undo.click(); await h.settle(20, 50); await h.idle();
    const after = (await c.query(`SELECT data->>'shares' s FROM holdings WHERE data->>'ticker' = 'AAPL'`)).rows[0];
    A('Undo: the record is gone and the holding is back to 10', (await c.query(`SELECT count(*)::int n FROM realized_gains`)).rows[0].n === 0 && after && Number(after.s) === 10, JSON.stringify(after));
    A('…and the realized line is cleared', (d.getElementById('inv-realized').textContent || '').trim() === '', d.getElementById('inv-realized').textContent);
    // The business page draws its own rows (app-24): Close is there too, and its realized line is the business's only.
    const bh = (await h.http.post('/api/holdings', { ticker: 'MSFT', shares: 5, cost_per: 200, price: 260, scope: 'business' })).json;
    await w._loadBizHoldingsFromDB(); await h.settle(10, 50);
    A('the business holding row has Close', [...d.querySelectorAll('#biz-inv-holdings-list button')].some(b => b.textContent.trim() === 'Close'));
    await h.http.post(`/api/holdings/${bh.id}/close`, { shares: 5, price: 260, date: '2026-07-23' });
    await h.http.post('/api/holdings/' + (await c.query(`SELECT id FROM holdings WHERE data->>'ticker' = 'AAPL'`)).rows[0].id + '/close', { shares: 1, price: 110, date: '2026-07-23' });
    await w.loadRealizedGains('business'); await w.loadRealizedGains('personal'); await h.settle(5, 50);
    A('business line: +300 MSFT only (5 × (260 − 200)); personal line: +10 AAPL only (the wall, on the page)',
      ((d.getElementById('biz-inv-realized-total') || {}).textContent || '').trim().replace(/[$,]/g, '') === '+300'
      && !/AAPL/.test(d.getElementById('biz-inv-realized').textContent) && /MSFT/.test(d.getElementById('biz-inv-realized').textContent)
      && ((d.getElementById('inv-realized-total') || {}).textContent || '').trim().replace(/[$,]/g, '') === '+10' && !/MSFT/.test(d.getElementById('inv-realized').textContent),
      JSON.stringify([d.getElementById('biz-inv-realized-total') && d.getElementById('biz-inv-realized-total').textContent, d.getElementById('inv-realized-total') && d.getElementById('inv-realized-total').textContent]));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (h) { try { await h.stop(); } catch (_) {} } }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F109b close a position, on the page)\n`);
  process.exitCode = fail ? 1 : 0;
})();
