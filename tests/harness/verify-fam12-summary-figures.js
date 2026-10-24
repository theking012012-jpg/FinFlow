'use strict';
/**
 * verify-fam12-summary-figures.js — FA-M12 a–c (full app audit M12: summary figures that contradict the books).
 *   a  AI insights "Best month … Weakest month …" ranked REVENUE without saying so, over all 12 months — so with every
 *      elapsed month earning something, a FUTURE month at $0 came out "weakest".
 *   b  Scenario planner: top card "Cash runway N/A — cash not tracked", result card "−1 mo" on the same screen.
 *   c  Payments Received "Avg days to pay — No data yet" although invoices had been paid (never computed).
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres, NO base seed. Clock 2026-07-25; fiscal year from January.
 *   revenue by issue month: Jan 100 · Feb 200 · Mar 300 · Apr 400 · May 500 · Jun 600 · Jul 700 (Aug–Dec in the future)
 *   Jan invoice paid 25 Jan (15 days) · Feb invoice paid 7 Mar (25 days) → avg days to pay (15 + 25) / 2 = 20
 *   EXPECTED: "highest revenue month: July at $700" · "lowest revenue month: January at $100" (bug: "Weakest: August $0")
 *             scenario result runway "N/A" like the top card (bug: "-1 mo") · avg days to pay "20 days" (bug: "—")
 *   node -r ./tests/harness/clock.js tests/harness/verify-fam12-summary-figures.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({
      baseSeed: false,
      seedExtra: async (c, uid) => {
        const ent = (await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2) RETURNING id`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }])).rows[0].id;
        const inv = async (d) => (await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`, [uid, ent, d])).rows[0].id;
        const pay = (invId, amt, date) => c.query(`INSERT INTO invoice_payments (user_id, entity_id, invoice_id, amount, payment_date, method, notes, idempotency_key) VALUES ($1,$2,$3,$4,$5,'bank','', $6)`, [uid, ent, invId, amt, date, 'm12-' + invId]);
        const months = ['01', '02', '03', '04', '05', '06', '07'];
        for (let i = 0; i < months.length; i++) {
          const amount = 100 * (i + 1), paid = i < 2;
          const id = await inv({ client: 'Client ' + (i + 1), amount, status: paid ? 'paid' : 'pending', amount_paid: paid ? amount : 0, issue_date: '2026-' + months[i] + '-10', due_date: '2026-' + months[i] + '-28' });
          if (i === 0) await pay(id, amount, '2026-01-25');
          if (i === 1) await pay(id, amount, '2026-03-07');
        }
      },
    });
    const { window, settle } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.updateAI !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(20, 100);

    // a — AI insights
    try { window.currentPeriod = 'year'; } catch (_) {}
    try { window.updateAI(); } catch (e) { A('updateAI ran', false, e.message); }
    const ai = ((d.getElementById('ai-insights-list') || {}).textContent || '').replace(/\s+/g, ' ');
    console.log('  [ai] ' + ai.slice(0, 300));
    A('a1 the best month says it is REVENUE: highest revenue month July at $700', /highest revenue month[^.]*Jul(y)?( 2026)?[^.]*\$700\b/i.test(ai), '');
    A('a2 the weakest is an ELAPSED month: lowest revenue month January at $100 (bug: a future month at $0)', /lowest revenue month[^.]*Jan(uary)?( 2026)?[^.]*\$100\b/i.test(ai) && !/(Aug|Sep|Oct|Nov|Dec)[a-z]*( 2026)? at \$0\b/.test(ai), '');

    // b — scenario planner
    try { window.showPage('scenario'); } catch (_) {}
    await settle(6, 60);
    try { window.updateScenario(); } catch (e) { A('updateScenario ran', false, e.message); }
    const top = ((d.getElementById('sc-runway') || {}).textContent || '').trim();
    const res = ((d.getElementById('sc-r-runway') || {}).textContent || '').trim();
    const resD = ((d.getElementById('sc-r-runway-d') || {}).textContent || '').trim();
    A('b1 with no cash tracked, the result card says N/A like the top card (bug: "-1 mo")', top === 'N/A' && res === 'N/A' && !/-1/.test(resD), JSON.stringify({ top, res, resD }));
    const margin = ((d.getElementById('sc-profit-chg') || {}).textContent || '').trim();
    A('b2 the projected margin is a number, never NaN', !/NaN/.test(margin), margin);

    // c — Payments Received
    try { window.showPage('payments-received'); } catch (_) {}
    await settle(12, 80);
    const vals = [...d.querySelectorAll('#page-payments-received .mc-val')].map(e => e.textContent.trim());
    const subs = [...d.querySelectorAll('#page-payments-received .mc-change')].map(e => e.textContent.trim());
    A('c1 Avg days to pay = (15 + 25) / 2 = 20 days (bug: "—" / No data yet)', vals[3] === '20 days', JSON.stringify(vals));
    A('c2 …and it says what it is measured on: 2 paid invoices', /2 paid invoices/.test(subs[3] || ''), JSON.stringify(subs[3]));
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-M12 summary figures)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
