'use strict';
/**
 * portal.js — FA-B10b: the customer portal page. Reads the token from the URL fragment, asks /api/portal/view for this
 * customer's account, and builds the page with textContent only (nothing the business typed is ever parsed as HTML).
 */
(function () {
  var token = (location.hash || '').replace(/^#/, '');
  var root = document.getElementById('portal');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
  }
  function fail(msg) { root.textContent = ''; root.appendChild(el('h1', null, 'This link isn’t working')); root.appendChild(el('p', 'muted', msg)); }
  // An accounting date is a calendar date (Rule 10): label it from its own parts, never through the viewer's timezone.
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(ymd) { if (!ymd) return '—'; var p = String(ymd).split('-'); return Number(p[2]) + ' ' + MON[Number(p[1]) - 1] + ' ' + p[0]; }

  if (!token) return fail('The link is incomplete. Open it again from the message the business sent you.');
  post('/api/portal/view', { token: token }).then(function (res) {
    if (!res.ok) return fail(res.j.error || 'This link is no longer active. Ask the business for a new one.');
    var d = res.j, cur = d.business.currency;
    var money = function (n) { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n); } catch (e) { return cur + ' ' + Number(n).toFixed(2); } };
    document.title = (d.business.name || 'Your account') + ' — your account';
    root.textContent = '';
    root.appendChild(el('h1', null, d.business.name || 'Your account'));
    root.appendChild(el('p', 'muted', 'Account for ' + (d.customer.name || 'you') + ' · as of ' + day(d.today)));

    var sum = el('div', 'summary');
    var t1 = el('div', 'tile due'); t1.appendChild(el('div', 'k', 'You owe')); t1.appendChild(el('div', 'v', money(d.total_due))); t1.id = 'portal-total';
    var t2 = el('div', 'tile'); t2.appendChild(el('div', 'k', 'Of which overdue')); t2.appendChild(el('div', 'v', money(d.overdue_due))); t2.id = 'portal-overdue';
    sum.appendChild(t1); sum.appendChild(t2); root.appendChild(sum);

    root.appendChild(el('h2', null, 'Open invoices'));
    if (!d.open.length) root.appendChild(el('p', 'muted', 'Nothing is owed. Thank you!'));
    d.open.forEach(function (i) {
      var row = el('div', 'inv'); row.setAttribute('data-invoice', i.id);
      row.appendChild(el('span', 'num', i.number || 'Invoice'));
      var meta = el('span', 'meta', 'Issued ' + day(i.issue_date) + ' · ');
      meta.appendChild(el('span', i.overdue ? 'late' : '', (i.overdue ? 'Overdue — was due ' : 'Due ') + day(i.due_date)));
      if (i.paid > 0) meta.appendChild(document.createTextNode(' · ' + money(i.paid) + ' of ' + money(i.amount) + ' paid'));
      row.appendChild(meta);
      row.appendChild(el('span', 'amt', money(i.balance)));
      if (d.can_pay) {
        var b = el('button', null, 'Pay ' + money(i.balance));
        b.addEventListener('click', function () {
          b.disabled = true; b.textContent = 'Opening secure checkout…';
          post('/api/portal/pay', { token: token, invoice_id: i.id }).then(function (r) {
            if (r.ok && r.j.payment_link) { location.href = r.j.payment_link; return; }
            b.disabled = false; b.textContent = 'Pay ' + money(i.balance);
            var n = row.querySelector('.err') || row.appendChild(el('p', 'note err')); n.textContent = r.j.error || 'Could not open checkout. Try again.';
          });
        });
        row.appendChild(b);
      }
      root.appendChild(row);
    });
    if (d.open.length && !d.can_pay) root.appendChild(el('p', 'note', 'Online payment isn’t set up for this business — contact them to pay.'));

    if (d.paid.length) {
      root.appendChild(el('h2', null, 'Paid'));
      d.paid.forEach(function (i) {
        var row = el('div', 'inv'); row.setAttribute('data-invoice', i.id);
        row.appendChild(el('span', 'num', i.number || 'Invoice'));
        var meta = el('span', 'meta', 'Issued ' + day(i.issue_date) + ' · '); meta.appendChild(el('span', 'paid', 'Paid'));
        row.appendChild(meta); row.appendChild(el('span', 'amt', money(i.amount)));
        root.appendChild(row);
      });
    }
    var act = el('div', 'actions'); var pr = el('button', 'ghost', 'Print or save statement');
    pr.addEventListener('click', function () { window.print(); }); act.appendChild(pr); root.appendChild(act);
  }).catch(function () { fail('Could not reach the server. Check your connection and try again.'); });
})();
