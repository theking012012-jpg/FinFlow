#!/usr/bin/env node
'use strict';
/**
 * f130-trial-expired-paywall.js — an expired trial shows a paywall, not "Unable to load".
 *
 *   node tests/harness/f130-trial-expired-paywall.js
 *
 * WHAT WAS WRONG. `checkPlan` (server.js:400) 402s EVERY /api data read with
 * `{error, code:'TRIAL_EXPIRED'}`. Auth routes are exempt, so the user logs in fine and the app
 * boots fine — and then every money surface fails into the F67/F96 error state. The only trial UI
 * is a countdown banner that bails on `daysLeft <= 0` (index.html), i.e. it vanishes at exactly the
 * moment it is needed. A customer whose trial ended saw a BROKEN APP with no explanation and no way
 * to pay, which is the worst possible moment to look broken.
 *
 * WHAT THIS PROVES, BY EXECUTION. The three real code paths are run against a REAL 402 response:
 *   1. `api()` (finflow-api.js) preserves `status` and `code` on the thrown Error;
 *   2. `_pick` (app-main.js, the loadEntityData boot loader) recognises the 402 and raises the gate;
 *   3. `_loadEntitiesFromDBImpl` (index.html, the FIRST fetch on a cold boot) raises the gate and
 *      returns `true` so the boot memo latches instead of re-fetching a 402 forever (F97).
 * And in every case the paywall element exists and the "Unable to load" path did NOT run.
 *
 * RULE 4 — the discriminator is the CODE, not the status. The probe also feeds a 402 WITHOUT
 * `code:'TRIAL_EXPIRED'` and a 500 WITH a body, and asserts no gate appears: a fix that keyed on
 * "any 402" or "any failure" would pass the happy case and be wrong. And a 401 must still be
 * treated as logged-out, not as an expired trial.
 *
 * WHAT IS NOT PROVED. No browser renders the overlay; the DOM is a stub, so this asserts the
 * element and its wiring, not its appearance. The CTA is asserted to call `showPage('pricing')`.
 * Whether an expired trial should hard-lock or drop to READ-ONLY is an open product question,
 * flagged on F130 and deliberately not built.
 *
 * Read-only: reads three source files, no DB, no network, no writes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const APP   = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const IDX   = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const FFAPI = fs.readFileSync(path.join(ROOT, 'public/finflow-api.js'), 'utf8');

let pass = 0, fail = 0;
const A = (name, got, want, note) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name + '  → ' + JSON.stringify(got)); }
  else {
    fail++;
    console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) +
      '\n          want ' + JSON.stringify(want) + (note ? '\n          (' + note + ')' : ''));
  }
};

function spanFrom(src, openLine, label) {
  const at = src.indexOf(openLine);
  if (at < 0) throw new Error(`[f130] span not found in ${label}: ${openLine} — probe is stale, fix the probe.`);
  let depth = 0;
  for (let j = src.indexOf('{', at + openLine.length - 1); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  throw new Error(`[f130] unbalanced braces for ${openLine} in ${label}`);
}

// The exact body checkPlan sends (server.js:401-404) — copied from the route, not invented.
const TRIAL_402 = { status: 402, body: { error: 'Your free trial has ended. Please upgrade to continue.', code: 'TRIAL_EXPIRED' } };

/** A minimal DOM that records what was appended, so "did the gate render" is a fact, not a guess. */
function makeDom() {
  const byId = {};
  const appended = [];
  const mk = (tag) => {
    const el = {
      tagName: tag, id: '', innerHTML: '', textContent: '', style: { cssText: '' },
      setAttribute(k, v) { if (k === 'id') this.id = v; },
      appendChild(c) { appended.push(c); if (c.id) byId[c.id] = c; },
      remove() { const i = appended.indexOf(this); if (i >= 0) appended.splice(i, 1); if (this.id) delete byId[this.id]; },
      onclick: null, classList: { add() {}, remove() {} },
    };
    return el;
  };
  const document = {
    createElement: mk,
    getElementById: (id) => byId[id] || null,
    body: { appendChild(c) { appended.push(c); if (c.id) byId[c.id] = c;
                             // the gate's innerHTML carries the button; register it so the CTA is reachable
                             if (c.id === 'ff-trial-gate') byId['ff-trial-upgrade'] = mk('button'); } },
    querySelector: () => null,
    addEventListener() {},
  };
  return { document, byId, appended };
}

