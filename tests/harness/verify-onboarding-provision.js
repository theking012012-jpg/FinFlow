#!/usr/bin/env node
'use strict';
/**
 * verify-onboarding-provision.js — ONBOARDING PROVISIONS THE FIRST ENTITY, SERVER-CONFIRMED,
 * AND IS ACTUALLY REACHABLE.
 *
 * WHAT WENT WRONG BEFORE — THREE defects, and the third makes the other two invisible:
 *
 *   1. NO ENTITY WAS EVER CREATED. finishOnboarding() PUT /api/settings and nothing else. A brand
 *      new user finished the wizard and landed in a workspace with ZERO entities — every figure
 *      blank, every "create invoice" refusing, because a document must be issued BY an entity.
 *      The business name they typed went into the ACCOUNT-wide settings blob, which is not an
 *      entity and books nothing. POST /api/auth/register inserts a `users` row and no entity
 *      either, so onboarding was the ONLY thing that could have provisioned one.
 *
 *   2. THE ONBOARDED FLAG WAS SET REGARDLESS OF THE OUTCOME. The single fetch sat inside
 *      `try{ ... }catch(e){}` — an EMPTY catch — and `localStorage.setItem('ff_onboarded','1')`
 *      ran unconditionally on the next line. A 500, a 402, a dropped connection: all produced the
 *      same cheerful "Your workspace is ready", and the wizard never came back (the flag is
 *      checked at parse time and short-circuits it). Not recoverable by the user, and invisible to
 *      us, because the empty catch swallowed the failure.
 *
 *   3. THE WIZARD WAS DESTROYED AT BOOT FOR EVERY AUTHENTICATED USER. finflow-api.js's ffOnAuth()
 *      — the AUTH-GATE teardown — also does `sessionStorage.setItem('ff_onboarded','1')` and
 *      `document.getElementById('ob-overlay').remove()`, UNCONDITIONALLY, for anyone `/api/me`
 *      says is logged in. Registration ends in `location.reload()`, so the new user's wizard is
 *      built at parse time and removed milliseconds later by the deferred bundle, every single
 *      load, forever. Defects 1 and 2 could never be observed because the screen containing them
 *      never survived boot. Nothing anywhere reads the server's settings.onboarding_done — the
 *      comment at index.html:4785 describes a "settings load handler" that does not exist.
 *
 * This is the CLAUDE.md dead-code-shadowing failure at the DOM layer instead of the function
 * layer: a clean diff, a passing build, and zero effect, because a later-loading file overwrites
 * the result. RULE 1 asks which copy of a FUNCTION wins; the same question has to be asked of the
 * SCREEN. [REACHABILITY] below is that question, executed.
 *
 * DISCRIMINATION (Rule 4) — the buggy value is named on every gate assertion:
 *
 *   assertion                                    PRE-FIX (buggy)       POST-FIX (correct)
 *   -------------------------------------------- --------------------- --------------------
 *   ob-overlay alive after boot settles           removed by ffOnAuth   present
 *   sessionStorage ff_onboarded after boot        '1' (suppressed)      null
 *   entities in Postgres after a clean finish     0                     1
 *   ff_onboarded after /api/entities fails 500    '1'  (locked out)     null (wizard stays)
 *   ff_onboarded after /api/settings net-fails    '1'  (locked out)     null (wizard stays)
 *   onboarding_done after a failed finish         1 or absent           absent
 *
 * Seed values are chosen so a passing run identifies WHICH source was read (Rule 4 corollary):
 * the business name, currency and country are each unlike every default in the codebase, so an
 * entity built from a hardcoded fallback cannot pass.
 *
 * FAILURE-PATH INJECTION (Rule 14). Both failure legs are EXECUTED, and they are DIFFERENT CODE
 * BRANCHES: a non-ok STATUS takes the `if(!res.ok)` branch, a NETWORK reject takes the `catch`.
 * jsdomBoot's failMap matches on pathname alone, which would also fail the BOOT reads of those
 * same paths and leave us asserting against a half-booted app, so injection here is installed
 * AFTER boot has settled and is METHOD-AWARE — it fails only the POST/PUT the wizard makes.
 *
 * ONE BOOT, ORDERED PHASES. bootSpaInJsdom cannot run twice in a process (the second boot dies on
 * "Cannot use a pool after calling end on the pool", the third on an EPERM against the still-locked
 * cluster directory). So the phases are ordered so each leaves the state the next one needs, and
 * the DB is reset between phases with SQL rather than by rebooting.
 *
 * Real scratch Postgres, real schema, real server, the real SPA in jsdom (Rule 3). Asserts on
 * executed values — DB rows, localStorage, DOM state — never on source text (Rule 5).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-onboarding-provision.js
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name))
                                : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

// Deliberately unlike every default in the codebase (the seed entity name, the USD boot default,
// and the first country in the select) so a value that arrives by accident cannot be mistaken for
// one that arrived by being typed.
const BIZ      = 'Meridian Freight Partners';
const OWNER    = 'Nadia Okonkwo';
const OB_EMAIL = 'nadia@meridian-freight.test';
const CURRENCY = 'EUR';        // not USD (the code default/base)
const COUNTRY  = 'PT';         // not the first option, not the seed's

// Wipe the base seed down to a genuine brand-new signup: no entity, no books, no settings row.
// That is the state a user reaching the wizard is actually in, and the entity-cap branch
// (trial: 1) only behaves realistically from zero.
const BLANK_SQL = `TRUNCATE invoices, expenses, bills, customers, inventory, payroll, holdings,
  entities, user_settings, payments_made, payments_received, sales_receipts, invoice_payments,
  payroll_runs, payroll_run_lines, inventory_movements, fx_rates, fx_transactions, audit_trail,
  vendors, items, journals, credit_notes, vendor_credits RESTART IDENTITY CASCADE`;

/**
 * Method-aware failure injection, installed post-boot. `mode` is a status number or 'network'.
 * Returns a function that removes the injection. Only the named METHOD+PATH is affected.
 */
