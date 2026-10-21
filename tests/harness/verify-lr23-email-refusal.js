'use strict';
/**
 * verify-lr23-email-refusal.js — LR23 (owner go 2026-10-21; root of LR17). resend 3.x RESOLVES { data: null, error } when an
 * e-mail is refused — it does not throw — and no call site read `.error`, so a refused e-mail was recorded as sent.
 * Fix: email-send.js checkedResend() wraps the client once, where it is created; emails.send then REJECTS (EMAIL_REFUSED).
 *
 *   1  the REAL resend SDK, raw: a send that cannot be delivered (outbound network blocked by clock.js) RESOLVES with an
 *      error and does not throw — the defect's mechanism, executed                                       (premise)
 *   2  the same real client wrapped by checkedResend → the send REJECTS with code EMAIL_REFUSED            bug: resolves
 *   3  a successful send (fake client returning { data: { id } }) still resolves with its result          (control)
 *   4  no API key in the error                                                                              (secret hygiene)
 *   5  STRUCTURAL (labelled, Rule 5): every `new Resend(` in the app is wrapped by checkedResend; the two call sites with no
 *      error handling (accountant invite; anomaly digest) now handle a refusal                         bug: unwrapped
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const A = (n, ok, det) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (det ? '  — ' + det : ''))); };

(async () => {
  console.log('\nLR23 — a refused e-mail is never recorded as sent\n');
  try {
    const { Resend } = require('resend');
    const KEY = 're_harness_not_a_real_key_123456';
    const payload = { from: 'FinFlow <noreply@finflow.test>', to: 'someone@finflow.test', subject: 'LR23', html: '<p>x</p>' };
    let raw, rawThrew = false;
    try { raw = await new Resend(KEY).emails.send(payload); } catch (_) { rawThrew = true; }
    A('1  premise: the real SDK RESOLVES with an error (does not throw) on a failed send', !rawThrew && !!(raw && raw.error), JSON.stringify({ rawThrew, hasError: !!(raw && raw.error) }));

    let wrapped = null;
    try { wrapped = require(path.join(ROOT, 'email-send.js')).checkedResend; } catch (e) { /* the bug: no wrapper */ }
    let rejected = null;
    if (wrapped) { try { await wrapped(new Resend(KEY)).emails.send(payload); rejected = false; } catch (e) { rejected = e; } }
    A('2  wrapped real client → the send REJECTS with EMAIL_REFUSED', !!rejected && rejected.code === 'EMAIL_REFUSED', rejected ? rejected.message : 'no wrapper / resolved');
    let ok = null;
    if (wrapped) { const fake = { emails: { send: async () => ({ data: { id: 'msg_1' }, error: null }) } }; ok = await wrapped(fake).emails.send(payload); }
    A('3  a successful send still resolves with its result (control)', !!ok && ok.data && ok.data.id === 'msg_1', JSON.stringify(ok));
    A('4  the API key never appears in the error', !!rejected && !String(rejected.message + JSON.stringify(rejected.resend || {})).includes(KEY));

    const files = ['server.js', 'accountant-routes.js', 'admin-routes.js', 'audit-anomalies.js'].map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
    const unwrapped = files.filter(([, s]) => /new Resend\(/.test(s.replace(/checkedResend\(new Resend\(/g, ''))).map(([f]) => f);
    A('5  STRUCTURAL: every `new Resend(` is wrapped by checkedResend', unwrapped.length === 0 && /checkedResend\(new Resend\(/.test(files[0][1]), 'unwrapped in: ' + unwrapped.join(', '));
    const acct = files[1][1], anom = files[3][1];
    A('5  STRUCTURAL: accountant invite handles a refused e-mail (EMAIL_NOT_SENT)', /code: 'EMAIL_NOT_SENT'/.test(acct));
    A('5  STRUCTURAL: anomaly digest reports sent:false on a refusal', /sent: false, reason: 'send_failed'/.test(anom));
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
