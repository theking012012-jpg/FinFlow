'use strict';
/**
 * verify-f101-client-batch.js — EXECUTE (Rule 14) the F101 "done when": a full reconciliation costs
 * a bounded, small number of write requests REGARDLESS of item count. Boots the real SPA in jsdom,
 * intercepts window.fetch, stages 3 pairs via the live matchBankRec(), and asserts:
 *   - staging 3 pairs fires ZERO write POSTs (pre-fix: 3 — one /match per pairing);
 *   - Save fires EXACTLY ONE POST, to /match-batch, carrying all 3 pairs.
 * So N pairs → 1 write, not N. That is the property the single write-cap revisit depends on.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f101-client-batch.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    await settle(3, 100);

    if (typeof window.matchBankRec !== 'function' || typeof window.saveBankRecMatches !== 'function') {
      A('client bank-rec staging fns present (matchBankRec, saveBankRecMatches)', false,
        `matchBankRec=${typeof window.matchBankRec} saveBankRecMatches=${typeof window.saveBankRecMatches}`);
      throw new Error('staging functions not exposed');
    }
    A('client bank-rec staging fns present', true);

    // Intercept fetch and record write POSTs to the match endpoints.
    const writes = [];
    window.fetch = async (url, opts = {}) => {
      const u = String(url); const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST' && /\/api\/bank-reconciliation\/match(-batch)?$/.test(u)) {
        writes.push({ url: u, body: JSON.parse(opts.body || '{}') });
        return { ok: true, status: 201, json: async () => ({ matched: (JSON.parse(opts.body||'{}').matches||[]).length, skipped: 0, rows: [] }) };
      }
      // GET /api/bank-reconciliation (loadBankRec refresh) — minimal valid shape
      return { ok: true, status: 200, json: async () => ({ unmatched_bank: [], unmatched_payments: [], matched: [] }) };
    };

    // Stage 3 pairs (the same two-click interaction, three times).
    window.matchBankRec(101, 201); await settle(2, 40);
    window.matchBankRec(102, 202); await settle(2, 40);
    window.matchBankRec(103, 203); await settle(2, 40);
    A('staging 3 pairs fired ZERO write POSTs (pre-fix: 3, one /match each)', writes.length === 0,
      `writes so far = ${writes.length}`);

    // Save → one batch POST.
    await window.saveBankRecMatches(); await settle(2, 40);
    const only = writes.length === 1 ? writes[0] : null;
    A('Save fired EXACTLY ONE write POST', writes.length === 1, `write count = ${writes.length}`);
    A('the one POST went to /match-batch', !!only && /\/match-batch$/.test(only.url), only && only.url);
    A('the one POST carried ALL 3 pairs in a single request', !!only && Array.isArray(only.body.matches) && only.body.matches.length === 3,
      only && JSON.stringify(only.body));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F101 client batching, executed in jsdom)\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
