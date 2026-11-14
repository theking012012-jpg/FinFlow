'use strict';
/**
 * verify-n3-29b-scenario-repaints-on-load.js — N3-29 (same class as the AI page) (owner's N3-16 classifier, 2026-11-13: fam12 0/8 on Windows / Node 24).
 * The Scenario planner takes its baseline (BASE) from the books' Year when it OPENS. Opened while the books were still
 * loading, it stayed at Revenue $0 / Net profit $0 after they arrived (executed 2026-11-13: BASE.rev 0, all four cards
 * "$0"). Same cause as the AI page: refreshFinancials' active-page dispatch had no entry for it.
 *
 * Real SPA in jsdom + real bundle + scratch Postgres. Scenario opened BEFORE the books load; the test calls nothing else.
 * Seed: invoices Jan 100 … Jul 700 by issue month (Σ 2,800), no expenses.
 * EXPECTED after the books load: baseline revenue 2,800; Revenue card "$2,800". BUG VALUE: 0 / "$0".
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

    try { window.showPage('scenario'); } catch (e) {}
    await new Promise(r => setTimeout(r, 50));
    const rd = () => JSON.stringify({ base: (window.BASE||{}).rev, ids: ['sc-rev','sc-profit','sc-r-rev','sc-r-profit'].map(id => (d.getElementById(id)||{}).textContent) });
    let e0=-1; try{ e0=window.computeRevenue(); }catch(_){}
    console.log('  [sc] at open rev=' + e0 + ' ' + rd());
    for (let k = 0; k < 300; k++) { let r=0; try { r = window.computeRevenue(); } catch(_){} if (r > 0) break; await new Promise(r => setTimeout(r, 100)); }
    await settle(20, 100);
    console.log('  [sc] after load ' + rd());
    A('precondition: Scenario opened BEFORE the books loaded (revenue 0 then)', e0 === 0, String(e0));
    A('after the books load, the Scenario baseline revenue is 2,800 (bug: 0)', (window.BASE || {}).rev === 2800, String((window.BASE || {}).rev));
    A('…and its Revenue card reads $2,800 (bug: $0)', ((d.getElementById('sc-rev') || {}).textContent || '').trim() === '$2,800', (d.getElementById('sc-rev') || {}).textContent);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-29b Scenario repaints when the books load)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
