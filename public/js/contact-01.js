// FA-L §5: the public contact form — the one way to reach FinFlow without an account (and the route for privacy
// requests from people who have deleted theirs). Posts to /api/contact; a reply comes by email.
(function () {
  var t = new URLSearchParams(location.search).get('topic');
  var sel = document.getElementById('cf-topic');
  if (t && sel && [].some.call(sel.options, function (o) { return o.value === t; })) sel.value = t;
  var NOTES = {
    privacy: 'Privacy requests are answered within 30 days. Send it from the email on your account (or the one you used) so we can find your data.',
    security: 'Please include the steps to reproduce. Do not include anyone else’s data. We reply to every report.',
  };
  var base = document.getElementById('cf-note').innerHTML;
  function note() { var n = NOTES[sel.value]; document.getElementById('cf-note').innerHTML = (n ? n + ' ' : '') + base; }
  sel.addEventListener('change', note); note();
})();
async function sendContact() {
  var msg = document.getElementById('cf-msg'), btn = document.getElementById('cf-send');
  msg.className = 'cf-msg'; msg.textContent = '';
  btn.disabled = true;
  try {
    var r = await fetch('/api/contact', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      topic: document.getElementById('cf-topic').value, name: document.getElementById('cf-name').value,
      email: document.getElementById('cf-email').value, message: document.getElementById('cf-message').value,
      website: document.getElementById('cf-website').value }) });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) { msg.className = 'cf-msg err'; msg.textContent = d.error || (r.status === 429 ? 'Too many messages from here — try again in an hour.' : 'Could not send. Try again.'); btn.disabled = false; return; }
    document.getElementById('cf').querySelectorAll('input,select,textarea').forEach(function (el) { el.disabled = true; });
    msg.className = 'cf-msg ok'; msg.textContent = 'Sent. We will reply to ' + document.getElementById('cf-email').value + '.';
  } catch (e) { msg.className = 'cf-msg err'; msg.textContent = 'Connection error. Try again.'; btn.disabled = false; }
}
