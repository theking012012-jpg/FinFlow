'use strict';
/**
 * verify-lr20-card-sales-caption.js — LR20: the Sales Receipts cards say what they hold.
 *  "CARD SALES $50 · Via Stripe" for a receipt recorded by hand: receipts are only ever entered by hand (nothing writes a
 *  Stripe receipt), and the card sums every Card-method receipt — so "Via Stripe" was false. Cash / Card / Refunds are
 *  all-time totals beside a "This month" count; each now names its period.
 *
 * Real scratch Postgres, real server, real SPA (bundle). One Card receipt of 50 saved through the page's own form.
 *   Card Sales: "$50" · "Card · all time"            (old caption: "Via Stripe" — measured)
 *   Cash Sales caption names its period               (old: "Direct payments")
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr20-card-sales-caption.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR20 — Sales Receipts cards: no "Via Stripe" for a hand-recorded receipt\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR20 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('sales-receipts');
    await settle(30, 40);
    w.openNewReceiptModal(); await settle(5, 10);
    d.getElementById('receipt-customer').value = 'Walk-in';
    d.getElementById('receipt-amount').value = '50';
    d.getElementById('receipt-method').value = 'Card';
    await w.saveReceipt();
    await settle(60, 60);
    const card = name => Array.from(d.querySelectorAll('#page-sales-receipts .mc')).find(m => (m.querySelector('.mc-label') || {}).textContent === name);
    const read = name => { const c = card(name); return c ? [c.querySelector('.mc-val').textContent.trim(), c.querySelector('.mc-change').textContent.trim()] : null; };
    eq('Card Sales: the hand-recorded card receipt, captioned for what it is', read('Card Sales'), ['$50', 'Card · all time'], ['$50', 'Via Stripe']);
    eq('Cash Sales names its period', read('Cash Sales'), ['$0', 'Cash · all time'], ['$0', 'Direct payments']);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
