'use strict';
/* F132 client (jsdom) — expired trial: app renders (no blocking gate), persistent banner, honest
 * plan badge, and the write-402 upgrade prompt is DISMISSABLE (lands back on read-only books). */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`UPDATE users SET data = data || '{"trial_ends":"2026-07-01T00:00:00.000Z"}'::jsonb WHERE id=$1`, [uid]);
      },
    });
    const { window, settle } = boot;
    await settle();
    const doc = window.document;
    A('boot: no blocking paywall gate (reads succeed -> app renders real data)', !doc.getElementById('ff-trial-gate'), 'ff-trial-gate present on boot');
    // currentUserPlan is a top-level `let` → lives in the lexical global, NOT on window (ES6). Read
    // it via window.eval so the assertion sees the real value, not undefined.
    let plan; try { plan = window.eval('typeof currentUserPlan !== "undefined" ? currentUserPlan : null'); } catch (_) { plan = 'eval-failed'; }
    A('currentUserPlan resolves to "trial", never "pro" (badge honesty)', plan === 'trial', `got ${plan}`);
    const banner = doc.getElementById('trial-banner');
    A('persistent trial-ended banner rendered', !!banner && /ended|make changes/i.test(banner.textContent || ''), `banner=${banner ? JSON.stringify((banner.textContent||'').slice(0,90)) : 'none'}`);
    window._ffShowTrialExpired('Your free trial has ended. Upgrade to make changes.');
    A('write-402 opens the upgrade prompt', !!doc.getElementById('ff-trial-gate'));
    const dz = doc.getElementById('ff-trial-dismiss');
    A('prompt has a dismiss ("Keep viewing") control', !!dz);
    if (dz) dz.click();
    A('dismiss removes the prompt -> back to read-only books (not stuck)', !doc.getElementById('ff-trial-gate') && window._ffTrialExpiredActive === false, `active=${window._ffTrialExpiredActive}`);
    A('startUpgrade wired (real /api/stripe/checkout path)', typeof window.startUpgrade === 'function');
    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
