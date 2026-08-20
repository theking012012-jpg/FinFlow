'use strict';
/**
 * verify-f147-plan-on-restore.js (Rule 14) — a page RELOAD boots the SPA through the session-restore
 * path (finflow-api-wiring-final.js → GET /api/auth/me), NOT doLogin. That path previously set
 * neither currentUserPlan nor CURRENT_USER, so a business user was silently re-gated at the trial
 * entity cap (1) and got the "requires Business" modal. jsdomBoot authenticates over HTTP then boots
 * jsdom with the session cookie — so it exercises exactly this restore path.
 *
 * Seed the user as BUSINESS, boot, and assert the restored client state reflects business.
 * Discriminator: pre-fix, window.CURRENT_USER is never set on restore and the plan label stays blank
 * / trial; post-fix it reads 'business'.
 *
 *   node -r ./tests/harness/clock.js -r /tmp/pg-shim.cjs tests/harness/verify-f147-plan-on-restore.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]);
      },
    });
    const { window, settle } = boot;
    await settle(40, 40);
    const doc = window.document;

    A('_applySessionUser setter exists', typeof window._applySessionUser === 'function');
    A('CURRENT_USER is set after session-restore (was unset pre-fix)', !!window.CURRENT_USER && typeof window.CURRENT_USER === 'object');
    A('restored plan is business (not the trial default)', window.CURRENT_USER && window.CURRENT_USER.plan === 'business',
      `CURRENT_USER.plan = ${window.CURRENT_USER && window.CURRENT_USER.plan}`);
    const label = (doc.getElementById('sb-user-plan') || {}).textContent || '';
    A('sidebar plan label reads "Business plan"', label === 'Business plan', `label = "${label}"`);

    // The gate itself: with business applied, the 1-entity default cap must NOT be the trial cap.
    // _applySessionUser drives currentUserPlan; prove the setter re-applies a DIFFERENT plan too.
    window._applySessionUser({ plan: 'trial' });
    const trialLabel = (doc.getElementById('sb-user-plan') || {}).textContent || '';
    A('setter re-applies plan (trial) — proves it is the single source', trialLabel === 'Trial plan', `label = "${trialLabel}"`);
    window._applySessionUser({ plan: 'business' }); // restore

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
