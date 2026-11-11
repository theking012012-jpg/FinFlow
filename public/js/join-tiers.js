// N3-10 (live re-audit 2026-11-11): the /join page's referral ladder and service commission are rendered from
// tier-config.js (window.FinFlowTiers) — the SAME single source the server pays from and the accountant dashboard shows
// (F17). The page used to hardcode its own ladder (1–50 → 1 month, 50–500 → 3 months, 500+ → 12, a flat 4 %), which
// disagreed with every term the app actually pays. No inline styles or scripts (FA-P1 CSP): classes only.
(function () {
  'use strict';
  var T = window.FinFlowTiers;
  var host = document.getElementById('join-tiers');
  var box = document.getElementById('join-commission');
  if (!T || !host) return;
  var PER_MONTH = 10;   // $10 per active paying client per month — the referral payout (accountant-routes / tier-config header)
  var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function range(t) { return t.max === Infinity ? (t.min + '+ clients') : (t.min + ' to ' + t.max + ' clients'); }
  host.textContent = '';
  T.TIERS.forEach(function (t, i) {
    var months = Math.min(t.referralMonths, T.REFERRAL_MONTHS_HARD_CAP || 12);
    var card = el('div', 'tier-card');
    card.appendChild(el('div', 'tier-badge', ROMAN[i] || String(i + 1)));
    var info = el('div', 'tier-info');
    info.appendChild(el('h3', null, t.name + ' — ' + range(t)));
    info.appendChild(el('p', null, '$' + PER_MONTH + ' per client · paid for ' + months + ' month' + (months === 1 ? '' : 's') +
      ' after they subscribe · ' + Math.round(t.commissionRate * 100) + '% service commission'));
    card.appendChild(info);
    var earn = el('div', 'tier-earn');
    earn.appendChild(el('div', 'amount', '$' + (PER_MONTH * months)));
    earn.appendChild(el('div', 'per', '× ' + months + ' month' + (months === 1 ? '' : 's')));
    card.appendChild(earn);
    host.appendChild(card);
  });
  if (box) {
    var rates = T.TIERS.map(function (t) { return Math.round(t.commissionRate * 100); });
    var hi = Math.max.apply(null, rates), lo = Math.min.apply(null, rates);
    box.querySelector('h4').textContent = 'Service commission ' + hi + '% → ' + lo + '% by tier';
    box.querySelector('p').textContent = 'Charge your clients for tax filing, bookkeeping, or advisory work directly through FinFlow. ' +
      'We process the payment and keep a service commission of ' + hi + '% at ' + T.TIERS[0].name + ', falling to ' + lo + '% at ' +
      T.TIERS[T.TIERS.length - 1].name + ' — and your first ' + T.ONBOARDING_FREE_BELOW + ' paying clients are commission-free.';
  }
})();
