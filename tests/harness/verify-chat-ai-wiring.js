'use strict';
/**
 * verify-chat-ai-wiring.js — structural guarantees for the chat/AI wave whose full effect can't be
 * exercised in the harness env (offline email needs Resend; the multi-turn model path needs a live
 * ANTHROPIC key). Asserts the exact wiring that must be present for these to work in production.
 *
 *   node tests/harness/verify-chat-ai-wiring.js
 */
const fs = require('fs');
const path = require('path');
const P = f => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

(function () {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

  const server = P('server.js');
  const acct = P('accountant-routes.js');
  const idx = P('public/index.html');
  const accClient = P('public/accountant-client.html');
  const db = P('database.js');

  // ── #1 offline chat email notify ────────────────────────────────────────────
  A('server: attach paths added to large-body allowlist', /my-accountant\/attach/.test(server) && /clients\/attach/.test(server));
  A('notify: online-detection + debounce helpers present', /_sideOnline/.test(acct) && /_lastChatNotify/.test(acct) && /_CHAT_NOTIFY_COOLDOWN_MS/.test(acct));
  A('notify: _notifyOfflineMessage only emails when recipient offline', /_notifyOfflineMessage/.test(acct) && /if \(_sideOnline\(key, recipientSide\)\) return/.test(acct));
  A('notify: uses Resend + degrades gracefully', /if \(!resendClient \|\| !process\.env\.EMAIL_FROM\) return/.test(acct));
  A('notify: wired into BOTH send directions (client + accountant)', (acct.match(/_notifyOfflineMessage\(\{/g) || []).length >= 2);
  A('notify: re-armed when the reader opens the thread', (acct.match(/_lastChatNotify\.delete/g) || []).length >= 2);

  // ── #2 chat attachments ─────────────────────────────────────────────────────
  A('db: attachment columns on accountant_messages', /att_name/.test(db) && /att_mime/.test(db) && /att_size/.test(db) && /att_data/.test(db));
  A('server: two attach endpoints (client + accountant)', /my-accountant\/attach/.test(acct) && /clients\/attach/.test(acct));
  A('server: authorized download endpoint', /chat-attachment\/:id/.test(acct) && /_attachmentFor/.test(acct));
  A('server: 5MB cap enforced', /_CHAT_ATT_MAX/.test(acct) && /413/.test(acct));
  A('server: message lists select att metadata (not data)', (acct.match(/att_name, att_mime, att_size/g) || []).length >= 2);
  A('client UI: attach button + sender + attachment render', /sendAcctAttachment/.test(idx) && /acct-chat-file/.test(idx) && /chat-attachment\//.test(idx));
  A('accountant UI: attach button + sender + attachment render', /sendClientAttachment/.test(accClient) && /msg-file/.test(accClient) && /chat-attachment\//.test(accClient));

  // ── #3 threaded Ask FinFlow ─────────────────────────────────────────────────
  A('server: /api/help/ask accepts history[]', /Array\.isArray\(req\.body && req\.body\.history\)/.test(server) && /const multiTurn = history\.length > 0/.test(server));
  A('server: multi-turn bypasses the single-shot cache (read + write)', /if \(!multiTurn\) \{[\s\S]{0,400}ai_cache/.test(server) && /if \(!multiTurn\) pool\.query\(`INSERT INTO ai_cache/.test(server));
  A('server: history is passed into the model messages', /messages: \[\.\.\.history, \{ role: 'user'/.test(server));
  A('client: conversation state + threaded render', /var _helpConvo/.test(idx) && /_helpRenderThread/.test(idx) && /window\.helpAsk/.test(idx));
  A('client: sends history to the endpoint', /body:JSON\.stringify\(\{question:question,history:history\}\)/.test(idx));
  A('client: New chat resets the thread', /window\.helpNewChat/.test(idx));

  // ── #4 AI-to-ticket escalation ──────────────────────────────────────────────
  A('client: helpEscalate builds a transcript + posts to /api/support', /window\.helpEscalate/.test(idx) && /category:'ai-escalation'/.test(idx) && /Escalated from the Ask FinFlow/.test(idx));
  A('client: escalation button appears after an answer', /Still need help\? Send this to support/.test(idx));

  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (chat/AI wave wiring)`);
  console.log('');
  process.exitCode = fail === 0 ? 0 : 1;
})();
