'use strict';
/**
 * verify-n3-29-ai-page-repaints-on-load.js — N3-29 (owner's N3-16 classifier, 2026-11-13: fam12 0/8 on Windows / Node 24).
 * The AI insights page paints from the books when it OPENS. If it is open while the books are still loading (a slow
 * connection, a reload on that page), it stayed on "Year-to-date revenue: $0 … Add invoices to see your highest and lowest
 * revenue months" after the books arrived: the post-load repaint (refreshFinancials' active-page dispatch) had no entry
 * for it.
 *
 * Real SPA in jsdom + real bundle + real scratch Postgres. The AI page is opened BEFORE the books load (revenue 0 then);
 * updateAI is NOT called by the test. Seed (Rule 4 — every month differs): Jan 100 … Jul 700 by issue month, Σ 2,800.
 * EXPECTED after the books load: "$2,800", "highest revenue month: Jul 2026 at $700", "lowest revenue month: Jan 2026 at $100".
 * BUG VALUE: "$0" and "Add invoices to see your highest and lowest revenue months".
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
    for (let i = 0; i < 250 && typeof window.showPage !== 'function'; i++) await new Promise(r => setTimeout(r, 20));

    // The AI page is opened as soon as the app can navigate — before the books have loaded.
    try { window.currentPeriod = 'year'; } catch (_) {}
    let early=-1; try { early = window.computeRevenue(); } catch(_){}
    try { window.showPage('ai'); } catch (e) { console.log('showPage err ' + e.message); }
    const t0 = ((d.getElementById('ai-insights-list') || {}).textContent || '').replace(/\s+/g, ' ').slice(0,120);
    console.log('  [probe] revenue when AI page opened: ' + early + ' | text: ' + t0);
    for (let k = 0; k < 300; k++) { let r=0; try { r = window.computeRevenue(); } catch(_){} if (r > 0) break; await new Promise(r => setTimeout(r, 100)); }
    await settle(20, 100);
    const t1full = ((d.getElementById('ai-insights-list') || {}).textContent || '').replace(/\s+/g, ' '); const t1 = t1full.slice(0, 200);
    console.log('  [probe] after the books loaded, WITHOUT calling updateAI: ' + t1);
    A('precondition: the AI page opened BEFORE the books loaded (revenue 0 then)', early === 0, String(early));
    A('after the books load, the open AI page shows Year-to-date revenue $2,800 (bug: $0)', /Year-to-date revenue: \$2,800\b/.test(t1full), t1);
    A('…highest revenue month Jul 2026 at $700, lowest Jan 2026 at $100 (bug: "Add invoices to see …")', /highest revenue month[^.]*Jul[^.]*\$700\b/i.test(t1full) && /lowest revenue month[^.]*Jan[^.]*\$100\b/i.test(t1full), t1);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-29 AI page repaints when the books load)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
