'use strict';
/**
 * verify-f106-client-controls.js — EXECUTE (Rule 14) the client half of F106: Run History renders
 * the right remove control per status (Delete for draft, Void for approved/paid, NEITHER for a
 * voided run), and clicking Void fires a single PUT to /void. Runtime winner is index.html (no
 * wiring override).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f106-client-controls.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(3, 100);

    if (typeof window.loadPayrollRuns !== 'function' || typeof window.voidPayrollRun !== 'function' || typeof window.deletePayrollRun !== 'function') {
      A('client fns present (loadPayrollRuns, voidPayrollRun, deletePayrollRun)', false,
        `load=${typeof window.loadPayrollRuns} void=${typeof window.voidPayrollRun} del=${typeof window.deletePayrollRun}`);
      throw new Error('fns missing');
    }

    const runs = [
      { id: 1, status: 'draft',    period: '2026-07', run_date: '2026-07-15', total_gross: 5000, total_net: 5000 },
      { id: 2, status: 'approved', period: '2026-06', run_date: '2026-06-15', total_gross: 5000, total_net: 5000 },
      { id: 3, status: 'voided',   period: '2026-05', run_date: '2026-05-15', total_gross: 5000, total_net: 5000 },
    ];
    const writes = [];
    window.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (m === 'PUT' && /\/api\/payroll-runs\/\d+\/void$/.test(u)) { writes.push(u); return { ok: true, status: 200, json: async () => ({ status: 'voided' }) }; }
      if (m === 'DELETE' && /\/api\/payroll-runs\/\d+$/.test(u)) { writes.push(u); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
      if (/\/api\/payroll-runs$/.test(u)) return { ok: true, status: 200, json: async () => runs };
      return { ok: true, status: 200, json: async () => ([]) };
    };

    // Ensure the render target exists, then render.
    if (!window.document.getElementById('payroll-runs-list')) {
      const d = window.document.createElement('div'); d.id = 'payroll-runs-list'; window.document.body.appendChild(d);
    }
    await window.loadPayrollRuns(); await settle(2, 60);
    const html = window.document.getElementById('payroll-runs-list').innerHTML;

    A('draft row shows Delete (not Void)', /deletePayrollRun\(1\)/.test(html) && !/voidPayrollRun\(1\)/.test(html), html.slice(0, 0));
    A('approved row shows Void (not Delete)', /voidPayrollRun\(2\)/.test(html) && !/deletePayrollRun\(2\)/.test(html));
    A('voided row shows NEITHER control (terminal state)', !/voidPayrollRun\(3\)/.test(html) && !/deletePayrollRun\(3\)/.test(html));
    A('voided badge rendered', /voided/.test(html));

    // Clicking Void fires exactly one PUT to /void (confirm auto-accepted).
    window.confirm = () => true;
    window._confirmModal = () => Promise.resolve(true);   // C2: void/delete now use the in-app modal
    writes.length = 0;
    await window.voidPayrollRun(2); await settle(2, 60);
    A('voidPayrollRun(2) → exactly one PUT to /api/payroll-runs/2/void', writes.length === 1 && /\/api\/payroll-runs\/2\/void$/.test(writes[0]), `writes=${JSON.stringify(writes)}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F106 client, executed in jsdom)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
