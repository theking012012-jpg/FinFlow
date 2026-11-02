// C1 / Rule 9 — every same-origin /api WRITE carries an Idempotency-Key, so the server's one shared mechanism
// (idempotency.js) runs each operation once. Loaded first on every page, before any script that writes.
//
// Which writes are "the same operation" is decided by the USER'S GESTURE (a click, a form submit, Enter):
//   · the same control pressed again while its request is still running, or within 2 s of its answer (a double-click,
//     an impatient second click on a slow network) → the same key → one write; the second gets the first's answer;
//   · any other gesture → a new key (a new operation — entering the same thing again later is allowed);
//   · a write no gesture started (timers, background saves, retries after 3 s) → a unique key every time, so it
//     behaves exactly as without this file.
// The key also hashes method, path and body, so one gesture that sends two different writes keeps them apart.
// A caller that already sends its own Idempotency-Key keeps it.
(function () {
  if (window.__ffIdem) return; window.__ffIdem = true;
  var KEEP_MS = 2000, GESTURE_MS = 3000;
  var g = { el: null, nonce: '', at: 0, inflight: 0, doneAt: 0 };
  var rnd = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); };
  function control(t) { while (t && t !== document && !(t.matches && t.matches('button, a, input[type=submit], input[type=button], [role=button], [data-on-click], form'))) t = t.parentNode; return t && t !== document ? t : null; }
  function gesture(e) {
    var el = control(e.target) || e.target, now = Date.now();
    var same = el && el === g.el && (g.inflight > 0 || now - g.doneAt < KEEP_MS || now - g.at < KEEP_MS);
    if (!same) g = { el: el, nonce: rnd(), at: now, inflight: 0, doneAt: 0 };
    else g.at = now;
  }
  document.addEventListener('click', gesture, true);
  document.addEventListener('submit', gesture, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter') gesture(e); }, true);
  // FNV-1a with two seeds → 64-bit hex (synchronous, fast; it names an operation, it is not a secret)
  function h32(s, seed) { var h = seed >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  window.addEventListener('ff:idempotent-replay', function () {
    setTimeout(function () { if (typeof window.notify === 'function') window.notify('Already saved — that was the same request again, so nothing was added twice.'); }, 0);
  });
  var orig = window.fetch && window.fetch.bind(window);
  if (!orig) return;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var u = new URL(url, location.href);
      if (u.origin === location.origin && /^\/api\//.test(u.pathname) && /^(POST|PUT|PATCH|DELETE)$/.test(method)) {
        init = Object.assign({}, init || {});
        // Keep the caller's header TYPE: a plain object stays a plain object (some wrappers read init.headers[...]);
        // a Headers instance gets .set(). Never swap one for the other.
        var h = init.headers, isH = h && typeof h.get === 'function' && typeof h.set === 'function';
        var has = isH ? h.has('Idempotency-Key') : !!(h && Object.keys(h).some(function (k) { return k.toLowerCase() === 'idempotency-key'; }));
        var mine = null;
        if (!has) {
          var now = Date.now(), fromGesture = g.nonce && (now - g.at < GESTURE_MS || g.inflight > 0);
          var base = fromGesture ? g.nonce : rnd();
          var s = base + '|' + method + '|' + u.pathname + u.search + '|' + (typeof init.body === 'string' ? init.body : '');
          var key = 'ff1-' + h32(s, 2166136261) + h32(s, 3166136261) + '-' + base.slice(-6);
          if (isH) h.set('Idempotency-Key', key); else init.headers = Object.assign({}, h || {}, { 'Idempotency-Key': key });
          if (fromGesture) { mine = g; g.inflight++; }
        }
        var done = function () { if (mine) { mine.inflight = Math.max(0, mine.inflight - 1); mine.doneAt = Date.now(); } };
        return orig(input, init).then(function (res) {
          done();
          if (res && res.headers && res.headers.get('Idempotent-Replayed') === 'true') {
            try { window.dispatchEvent(new CustomEvent('ff:idempotent-replay', { detail: { url: u.pathname, method: method } })); } catch (_) {}
          }
          return res;
        }, function (err) { done(); throw err; });
      }
    } catch (_) {}
    return orig(input, init);
  };
})();
