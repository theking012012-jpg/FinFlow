'use strict';
/**
 * C26 (Cowork end-to-end test): "Start free trial" opens Create account, and a signup through an accountant's
 * referral link is linked to that accountant.
 * BUG: the live sign-in screen (finflow-api.js showAuthGate) covers the older #login-screen. Only the covered
 * screen read ?signup=1 and ?ref=, so the live one always opened on Sign in and registered without the referral
 * code — referred signups were never linked to the accountant (F10 regrown on the live screen).
 * Executed: the real finflow-api.js in jsdom at /app?signup=1&ref=C26REF, its fetch wired to a real server on a
 * scratch Postgres; the referral row is read back from the database.
 *   Create account panel shown → true                 bug: false (Sign in shown)
 *   accountant_clients row for the new user → 1       bug: 0
 *   control: /app (no ?signup) → Sign in shown
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { JSDOM } = require('jsdom');
const { run } = require('./moneyFixKit.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'finflow-api.js'), 'utf8');
const RUNTIME = ['ff-csp.js', '_gen/ff-handlers.js'].map(f => fs.readFileSync(path.join(__dirname, '..', '..', 'public', f), 'utf8')).join('\n;\n');
const tick = ms => new Promise(r => setTimeout(r, ms));

function gate(base, query) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: base + '/app' + query });
  const w = dom.window;
  w.fetch = (p, o) => global.fetch(new URL(String(p), base), o);   // the real server
  w.eval(RUNTIME);   // FA-P1: as the page does — the policy runtime + handler registry load first
  w.eval(SRC.replace(/location\.reload\(\)/g, 'window.__reloaded=true'));   // jsdom cannot reload; record it
  return w;
}
const shown = (w, id) => { const el = w.document.getElementById(id); return !!el && el.style.display !== 'none'; };

run('C26 — "Start free trial" opens Create account; referral signups link', async ({ c, eq, A, server }) => {
  await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ('c26-acc@finflow.test', $1, 'C', 'TwentySix', 'Firm', 'C26REF', 'verified')`, [bcrypt.hashSync('c26-acc-pw', 10)]);
  const base = server.baseUrl;

  const ctl = gate(base, '');
  await tick(300);
  A('control: /app shows the sign-in gate', !!ctl.document.getElementById('ff-auth-gate'));
  eq('control: /app opens on Sign in', shown(ctl, 'ff-li') && !shown(ctl, 'ff-re'), true);

  const w = gate(base, '?signup=1&ref=C26REF');
  await tick(300);
  eq('/app?signup=1 opens on Create account', shown(w, 'ff-re') && !shown(w, 'ff-li'), true, false);
  w.document.getElementById('ff-rn').value = 'Referred Owner';
  w.document.getElementById('ff-re2').value = 'c26-referred@finflow.test';
  w.document.getElementById('ff-rp').value = 'c26-owner-pw-123';
  await w.ffRegister();
  A('registration succeeded', w.__reloaded === true, (w.document.getElementById('ff-err') || {}).textContent);
  let links = 0;
  for (let i = 0; i < 20 && !links; i++) {   // the server links the referral just after answering
    await tick(100);
    links = Number((await c.query(`SELECT COUNT(*)::int n FROM accountant_clients ac JOIN users u ON u.id = ac.user_id
      WHERE u.data->>'email' = 'c26-referred@finflow.test' AND ac.requested_by = 'referral'`)).rows[0].n);
  }
  eq('the referred signup is linked to the accountant', links, 1, 0);
  A('the form asks for the server\'s real minimum password length', /min 8 characters/.test(w.document.getElementById('ff-re').textContent));
});
