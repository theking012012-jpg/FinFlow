'use strict';
/**
 * verify-f137-balance-sheet-report.js — PROVE (Rule 14) that the Balance Sheet report renders an
 * ACTUAL balance sheet (Assets / Liabilities incl. Accounts Payable / Equity) from the canonical
 * /api/reports/balance-sheet endpoint — not the generic P&L overview every report used to show
 * (F137). Also the visible-AP surface F135 lacked.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f137-balance-sheet-report.js
 *
 * Boots the REAL SPA in jsdom (real bundle → the shipped window.generateReport winner) against a real
 * seeded scratch Postgres + real server, seeds a paid + an unpaid bill, drives generateReport('Balance
 * Sheet'), and reads the rendered modal — then compares the rendered Accounts Payable / Accounts
 * Receivable against the server's own balance-sheet response.
 *
 * EXPECTED:
 *   CURRENT bundle — generic modal: body has "incl. bills & payroll" / "Net Profit", NO "Accounts
 *     Payable" / "Total Liabilities" / "Equity" → FAIL.
 *   FIXED bundle — body is a real balance sheet: "Accounts Payable" present, rendered AP === server AP,
 *     rendered AR === server AR, no generic P&L tell → ALL GREEN.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(m)) return;
  throw e;
});

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        const ins = (data) => c.query(
          `INSERT INTO bills (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
          [uid, data]
        );
        // Paid bill (amount_paid set — post-F135) → contributes 0 to AP. Unpaid → contributes 500.
        await ins({ vendor: 'F137 Paid',   num: 'BILL-7001', amount: 1300, status: 'paid',   issue_date: '2026-07-10', due_date: '2026-07-31', amount_paid: 1300 });
        await ins({ vendor: 'F137 Unpaid', num: 'BILL-7002', amount: 500,  status: 'unpaid', issue_date: '2026-07-10', due_date: '2026-07-31' });
      },
    });
    const { window, http, settle } = boot;

    for (let i = 0; i < 250 && typeof window.generateReport !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(12, 100);
    A('runtime winner present: window.generateReport', typeof window.generateReport === 'function');

    // The server's canonical balance sheet — the oracle the rendered modal must match.
    const srv = await http.post('/api/reports/balance-sheet', {});
    const srvAP = Number(srv.json?.accountsPayable);
    const srvAR = Number(srv.json?.accountsReceivable);
    console.log(`  [server balance-sheet] AP=${srvAP}  AR=${srvAR}  equity=${srv.json?.equity}  cashTracked=${srv.json?.cashTracked}`);

    await window.generateReport('Balance Sheet');
    await settle(25, 60);

    const bodyEl = window.document.getElementById('rpt-body');
    const txt = bodyEl ? (bodyEl.textContent || '') : '';
    console.log(`  [rendered body] ${txt.replace(/\s+/g, ' ').trim().slice(0, 220)}`);

    // ── content is a balance sheet, not the generic P&L overview ──
    A('body shows "Accounts Payable" (balance-sheet content, not the generic modal)',
      /Accounts Payable/i.test(txt), 'no "Accounts Payable" — still the generic P&L modal');
    A('body shows Assets + Liabilities + Equity sections',
      /Total Assets/i.test(txt) && /Total Liabilities/i.test(txt) && /Equity/i.test(txt), `txt=${txt.slice(0,160)}`);
    A('body does NOT contain the generic P&L tell ("incl. bills")',
      !/incl\.\s*bills/i.test(txt), 'generic P&L overview still rendering');

    // ── rendered figures match the server (fidelity; also the visible AP surface for F135) ──
    // The UI formats money via the app's own native formatter (compact, e.g. $1.6K), so compare the
    // rendered cell against that same formatter applied to the server value — display-to-display.
    const fmt = (typeof window._fmtMoneyNative === 'function')
      ? window._fmtMoneyNative
      : (n) => '$' + (parseFloat(n) || 0).toFixed(2);
    const flat = txt.replace(/\s+/g, '');
    const wantAP = String(fmt(srvAP)).replace(/\s+/g, '');
    const wantAR = String(fmt(srvAR)).replace(/\s+/g, '');
    A('rendered Accounts Payable cell === app-formatted server accountsPayable',
      flat.includes('AccountsPayable' + wantAP), `want "AccountsPayable${wantAP}" in body (server AP=${srvAP})`);
    A('rendered Accounts Receivable cell === app-formatted server accountsReceivable',
      flat.includes('AccountsReceivable' + wantAR), `want "AccountsReceivable${wantAR}" in body (server AR=${srvAR})`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
