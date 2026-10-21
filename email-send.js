'use strict';
// email-send.js — LR23 (owner go 2026-10-21). The Resend SDK (resend 3.x) does NOT throw when Resend refuses an e-mail
// (unverified sender, sandbox recipient, bad address, network failure): it RESOLVES { data: null, error }. No call site
// read `.error`, so every refused e-mail — password resets, invites, security alerts, reminders — was treated as sent.
//
// checkedResend(client) wraps the client ONCE, where it is created, so `client.emails.send(...)` REJECTS with an
// EMAIL_REFUSED error whenever Resend returns an error. Every existing call site (each already has a catch) then sees the
// failure; none can forget to check. A guard (verify-lr23-email-refusal) fails if any code constructs a Resend client
// without this wrapper. Nothing here ever logs or returns the API key.
function checkedResend(client) {
  if (!client || !client.emails || typeof client.emails.send !== 'function' || client.__ffChecked) return client;
  const raw = client.emails.send.bind(client.emails);
  client.emails.send = async function checkedSend(payload, options) {
    const r = await raw(payload, options);
    if (r && r.error) {
      const msg = (r.error && (r.error.message || r.error.name)) || 'refused';
      const e = new Error('E-mail not sent — Resend refused it: ' + msg);
      e.code = 'EMAIL_REFUSED';
      e.resend = { name: r.error.name || null, message: r.error.message || null, statusCode: r.error.statusCode || null };
      throw e;
    }
    return r;
  };
  Object.defineProperty(client, '__ffChecked', { value: true });
  return client;
}

module.exports = { checkedResend };
