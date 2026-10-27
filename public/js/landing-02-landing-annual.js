// Moved out of landing.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
var landingAnnual = false;
function toggleLandingBilling() {
  landingAnnual = !landingAnnual;
  // D-A: prices from plans.js (the one plan definition); the fallback is the generated page's own numbers.
  var P = (window.FinFlowPlans && window.FinFlowPlans.PLANS) || { pro: { monthly: 79, annualMonthly: 63 }, business: { monthly: 249, annualMonthly: 199 }, scale: { monthly: 400, annualMonthly: 320 } };
  var pro = landingAnnual ? P.pro.annualMonthly : P.pro.monthly;
  var biz = landingAnnual ? P.business.annualMonthly : P.business.monthly;
  var scale = landingAnnual ? P.scale.annualMonthly : P.scale.monthly;
  var track = document.getElementById('toggle-track');
  var thumb = document.getElementById('toggle-thumb');
  if (track) track.style.background = landingAnnual ? 'var(--acc)' : 'var(--bd2)';
  if (thumb) thumb.style.left = landingAnnual ? '23px' : '3px';
  var proEl = document.getElementById('land-price-pro');
  var bizEl = document.getElementById('land-price-biz');
  var proPer = document.getElementById('land-period-pro');
  var bizPer = document.getElementById('land-period-biz');
  var scaleEl = document.getElementById('land-price-scale');
  var scalePer = document.getElementById('land-period-scale');
  if (proEl) proEl.textContent = pro;
  if (bizEl) bizEl.textContent = biz;
  if (scaleEl) scaleEl.textContent = scale;
  if (proPer) proPer.textContent = landingAnnual ? '$' + (pro*12).toLocaleString('en-US') + '/yr · save $' + ((P.pro.monthly-pro)*12).toLocaleString('en-US') : 'per month';
  if (bizPer) bizPer.textContent = landingAnnual ? '$' + (biz*12).toLocaleString('en-US') + '/yr · save $' + ((P.business.monthly-biz)*12).toLocaleString('en-US') : 'per month';
  if (scalePer) scalePer.textContent = landingAnnual ? '$' + (scale*12).toLocaleString('en-US') + '/yr · save $' + ((P.scale.monthly-scale)*12).toLocaleString('en-US') : 'per month';
}
