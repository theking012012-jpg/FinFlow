'use strict';
/**
 * verify-f151b-switch-splash.js (Rule 14)
 *
 * Entity SWITCHING blinked: switchEntity changes currency/brand immediately while the previous
 * entity's numbers are still in memory, so an intermediate render pairs the OLD entity's figures with
 * the NEW currency (Saige's 206K shown in Acme/TTD). Fix: switchEntity re-shows the boot splash, lifted
 * on network-idle once the new entity's data settles — so that mismatched frame is never seen.
 *
 * Seeds E1 (data-bearing) ACTIVE + E2 (empty). After boot (dashboard = E1's data), switch to E2 and
 * assert:
 *   1) the splash RE-SHOWS synchronously when the switch starts (covers the transition)
 *   2) after the switch settles, the splash is hidden again
 *   3) the dashboard now shows E2's figures (0), never leaving E1's numbers under E2
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f151b-switch-splash.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
const num = (s) => { const m = String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''); return m === '' ? NaN : parseFloat(m); };

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]);
        // Seeded entity (E1) stays active + data-bearing; add an EMPTY inactive E2.
        await c.query(
          `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
           VALUES ($1, NULL, $2, NOW(), NOW())`,
          [uid, JSON.stringify({ name: 'Empty Co Two', currency: 'TTD', is_active: 0, sort_order: 1 })]
        );
      },
    });
    const { window, settle } = boot;
    const doc = window.document;
    await settle(70, 60);

    const splash = doc.getElementById('ff-splash');
    A('after boot: splash hidden', splash && splash._ffHidden === true);
    A('_showBootSplash API present', typeof window._showBootSplash === 'function');

    const ents = window.ENTITIES || [];
    const e2idx = ents.findIndex(e => e && e.name === 'Empty Co Two');
    A('found E2 in client ENTITIES', e2idx >= 0, `ENTITIES=${ents.map(e=>e&&e.name).join('|')}`);

    const revBefore = num((doc.getElementById('d-rev') || {}).textContent);
    A('boot shows E1 data (revenue > 0 before switch)', revBefore > 0, `#d-rev before="${(doc.getElementById('d-rev')||{}).textContent}"`);

    // Fire the switch WITHOUT awaiting — the synchronous head of switchEntity should re-show the splash.
    const p = window.switchEntity(e2idx);
    A('switch re-shows the splash immediately (covers the transition)', splash && splash._ffHidden === false && splash.style.display === 'flex', `hidden=${splash&&splash._ffHidden} display=${splash&&splash.style.display}`);

    await p; await settle(40, 60);

    A('switch bumped the stale-response generation token', (window._entitySwitchSeq || 0) > 0, `seq=${window._entitySwitchSeq}`);
    A('after switch settles: splash hidden again', splash && splash._ffHidden === true, `hidden=${splash&&splash._ffHidden}`);
    const revAfter = num((doc.getElementById('d-rev') || {}).textContent);
    A('dashboard now shows E2 (empty → 0), not E1 stale numbers', revAfter === 0, `#d-rev after="${(doc.getElementById('d-rev')||{}).textContent}"`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (F151b switch splash)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
