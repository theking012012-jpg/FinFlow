'use strict';
/**
 * verify-ap-report-vendor-credits.js — L51. The AP report put a vendor credit whose vendor had no open bill into one
 * "Unattributed credits" row, and its "N vendors" tile counted that row as a vendor (live: "2 vendors" with one vendor owed).
 * The AR side (server ar-by-customer) lists an unmatched credit note under its OWN customer as a negative balance — the two
 * subledger reports treated the same situation two ways. Fix (mirror AR): a vendor credit is listed under its vendor (negative
 * when that vendor has no open bill); "Unattributed credits" only when the credit names no vendor; the vendor count and
 * "Largest" consider vendors you actually owe (positive balances).
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes: bill Xeno 500 unpaid (07-01) · vendor credit Yarrow 250 Open (07-02).
 * HAND-COMPUTED: rows Xeno 500 · Yarrow −250 · Total Payable 250 · tile "1 vendor" · Largest Xeno 500.
 * BUGGY (pre-fix): rows Xeno 500 · "Unattributed credits" −250 · tile "2 vendors".
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-ap-report-vendor-credits.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(m)) return;
  throw e;
});

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

function renderedRows(doc) {
  const out = [];
  for (const d of doc.querySelectorAll('#rpt-body div')) {
    const sp = [...d.children].filter(c => c.tagName === 'SPAN');
    if (sp.length === 2 && d.children.length === 2) out.push({ label: sp[0].textContent.trim(), value: parseFloat(sp[1].textContent.replace(/[^\d.\-]/g, '')) });
  }
  return out;
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  L51 — AP report lists vendor credits under their vendor, counts only vendors owed\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http }) => {
      const J = async (p, b) => { const r = await http.post(p, b); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
      const ent = await J('/api/entities', { name: 'L51 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('/api/entities/' + ent.id + '/activate', {});
      await J('/api/bills', { vendor: 'Xeno', num: 'BX', amount: 500, status: 'unpaid', issue_date: '2026-07-01', due_date: '2026-08-01' });
      await J('/api/vendor-credits', { vendor: 'Yarrow', num: 'VC-1', amount: 250, date: '2026-07-02', status: 'Open' });
    } });
    const { window: w, settle } = ctx;
    await settle(40, 100);
    for (let i = 0; i < 250 && typeof w.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await w.generateReport('Accounts Payable'); await settle(25, 60);
    const rows = renderedRows(w.document);
    const txt = (w.document.getElementById('rpt-body') || {}).textContent.replace(/\s+/g, ' ');
    console.log('  [AP rendered] ' + rows.map(r => r.label + '=' + r.value).join(' | '));
    const v = l => { const f = rows.filter(r => r.label === l); return f.length === 1 ? f[0].value : NaN; };
    A('CONTROL: Total Payable 250 (500 − 250)', near(v('Total Payable'), 250), JSON.stringify(rows));
    A('Xeno row 500', near(v('Xeno'), 500), JSON.stringify(rows));
    A('the vendor credit is listed under its vendor: Yarrow −250 (bug: "Unattributed credits")', near(v('Yarrow'), -250) && !rows.some(r => /Unattributed/.test(r.label)), JSON.stringify(rows));
    A('tile counts vendors owed: "1 vendor" (bug: "2 vendors")', /\b1 vendor\b/.test(txt) && !/\b2 vendors\b/.test(txt), txt.slice(0, 160));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e instanceof AggregateError && e.errors) console.log('  aggregate: ' + e.errors.map(x => x.message).join(' | '));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (AP report vendor credits)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
