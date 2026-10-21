'use strict';
// email-send.js — LR23 (owner decision 2026-10-21). ONE checked e-mail client for the whole app.
//
// The Resend SDK (v3) does not throw when it refuses an e-mail — an unverified sender, a sandbox recipient, a bad
// address — it RETURNS { data: null, error }. Every call site awaited the send and treated "it returned" as "sent", so a
// refused password reset, invitation or security alert was reported as sent (LR17: the security log said sent=true).
//
// checkedResend(client) returns a client whose emails.send THROWS on a refusal (err.code = 'EMAIL_REFUSED'), so every
// existing try / catch and .catch() now takes its failure path — one mechanism for every call site, not a patch per
// site. The error carries the provider's reason (e.g. "You can only send testing emails to your own email address") —
// never the recipient, the subject or the body, which can hold a reset link or an invitation token (secrets).
//
// server.js builds its client through this (and the test seam wraps too); verify-lr23-email-send-checked fails if any
// file creates a Resend client or calls emails.send on one that did not pass through here.
function emailRefusedError(providerError) {
  const pe = providerError || {};
  const why = String(pe.message || pe.name || 'unknown reason').slice(0, 200);
  const err = new Error('E-mail refused by the provider: ' + why);
  err.code = 'EMAIL_REFUSED';
  err.provider = { name: pe.name || null, statusCode: pe.statusCode || null, message: why };
  return err;
}

function checkedResend(client) {
  if (!client || !client.emails || typeof client.emails.send !== 'function') return client;
  if (client.__ffChecked) return client;
  const raw = client.emails.send.bind(client.emails);
  return {
    __ffChecked: true,
    emails: {
      async send(msg) {
        const r = await raw(msg);
        if (r && r.error) throw emailRefusedError(r.error);
        return r;
      },
    },
  };
}

module.exports = { checkedResend, emailRefusedError };
