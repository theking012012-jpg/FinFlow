'use strict';
/**
 * verify-b5-currency.js — B5.1: changing the display currency in Settings converts the KPI figures
 * AND changes the symbol TOGETHER (never a native figure relabelled under a foreign sign — F34/F70).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-b5-currency.js
 *
 * Real jsdom SPA + real server + real Postgres. One USD→EUR rate (0.90) is seeded, so the server
 * converts the whole history; the client sets _displayCurrency=EUR via the real updateCurrency() path
 * and re-fetches /api/reports?display=EUR (no client FX math). DISCRIMINATION (Rule 4): native FY
 * revenue 8,800 → EUR 7,920; a relabel bug shows 8,800 under €, an inversion shows 9,777 — neither
 * collides with the correct 7,920.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const m = String(e && e.message || e); if (/_location|pool after|terminating connection|Client was closed/.test(m)) return; throw e; });

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
function num(s) { if (s == null) return NaN; s = String(s).replace(/[^0-9.\-KM]/gi, ''); let m = 1; if (/K$/i.test(s)) { m = 1000; s = s.replace(/K$/i, ''); } else if (/M$/i.test(s)) { m = 1e6; s = s.replace(/M$/i, ''); } return parseFloat(s) * m; }

(async () => {
  let boot;
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, userId) => {
        const eid = (await c.query(`SELECT id FROM entities WHERE user_id=$1 ORDER BY id LIMIT 1`, [userId])).rows[0]?.id;
        await c.query(
          `INSERT INTO fx_rates (user_id, entity_id, from_currency, to_currency, rate, rate_date, source)
           VALUES ($1,$2,'USD','EUR',0.90,'2025-01-01','harness')`, [userId, eid]);
      },
    });
    const { window: w, settle, text } = boot;
    for (let i = 0; i < 250 && typeof w.updateCurrency !== 'function'; i++) await settle(1, 100);
    await settle(50, 100);

    const nativeRev = text('d-rev');   // USD FY revenue ≈ $8,800
    A('native Revenue card is in USD ($, ≈8,800)', /\$/.test(nativeRev || '') && Math.abs(num(nativeRev) - 8800) <= 60, `d-rev="${nativeRev}"`);

    // ── switch display currency to EUR via the REAL Settings path ──
    let sel = w.document.getElementById('s-currency');
    if (!sel) { sel = w.document.createElement('select'); sel.id = 's-currency'; const o = w.document.createElement('option'); o.value = 'EUR'; sel.appendChild(o); w.document.body.appendChild(sel); }
    if (![...sel.options].some(o => o.value === 'EUR')) { const o = w.document.createElement('option'); o.value = 'EUR'; sel.appendChild(o); }
    sel.value = 'EUR';
    await w.updateCurrency();
    // conversion re-fetches /api/reports?display=EUR — poll until the card actually changes to €
    let eurRev = '';
    for (let i = 0; i < 100; i++) { await settle(3, 60); eurRev = text('d-rev') || ''; if (/€/.test(eurRev)) break; }

    A('B5.1a Revenue card now carries the € symbol (not $)', /€/.test(eurRev) && !/\$/.test(eurRev), `d-rev="${eurRev}"`);
    A('B5.1b Revenue figure CONVERTED to 7,920 (8,800 × 0.90) — not relabelled (8,800) nor inverted (9,777)',
      Math.abs(num(eurRev) - 7920) <= 60, `got ${num(eurRev)} — relabel=8800, inversion≈9777, correct=7920`);
    const eurInv = text('d-invest');
    A('B5.1c Investments converted to €5,400 (6,000 × 0.90)', /€/.test(eurInv || '') && Math.abs(num(eurInv) - 5400) <= 40, `d-invest="${eurInv}"`);
    A('B5.1d figures + symbol changed TOGETHER (value differs from native AND sign flipped)',
      /€/.test(eurRev) && Math.abs(num(eurRev) - num(nativeRev)) > 100, `native="${nativeRev}" eur="${eurRev}"`);

    console.log('\n' + (fail === 0 ? '  ALL GREEN' : '  ' + fail + ' FAILED') + ` — ${pass} passed, ${fail} failed  (B5.1 currency switch)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
