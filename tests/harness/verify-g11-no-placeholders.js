'use strict';
/**
 * verify-g11-no-placeholders.js — G11 + B10 (D4: "don't ship placeholder tabs"). The app shipped "coming soon" surfaces:
 * a "Find Advisor" nav item opening "Advisor Network — Coming Soon" (a duplicate of Find Accountant), a "Client Portal —
 * Coming Soon" page in the navigation, the business investments "Rebalance ↗" button that only toasted "coming soon",
 * and a role note promising "per-account customization is coming soon".
 * After: Find Advisor is gone (the old page id still redirects to the directory); the Client Portal placeholder is not
 * shipped (FA-B10b builds the real portal); business Rebalance opens the real rebalance view on BUSINESS holdings only
 * (never the personal list — the wall); the role note states what is true. No "coming soon" text anywhere in the app.
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres, NO base seed. Holdings created through the real route:
 *   business: AAPL Stock 10 × 150 = 1,500 · BND Bond 20 × 75 = 1,500  → Stock 50.0% · Bond 50.0%
 *   personal: VTI ETF 100 × 200 = 20,000 (must NOT appear in the business view)
 *   node -r ./tests/harness/clock.js tests/harness/verify-g11-no-placeholders.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, seedExtra: async (c, uid) => {
      await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }]);
    } });
    const { window, http, settle } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.openRebalanceModal !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    await http.post('/api/holdings', { scope: 'business', ticker: 'AAPL', asset_type: 'Stock', shares: 10, cost_per: 150, price: 150 });
    await http.post('/api/holdings', { scope: 'business', ticker: 'BND', asset_type: 'Bond', shares: 20, cost_per: 75, price: 75 });
    await http.post('/api/holdings', { scope: 'personal', ticker: 'VTI', asset_type: 'ETF', shares: 100, cost_per: 200, price: 200 });

    // 1 — no "coming soon" text anywhere in the app's visible markup (scripts and styles excluded)
    const clone = d.body.cloneNode(true); clone.querySelectorAll('script,style').forEach(e => e.remove());
    const soon = (clone.textContent.match(/[^.]{0,50}coming soon[^.]{0,20}/gi) || []);
    A('1  no "coming soon" text anywhere in the app (bug: Advisor Network, Client Portal, role note)', soon.length === 0, JSON.stringify(soon.slice(0, 4)));
    const nav = [...d.querySelectorAll('.nav-item')].map(n => n.getAttribute('onclick') || '');
    A('2  no nav item opens the advisor or portal placeholders', !nav.some(o => /'advisors'|'portal'/.test(o)), JSON.stringify(nav.filter(o => /advisors|portal/.test(o))));
    A('3  the role note states what is true', /roles FinFlow enforces/.test(d.body.textContent), '');

    // 4 — business Rebalance: the real view, on business holdings only
    try { if (typeof window._loadBizHoldingsFromDB === 'function') await window._loadBizHoldingsFromDB(((window.ENTITIES || []).find(e => e.active) || {})._dbId); } catch (_) {}
    await settle(6, 50);
    const btn = [...d.querySelectorAll('button')].find(b => /Rebalance/.test(b.textContent) && /bizHoldings/.test(b.getAttribute('onclick') || ''));
    A('4  the business investments Rebalance button opens the rebalance view (bug: a "coming soon" toast)', !!btn, '');
    if (btn) { try { btn.click(); } catch (e) { A('click ran', false, e.message); } }
    await settle(3, 30);
    const m = d.getElementById('rebalance-modal');
    const rows = m ? [...m.querySelectorAll('.inv-rebalance-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()) : [];
    const pct = t => { const r = rows.find(x => x.startsWith(t + ' ')); return r ? (r.match(/^\S+ ([\d.]+)%/) || [])[1] : null; };
    A('5  it shows the BUSINESS split: Stock 50.0% · Bond 50.0% · ETF 0% (the personal VTI is not in it)', pct('Stock') === '50.0' && pct('Bond') === '50.0' && (pct('ETF') === '0' || pct('ETF') === '0.0'), JSON.stringify(rows));
    A('6  …titled for the business', /Rebalance business investments/.test(((m || {}).querySelector ? m.querySelector('.modal-title') : {}).textContent || ''), '');
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (G11 no placeholders)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