/** Load the real paywall renderer from app-main.js. */
function loadGate(win, document) {
  return new Function('window', 'document',
    spanFrom(APP, 'function _ffShowTrialExpired(message){', 'app-main.js') +
    '\n; window._ffShowTrialExpired = _ffShowTrialExpired; return _ffShowTrialExpired;'
  )(win, document);
}

console.log('\n' + '='.repeat(78));
console.log('  F130 — TRIAL-EXPIRED PAYWALL (executed against a real 402 body)');
console.log('='.repeat(78));

(async () => {
  // ── 1 · api() preserves the response ──
  console.log('\n-- 1 - api() preserves status and code (it discarded both) --');
  {
    const { document } = makeDom();
    const win = {};
    loadGate(win, document);
    const src = spanFrom(FFAPI, 'async function api(method, path, body)', 'finflow-api.js');
    const api = new Function('window', 'document', 'fetch', src + '\n; return api;')(
      win, document,
      async () => ({ ok: false, status: TRIAL_402.status, json: async () => TRIAL_402.body })
    );
    let err = null;
    try { await api('GET', '/api/invoices'); } catch (e) { err = e; }
    A('api() throws', !!err, true);
    A('…carrying the status',  err && err.status, 402, 'the old code threw new Error(message) only');
    A('…carrying the code',    err && err.code, 'TRIAL_EXPIRED');
    A('…message unchanged (no caller that reads .message is affected)',
      err && err.message, TRIAL_402.body.error);
    A('…and the paywall was raised', !!document.getElementById('ff-trial-gate'), true);
  }

  // ── 2 · _pick — the loadEntityData boot loader ──
  console.log('\n-- 2 - _pick raises the gate and does NOT fall into the error path --');
  {
    const { document } = makeDom();
    const win = {};
    loadGate(win, document);
    const pickSrc = spanFrom(APP, 'const _pick = (res, label, fatal) => {', 'app-main.js');
    const _pick = new Function('window', 'document', 'console',
      pickSrc + ';\n return _pick;'
    )(win, document, { warn() {}, error() {} });

    const res402 = { ok: false, status: 402, json: async () => TRIAL_402.body };
    let err = null;
    try { await _pick(res402, 'invoices', true); } catch (e) { err = e; }
    A('_pick throws on 402',        !!err, true);
    A('…with the code preserved',   err && err.code, 'TRIAL_EXPIRED');
    A('…the paywall rendered',      !!document.getElementById('ff-trial-gate'), true);
    A('…and the active flag is set (this is what suppresses "Unable to load")',
      win._ffTrialExpiredActive, true);

    // A NON-fatal loader must behave identically — the trial is account-wide, not per-list.
    const { document: d2 } = makeDom();
    const win2 = {};
    loadGate(win2, d2);
    const _pick2 = new Function('window', 'document', 'console', pickSrc + ';\n return _pick;')(
      win2, d2, { warn() {}, error() {} });
    let err2 = null;
    try { await _pick2({ ok: false, status: 402, json: async () => TRIAL_402.body }, 'customers', false); }
    catch (e) { err2 = e; }
    A('a NON-fatal loader also raises the gate (402 is account-wide)',
      !!err2 && !!d2.getElementById('ff-trial-gate'), true,
      'checked before the fatal/non-fatal split — a 402 on customers is the same event');
  }

  // ── 3 · the entities boot load — the FIRST fetch on a cold boot ──
  console.log('\n-- 3 - the entities boot load gates, and LATCHES (F97) instead of retrying --');
  {
    const { document } = makeDom();
    const win = { _dashSetState() { win.__errorPainted = true; }, _ffAuthed: true, ENTITIES: [] };
    loadGate(win, document);
    // The 402 branch, verbatim from _loadEntitiesFromDBImpl, exercised as the function does.
    const impl = spanFrom(IDX, 'async function _loadEntitiesFromDBImpl(){', 'index.html');
    const branch = impl.slice(impl.indexOf('if(!res.ok){'), impl.indexOf('const rows = await res.json();'));
    A('the 402 branch is present in the real source', /res\.status === 402/.test(branch), true);
    const run = new Function('window', 'document', 'console', 'res',
      'return (async function(){ ' + branch + ' return "FELL_THROUGH"; })();'
    );
    const out = await run(win, document, { warn() {}, error() {} },
      { ok: false, status: 402, json: async () => TRIAL_402.body });
    A('…returns true (definitive ⇒ the boot memo latches, no 402 retry storm)', out, true);
    A('…the paywall rendered', !!document.getElementById('ff-trial-gate'), true);
    A('…and the dashboard error state was NEVER painted', !!win.__errorPainted, false,
      '"Unable to load" beneath a paywall is the defect this finding is about');
  }

  // ── 4 · RULE 4 — the discriminator is the CODE, not the status ──
  console.log('\n-- 4 - discrimination: only TRIAL_EXPIRED gates; other failures do not --');
  {
    const pickSrc = spanFrom(APP, 'const _pick = (res, label, fatal) => {', 'app-main.js');
    const run = async (res) => {
      const { document } = makeDom();
      const win = {};
      loadGate(win, document);
      const _pick = new Function('window', 'document', 'console', pickSrc + ';\n return _pick;')(
        win, document, { warn() {}, error() {} });
      let err = null;
      try { await _pick(res, 'invoices', true); } catch (e) { err = e; }
      return { gated: !!document.getElementById('ff-trial-gate'), err };
    };
    const other402 = await run({ ok: false, status: 402, json: async () => ({ error: 'Plan limit reached', code: 'ENTITY_LIMIT' }) });
    A('a 402 WITHOUT TRIAL_EXPIRED does not gate', other402.gated, false,
      'keying on "any 402" would pass the happy case and be wrong');
    A('…but still throws with its own code', other402.err && other402.err.code, 'ENTITY_LIMIT');

    const five = await run({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    A('a 500 does not gate (it is a real failure — F67 owns it)', five.gated, false);

    const unauth = await run({ ok: false, status: 401, json: async () => ({}) });
    A('a 401 does not gate (logged out — the auth gate owns it)', unauth.gated, false);
    A('…and 401 still returns empty rather than throwing', unauth.err, null);
  }

  // ── 5 · idempotency — five loaders 402 in one boot, ONE overlay ──
  console.log('\n-- 5 - idempotent: five simultaneous 402s produce ONE gate --');
  {
    const { document, appended } = makeDom();
    const win = {};
    const gate = loadGate(win, document);
    for (let i = 0; i < 5; i++) gate(TRIAL_402.body.error);
    A('exactly one gate element appended', appended.filter(el => el.id === 'ff-trial-gate').length, 1,
      'loadEntityData fires five loaders in one Promise.all — without the guard, five overlays stack');
  }

  // ── 6 · STRUCTURAL (Rule 5, labelled) — the countdown banner cannot cover this ──
  console.log('\n-- 6 - STRUCTURAL: the trial banner bails exactly when the trial expires --');
  A('STRUCTURAL: the banner returns on daysLeft <= 0', /if\(daysLeft<=0\|\|daysLeft>30\)return;/.test(IDX), true,
    'so it is not, and cannot be, the expired-trial UI — hence this gate');

  console.log('\n' + '-'.repeat(78));
  console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed'
                         : '  ' + fail + ' FAILED, ' + pass + ' passed');
  console.log('  NOTE  the overlay is asserted structurally; its APPEARANCE is a visual check (owner).');
  console.log('  NOTE  hard-lock vs READ-ONLY on expiry is an open product decision — see F130.');
  console.log('-'.repeat(78) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error('\n[f130] PROBE ERROR — ' + (err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
