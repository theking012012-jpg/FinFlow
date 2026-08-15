#!/usr/bin/env node
'use strict';
/**
 * verify-f111-ui-render.js — EXECUTE the F111 client UI in jsdom (was inspection-only). Loads the
 * real index.html SPA as a login that is an ACTIVE MEMBER of another account, and asserts the
 * boot-time loadMyAccess() actually renders:
 *   · the app-wide #scoped-banner (shown, naming the account being operated in), and
 *   · the "Accounts you can access" panel (#my-access-list) listing own + the joined account,
 * and that the (previously fake) updateAccPermission toggle now calls the REAL access endpoint.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f111-ui-render.js
 *
 * bootSpaInJsdom runs index.html with runScripts:'dangerously', so the inline loadMyAccess() +
 * DOMContentLoaded fire against the real server; reqLog captures the toggle's PUT.
 *
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let h, pass = 0, fail = 0;
  const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
  try {
    // The seeded SPA login (jsdomBoot LOGIN) becomes an ACTIVE ADMIN member of a SECOND account.
    h = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        const ownerB = (await c.query(
          `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
          [{ email: 'ownerb@finflow.test', name: 'Owner B', role: 'owner' }]
        )).rows[0].id;
        await c.query(
          `INSERT INTO team_members (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`,
          [ownerB, { member_user_id: String(uid), status: 'active', role: 'admin', name: 'Seed Owner', email: require('./jsdomBoot.js').LOGIN.email }]
        );
      },
    });
    await h.settle(80, 100);
    const w = h.window;
    const disp = (id) => { const el = w.document.getElementById(id); return el ? (w.getComputedStyle ? el.style.display : el.style.display) : 'MISSING'; };

    console.log('\n' + '='.repeat(78));
    console.log('  F111 UI RENDER — scoped banner + access panel (real index.html in jsdom)');
    console.log('='.repeat(78));

    // ── 1 · the scoped-session banner is shown and names the account being operated in ──
    const banner = w.document.getElementById('scoped-banner');
    A('#scoped-banner exists in the DOM', !!banner);
    A('#scoped-banner is SHOWN (member is scoped into another account)', banner && banner.style.display === 'block',
      `display=${banner && banner.style.display}`);
    const bn = h.text('scoped-banner-name');
    A('banner names the account owner ("Owner B")', bn === 'Owner B', `banner-name=${JSON.stringify(bn)}`);

    // ── 2 · the "Accounts you can access" panel rendered own + the joined account ──
    const listHtml = ((w.document.getElementById('my-access-list') || {}).innerHTML) || '';
    A('#my-access-list rendered (not the "Loading…" placeholder)', listHtml && !/Loading/.test(listHtml), `html=${listHtml.slice(0,120)}`);
    A('panel shows the joined account (Owner B) and the own account',
      /Owner B/.test(listHtml) && /Your own account/.test(listHtml), `html=${listHtml.slice(0,200)}`);

    // ── 3 · the access toggle now calls the REAL endpoint (was a fake notification) ──
    const before = h.reqLog.filter(r => r.method === 'PUT' && /\/api\/accountants\/my-accountant\/access/.test(r.path)).length;
    if (typeof w.updateAccPermission === 'function') { await w.updateAccPermission('filing', true); await h.settle(20, 100); }
    const after = h.reqLog.filter(r => r.method === 'PUT' && /\/api\/accountants\/my-accountant\/access/.test(r.path)).length;
    A('updateAccPermission("filing") issues a real PUT to the access endpoint (not fake)', after > before,
      `PUTs before=${before} after=${after}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (F111 UI render)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } catch (e) {
    console.error('[f111-ui] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail++;
  } finally {
    try { if (h && h.stop) await h.stop(); } catch (_) {}
  }
  process.exit(fail === 0 ? 0 : 1);
})();