function inject(window, method, path, mode) {
  const real = window.fetch;
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    let p; try { p = new URL(url, 'http://127.0.0.1/').pathname; } catch { p = String(url); }
    const m = (init.method || 'GET').toUpperCase();
    if (p === path && m === method) {
      if (mode === 'network') return Promise.reject(new TypeError(`Failed to fetch [injected: ${m} ${p}]`));
      return Promise.resolve(new window.Response(JSON.stringify({ error: `injected ${mode}` }),
        { status: mode, headers: { 'Content-Type': 'application/json' } }));
    }
    return real(input, init);
  };
  return () => { window.fetch = real; };
}

async function main() {
  let boot = null;
  try {
    boot = await bootSpaInJsdom({ seedExtra: async (c) => { await c.query(BLANK_SQL); } });
    const { window, client: c, userId, settle } = boot;
    const doc = window.document;
    await settle(40, 50);

    const entities = async () => (await c.query(
      `SELECT id, data->>'name' AS name, data->>'currency' AS currency, data->>'country' AS country
         FROM entities WHERE user_id = $1 ORDER BY id`, [userId])).rows;
    const settingsDone = async () => {
      const r = (await c.query(
        `SELECT data FROM user_settings WHERE user_id = $1 AND data->>'key' IS NULL LIMIT 1`, [userId])).rows[0];
      return r ? r.data.onboarding_done : undefined;
    };
    const lsFlag = () => { try { return window.localStorage.getItem('ff_onboarded'); } catch { return '<throw>'; } };
    const ssFlag = () => { try { return window.sessionStorage.getItem('ff_onboarded'); } catch { return '<throw>'; } };
    const toastText = () => { const t = doc.getElementById('notif-text'); return t ? (t.textContent || '').trim() : ''; };
    const stepActive = (n) => ((doc.getElementById('ob-s' + n) || {}).className || '').indexOf('active') !== -1;
    const fill = (over = {}) => {
      const v = Object.assign({ biz: BIZ, user: OWNER, email: OB_EMAIL, currency: CURRENCY, country: COUNTRY }, over);
      const set = (id, val) => { const el = doc.getElementById(id); if (el) el.value = val; return !!el; };
      return set('ob-biz-name', v.biz) && set('ob-user-name', v.user) && set('ob-email', v.email)
          && set('ob-currency', v.currency) && set('ob-country', v.country);
    };
    const resetAccount = async () => { await c.query(BLANK_SQL); };

    // ══ PHASE 0 — REACHABILITY. Does the screen survive boot at all? ═══════════════════════════
    // Everything after this is conditional on the wizard existing. If the overlay is gone, the
    // rest of the file is asserting against code that no user can reach — which is exactly the
    // state this product shipped in, and exactly what a green harness must never hide.
    A('precondition: the account has ZERO entities (a brand-new signup)', (await entities()).length === 0);
    A('[REACHABILITY] the onboarding wizard SURVIVES boot for a signed-in new user ' +
      '(pre-fix: ffOnAuth removed #ob-overlay at finflow-api.js:105 on every load)',
      !!doc.getElementById('ob-overlay'),
      'the #ob-overlay was removed during boot — onboarding is unreachable and every assertion ' +
      'below is about dead code');
    A('[REACHABILITY] boot did NOT pre-set the ff_onboarded suppressor ' +
      '(pre-fix: sessionStorage="1" at finflow-api.js:104, so the wizard never returns this session)',
      ssFlag() === null, `sessionStorage.ff_onboarded=${ssFlag()}`);
    A('[REACHABILITY] localStorage is likewise untouched before the user finishes',
      lsFlag() === null, `localStorage.ff_onboarded=${lsFlag()}`);

    // Snapshot the wizard while it exists. Later phases that COMPLETE onboarding correctly dismiss the
    // overlay (post-F197 the retry now succeeds and removes it); the single-boot harness can't rebuild
    // the wizard, so a completing phase must restore this snapshot before driving it again.
    const savedOverlayHTML = doc.getElementById('ob-overlay').outerHTML;
    const restoreWizard = () => {
      if (!doc.getElementById('ob-overlay')) doc.body.insertAdjacentHTML('beforeend', savedOverlayHTML);
      try { if (typeof window._obGotoStep === 'function') window._obGotoStep(1); } catch {}
    };

    if (!doc.getElementById('ob-overlay')) {
      console.log('\n  ABORTING the remaining phases: the wizard does not exist at runtime, so ' +
                  'driving it would prove nothing about what a user experiences.\n');
      console.log(`\n  ${fail} FAILED — ${pass} passed, ${fail} failed  (onboarding: server-confirmed entity provisioning)\n`);
      process.exitCode = 1;
      try { await boot.stop(); } catch {}
      return;
    }

    A('the wizard exposes a Country field (the new required input)', !!doc.getElementById('ob-country'));
    A('every step-1 input the wizard needs is present and fillable', fill());

    // ══ PHASE 1 — SKIP with the required minimum missing routes BACK, never forward ═══════════
    // Skip must not be a way to opt out of setup (that is how the empty workspace happened), and
    // must not be a dead end either: it puts the user on the step that can fix the problem.
    fill({ country: '' });
    window.skipOnboarding();
    await settle(20, 50);
    A('[SKIP] Skip with no country does NOT mark the user onboarded', lsFlag() === null, `flag=${lsFlag()}`);
    A('[SKIP] Skip with no country creates NO entity', (await entities()).length === 0,
      `rows=${JSON.stringify(await entities())}`);
    A('[SKIP] Skip with no country routes BACK to step 1 (not a dead end)', stepActive(1),
      `s1="${(doc.getElementById('ob-s1') || {}).className}"`);
    A('[SKIP] the wizard survives so the user can supply the country', !!doc.getElementById('ob-overlay'));

    // ══ PHASE 2 — walk the REAL wizard to the final step ══════════════════════════════════════
    fill();
    window.obNext(); window.obNext(); window.obNext();
    A('three Continues reach the final step (the step-1 validation gate let a complete form past)',
      stepActive(4), `s4="${(doc.getElementById('ob-s4') || {}).className}"`);

    // ══ PHASE 3 — FAILURE LEG 1: POST /api/entities → 500 (the `if(!res.ok)` branch) ═══════════
    let undo = inject(window, 'POST', '/api/entities', 500);
    window.obNext();                       // step 4's Continue == finishOnboarding
    await settle(25, 60);
    undo();
    A('[GATE-FAIL] entity create 500 → ff_onboarded is NOT set (pre-fix: "1", user locked out)',
      lsFlag() === null, `flag=${lsFlag()}`);
    A('[GATE-FAIL] entity create 500 → NO entity row was left behind', (await entities()).length === 0,
      `rows=${JSON.stringify(await entities())}`);
    A('[GATE-FAIL] entity create 500 → onboarding_done is NOT set server-side',
      !Number(await settingsDone()), `onboarding_done=${await settingsDone()}`);
    A('[GATE-FAIL] entity create 500 → the wizard is STILL UP so the user can retry',
      !!doc.getElementById('ob-overlay'));
    A('[GATE-FAIL] entity create 500 → the user is TOLD (pre-fix: an empty catch told nobody)',
      toastText().length > 0, `toast="${toastText()}"`);
    A('[GATE-FAIL] entity create 500 → the finish button is re-enabled for the retry',
      !(doc.getElementById('ob-next-btn') || {}).disabled);

    // ══ PHASE 4 — FAILURE LEG 2: PUT /api/settings rejects at the NETWORK level (`catch`) ══════
    // A DIFFERENT branch from leg 1 — the exact distinction that made four earlier boot-fetch
    // "pattern-mirror" fixes unexecuted. The entity POST is allowed through, so this also proves
    // the flag stays clear when the FIRST call succeeded and only the SECOND failed.
    undo = inject(window, 'PUT', '/api/settings', 'network');
    window.skipOnboarding();
    await settle(25, 60);
    undo();
    A('[GATE-FAIL] settings network-error → the entity WAS created (leg 1 of the pair succeeded)',
      (await entities()).length === 1, `rows=${JSON.stringify(await entities())}`);
    A('[GATE-FAIL] settings network-error → ff_onboarded is NOT set (pre-fix: "1")',
      lsFlag() === null, `flag=${lsFlag()}`);
    A('[GATE-FAIL] settings network-error → onboarding_done is NOT set server-side',
      !Number(await settingsDone()), `onboarding_done=${await settingsDone()}`);
    A('[GATE-FAIL] settings network-error → the wizard is STILL UP', !!doc.getElementById('ob-overlay'));

    // ══ PHASE 5 — THE RETRY, one minute later ═════════════════════════════════════════════════
    // Phase 4 left an entity behind and the user un-onboarded — exactly where a real user is after
    // a dropped connection. They will press the button again. The server's duplicate guard is
    // findRecentDuplicate's FIVE-SECOND window (server.js:1039, Rule 9), and the trial plan caps
    // entities at 1, so a retry OUTSIDE that window is a fresh CREATE against a full cap. Age the
    // row 60s to model "a minute later" deterministically instead of sleeping.
    await c.query(`UPDATE entities SET created_at = created_at - interval '60 seconds' WHERE user_id = $1`, [userId]);
    window.skipOnboarding();
    await settle(25, 60);
    const retryEnts = await entities();
    A('[RETRY] the retry still leaves exactly one entity (no duplicate business)',
      retryEnts.length === 1, `rows=${JSON.stringify(retryEnts)}`);
    A('[RETRY] a user whose connection dropped mid-finish CAN still complete onboarding',
      lsFlag() === '1' && Number(await settingsDone()) === 1,
      `ff_onboarded=${lsFlag()} onboarding_done=${await settingsDone()} toast="${toastText()}" — ` +
      `if this is red the retry was REFUSED (entity cap 402 outside the 5s dedupe window) and ` +
      `onboarding is a DEAD END for anyone whose first attempt half-completed`);

    // ══ PHASE 6 — the CLEAN happy path, from zero ═════════════════════════════════════════════
    // Reset to a pristine account and finish once, cleanly, so the provisioning assertions are not
    // reading a row that a failure leg happened to leave behind.
    await resetAccount();
    try { window.localStorage.removeItem('ff_onboarded'); } catch {}
    try { window.sessionStorage.removeItem('ff_onboarded'); } catch {}
    A('phase 6 precondition: the account is empty again', (await entities()).length === 0);
    restoreWizard();   // the retry phase completed and dismissed the overlay — rebuild it for a clean run
    fill();
    window.skipOnboarding();
    await settle(30, 60);

    const rows = await entities();
    A('[GATE] finishing onboarding created EXACTLY ONE entity (pre-fix: 0 — no entity was ever made)',
      rows.length === 1, `rows=${JSON.stringify(rows)}`);
    A('[GATE] the entity carries the TYPED name, currency and country (not a default)',
      rows.length === 1 && rows[0].name === BIZ && rows[0].currency === CURRENCY && rows[0].country === COUNTRY,
      `name="${rows[0] && rows[0].name}" cur="${rows[0] && rows[0].currency}" country="${rows[0] && rows[0].country}"`);
    const done = await settingsDone();
    A('[GATE] onboarding_done is persisted SERVER-side, not only in the browser',
      Number(done) === 1, `onboarding_done=${done}`);
    const st = (await c.query(
      `SELECT data FROM user_settings WHERE user_id = $1 AND data->>'key' IS NULL LIMIT 1`, [userId])).rows[0];
    A('the account settings blob also stored the business name and currency',
      !!st && st.data.business_name === BIZ && st.data.currency === CURRENCY,
      `settings=${JSON.stringify(st && st.data)}`);
    A('ff_onboarded is set only once BOTH round-trips succeeded', lsFlag() === '1', `flag=${lsFlag()}`);
    await settle(10, 50);
    A('the wizard overlay is dismissed on success', !doc.getElementById('ob-overlay'));

    // A repeated finish must not create a SECOND business.
    window.skipOnboarding();
    await settle(20, 50);
    A('a repeated finish does NOT create a second entity', (await entities()).length === 1,
      `rows=${JSON.stringify(await entities())}`);

  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e && e.errors) console.error('  AggregateError.errors:', e.errors.map(x => x && x.message));
    fail++;
  } finally { try { if (boot) await boot.stop(); } catch {} }

  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (onboarding: server-confirmed entity provisioning)\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}
main();
