// The page behind the "Unsubscribe" link in a FinFlow product-news email. Opening it unsubscribes (the button POSTs, so a
// mail scanner that only fetches the page changes nothing — the script does the POST); "Undo" resubscribes.
var _un = { e: new URLSearchParams(location.search).get('e') || '', t: new URLSearchParams(location.search).get('t') || '', subscribed: true };
async function _unPost(resubscribe) {
  var r = await fetch('/api/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e: _un.e, t: _un.t, resubscribe: resubscribe }) });
  var d = await r.json().catch(function () { return {}; });
  var txt = document.getElementById('un-text'), btn = document.getElementById('un-btn');
  if (!r.ok) { txt.textContent = d.error || 'Something went wrong. Try again from the link in the email.'; btn.style.display = 'none'; return; }
  _un.subscribed = !!d.subscribed;
  txt.textContent = _un.subscribed ? (_un.e + ' will get FinFlow product news again.') : (_un.e + ' is unsubscribed from FinFlow product news.');
  btn.textContent = _un.subscribed ? 'Unsubscribe' : 'Undo — keep getting product news';
  btn.style.display = '';
}
function unsubToggle() { _unPost(!_un.subscribed); }
_unPost(false);
