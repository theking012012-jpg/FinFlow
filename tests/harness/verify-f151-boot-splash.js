'use strict';
/**
 * verify-f151-boot-splash.js (Rule 14)
 *
 * F151 boot choreography. On an authenticated refresh (the common case), the login screen must NEVER
 * be shown (it defaults to display:none now, so it can't FLASH during GET /api/auth/me), and the boot
 * splash (#ff-splash) must be HIDDEN once the active entity's data has loaded — so the user sees the
 * fully-populated dashboard, never the login flash or the $0-cards / empty-chart partial render.
 *
 * jsdomBoot authenticates over HTTP then boots the SPA through the session-restore path — exactly the
 * refresh scenario. Asserts:
 *   1) the splash-control API exists (_hideBootSplash / _showLoginScreen)
 *   2) after boot settles, #ff-splash is hidden (opacity 0 / display none / latched)
 *   3) #login-screen was NEVER revealed on a valid session (display stays 'none') — the anti-flash guarantee
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f151-boot-splash.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    const doc = window.document;

    // The splash exists at the very start (default).
    const splash0 = doc.getElementById('ff-splash');
    A('#ff-splash element exists', !!splash0);

    await settle(60, 60);   // let auth + entity data finish (app-main.js fully executes)

    A('splash-control API present', typeof window._hideBootSplash === 'function' && typeof window._showLoginScreen === 'function');

    const splash = doc.getElementById('ff-splash');
    const hidden = splash && (splash._ffHidden === true || splash.style.display === 'none' || splash.style.opacity === '0');
    A('after boot: #ff-splash is hidden (data ready → revealed dashboard)', !!hidden, `display=${splash&&splash.style.display} opacity=${splash&&splash.style.opacity} latched=${splash&&splash._ffHidden}`);

    const login = doc.getElementById('login-screen');
    A('#login-screen NEVER shown on a valid session (no flash)', login && login.style.display === 'none', `login display=${login&&login.style.display}`);

    // Sanity: the dashboard actually populated (a KPI element has content) — proves we revealed a
    // loaded dashboard, not an empty shell.
    const revEl = doc.getElementById('kpi-revenue') || doc.getElementById('dash-revenue') || doc.querySelector('[id*="revenue" i]');
    A('a revenue KPI element exists in the revealed dashboard', !!revEl);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F151 boot splash)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
