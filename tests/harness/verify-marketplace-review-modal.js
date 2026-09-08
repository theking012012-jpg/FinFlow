'use strict';
/**
 * verify-marketplace-review-modal.js — the marketplace review/report actions must capture the user's
 * ACTUAL input, not a hardcoded value. Before the fix, leaveReview() always POSTed rating:5 with an
 * empty comment and reportAccountant() always sent a canned reason. This boots the real SPA in jsdom
 * and drives window._marketModal to prove:
 *   - a rating modal REQUIRES a star pick (OK is a no-op until one is chosen) and returns the CHOSEN
 *     rating (3), never a silent 5;
 *   - a required-text modal REQUIRES text before it resolves;
 *   - cancel resolves null (nothing submitted).
 *   node -r ./tests/harness/clock.js tests/harness/verify-marketplace-review-modal.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let ctx, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    ctx = await bootSpaInJsdom({});
    const { window, settle } = ctx;
    await settle(6, 50);
    const doc = window.document;

    A('window._marketModal is defined', typeof window._marketModal === 'function');

    // ── rating modal: pick 3 stars, submit → resolves {rating:3} (NOT a hardcoded 5) ──
    const p = window._marketModal({ title: 'Review', rating: true });
    await settle(3, 20);
    const ov = [...doc.querySelectorAll('div')].find(d => d.querySelector && d.querySelector('#mm-stars'));
    A('rating modal opened with a star picker', !!ov);
    const okBtn = doc.querySelector('#mm-ok');
    // OK before choosing a star must NOT resolve (rating required)
    okBtn.click();
    let settledEarly = await Promise.race([p.then(() => true), new Promise(r => setTimeout(() => r(false), 150))]);
    A('OK with no star chosen does NOT submit (rating required)', settledEarly === false);
    // choose 3 stars, then OK
    const star3 = doc.querySelector('#mm-stars span[data-v="3"]');
    star3.click();
    doc.querySelector('#mm-ok').click();
    const res = await p;
    A('modal returns the CHOSEN rating (3), not a hardcoded 5', res && res.rating === 3, JSON.stringify(res));

    // ── required-text modal (report): empty text blocked, then accepted ──
    const p2 = window._marketModal({ title: 'Report', requireText: true });
    await settle(3, 20);
    doc.querySelector('#mm-ok').click();
    let early2 = await Promise.race([p2.then(() => true), new Promise(r => setTimeout(() => r(false), 150))]);
    A('report modal blocks submit with no text', early2 === false);
    doc.querySelector('#mm-text').value = 'Invoice never arrived';
    doc.querySelector('#mm-ok').click();
    const res2 = await p2;
    A('report modal returns the typed reason', res2 && res2.text === 'Invoice never arrived', JSON.stringify(res2));

    // ── cancel resolves null (nothing submitted) ──
    const p3 = window._marketModal({ title: 'X', rating: true });
    await settle(3, 20);
    doc.querySelector('#mm-cancel').click();
    const res3 = await p3;
    A('cancel resolves null (no submission)', res3 === null);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (marketplace review/report modal)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (ctx) await ctx.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
