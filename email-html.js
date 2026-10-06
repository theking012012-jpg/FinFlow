'use strict';
// emailHtml — the tagged template every outbound email body is built with (N85). Every interpolated
// value is HTML-escaped by default; only another emailHtml result (or an explicit raw()) is inserted
// as markup. Names, firms, notes and other user-entered text used to be pasted straight into HTML
// sent from FinFlow's own domain — any accountant could inject links or markup into emails to
// arbitrary addresses.
//   resendClient.emails.send({ ..., html: String(emailHtml`<p>Hi ${name},</p>`) })
class SafeHtml extends String {}
const escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raw = (s) => new SafeHtml(String(s == null ? '' : s));
function emailHtml(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) { const v = vals[i]; out += v instanceof SafeHtml ? String(v) : escapeHtml(v); }
  });
  return new SafeHtml(out);
}
module.exports = { emailHtml, raw, escapeHtml, SafeHtml };
