'use strict';
/**
 * verify-lr23-email-send-checked.js — LR23 / LR17 (owner decision 2026-10-21). The Resend SDK (v3) RETURNS
 * { data: null, error } when it refuses an e-mail instead of throwing; every send site treated "it returned" as "sent",
 * so the security log recorded sent=true for an e-mail that never went out (LR17), and an invitation reported
 * emailStatus "sent".
 *
 * Real scratch Postgres, real server, real routes; the Resend client is a fake (never the network) set through the
 * server's test seam. Two fakes: one REFUSES like the real SDK does, one accepts.
 *   refusing provider:  invitation → emailStatus "failed"                      (old: "sent")
 *                       password change → SECURITY_ALERT sent false, reason "refused", the provider's reason kept
 *                                                                               (old: sent true)
 *   accepting provider: invitation → "sent"; SECURITY_ALERT sent true
 *   nothing secret in the alert row: no recipient address, no e-mail body
 * STRUCTURAL (Rule 5, labelled): no file builds a Resend client or sends except through email-send.js.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-lr23-email-send-checked.js
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./moneyFixKit.js');
const ROOT = path.join(__dirname, '..', '..');

const REFUSED = { name: 'validation_error', statusCode: 403, message: 'You can only send testing emails to your own email address' };

run('LR23 — a refused e-mail is reported as refused, never as sent', async ({ newOwner, c, eq }) => {
  const srv = require('../../server.js');
  const PW1 = 'money-fix-pw-not-a-secret', PW2 = 'lr23-new-password-not-a-secret';
  const alerts = async uid => (await c.query(`SELECT new_data FROM audit_trail WHERE user_id = $1 AND action = 'SECURITY_ALERT' ORDER BY id`, [uid])).rows.map(r => r.new_data);

  // ── a provider that refuses (exactly the SDK's shape) ──
  srv._setResendClientForTest({ emails: { send: async () => ({ data: null, error: REFUSED }) } });
  const a = await newOwner('LR23a');
  const inv = await a.http.request('POST', '/api/team/invite', { email: 'invitee-a@finflow.test', role: 'admin', name: 'Invitee' });
  eq('refused: the invitation says the e-mail failed', [inv.status, inv.json && inv.json.emailStatus], [201, 'failed'], [201, 'sent']);
  eq('refused: password change still succeeds', (await a.http.request('PUT', '/api/auth/change-password', { currentPassword: PW1, newPassword: PW2 })).status, 200);
  const ra = (await alerts(a.uid)).find(x => x.event === 'CHANGE_PASSWORD');
  eq('refused: the security alert is recorded as NOT sent, reason "refused"', ra ? [ra.sent, ra.reason] : null, [false, 'refused'], [true, undefined]);
  eq('refused: …with the provider\'s reason', ra && /own email address/.test(ra.detail || ''), true, false);
  eq('refused: …and no recipient address or e-mail body in the row', /@|<p>|<div/.test(JSON.stringify(ra || {})), false);

  // ── a provider that accepts ──
  srv._setResendClientForTest({ emails: { send: async () => ({ data: { id: 'em_1' }, error: null }) } });
  const b = await newOwner('LR23b');
  const inv2 = await b.http.request('POST', '/api/team/invite', { email: 'invitee-b@finflow.test', role: 'admin', name: 'Invitee' });
  eq('accepted: the invitation says sent', inv2.json && inv2.json.emailStatus, 'sent');
  await b.http.request('PUT', '/api/auth/change-password', { currentPassword: PW1, newPassword: PW2 });
  const rb = (await alerts(b.uid)).find(x => x.event === 'CHANGE_PASSWORD');
  eq('accepted: the security alert is recorded as sent', rb && rb.sent, true);

  // ── STRUCTURAL (labelled): every Resend client and every send goes through email-send.js ──
  const files = ['server.js', 'accountant-routes.js', 'admin-routes.js', 'audit-anomalies.js'];
  const rawNew = files.filter(f => /new\s+Resend\s*\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')) && !/checkedResend\(\s*new\s+Resend\s*\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  eq('STRUCTURAL: no Resend client is created without checkedResend', rawNew, []);
  const seam = /_setResendClientForTest\s*=\s*c\s*=>\s*\{\s*resendClient\s*=\s*checkedResend\(c\)/.test(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  eq('STRUCTURAL: the test seam wraps too (so this harness tests the real path)', seam, true);
});
