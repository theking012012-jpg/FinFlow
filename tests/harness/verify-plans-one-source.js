'use strict';
/**
 * verify-plans-one-source.js — A0 / D-A + D-F (owner decisions 2026-10-23).
 * What each plan includes was written in SIX places that disagreed: the landing cards, the in-app cards, the in-app
 * prices + annual toggle, the client gates (Pro blocked from Banking and the scanner), the client entity cap, and the
 * server (entity limit, AI caps, invoice ceiling). Live example: the landing Pro card listed bank sync and the receipt
 * scanner; the app blocked Pro from both; the server allowed Pro 15 scans a month.
 * Now ONE definition, plans.js, and every surface is derived from it. This harness compares each surface's RENDERED
 * output with what plans.js says, and checks the Pro gates by executing them (D-F: Pro gets bank sync + the scanner;
 * MRR stays Business and up).
 * The REAL SPA + real server (clientMoneyKit); the account is put on Pro.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const { run } = require('./clientMoneyKit.js');

run('D-A — one plan definition; every surface says what plans.js says', async ({ w, d, settle, eq, A, http }) => {
  let Plans = null;
  try { Plans = require(path.join(ROOT, 'plans.js')); } catch (_) {}
  A('0  plans.js exists', !!Plans, 'missing');
  if (!Plans) return;
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const lines = el => el ? [...el.children].map(c => norm(c.textContent).replace(/^[✓—]\s*/, '')).filter(Boolean) : [];

  // ── server
  const pj = await http.get('/plans.js');
  A('1  the browser can load /plans.js', pj.status === 200 && /FinFlowPlans/.test(pj.text), 'status ' + pj.status);
  const aiCap = require(path.join(ROOT, 'ai-cap.js'));
  const capsOk = ['trial', 'pro', 'business', 'scale'].every(p => aiCap.capFor(p, 'shared') === Plans.limit(p, 'ai') && aiCap.capFor(p, 'scan') === Plans.limit(p, 'scans'));
  A('1b the server\'s AI caps are the plans.js numbers', capsOk, JSON.stringify(['trial', 'pro', 'business', 'scale'].map(p => [p, aiCap.capFor(p, 'shared'), Plans.limit(p, 'ai')])));

  // ── landing page (static, generated from plans.js)
  const ld = new JSDOM(fs.readFileSync(path.join(ROOT, 'public', 'landing.html'), 'utf8')).window.document;
  for (const id of Plans.PAID) {
    const card = ld.querySelector('.p-card[data-plan="' + id + '"]');
    const got = card ? [...card.querySelectorAll('.p-feat')].map(e => norm(e.textContent).replace(/^✓\s*/, '')) : [];
    eq('2  landing ' + id + ' card lines = plans.js', got, Plans.cardLines(id));
    eq('2b landing ' + id + ' monthly price = plans.js', card ? norm((card.querySelector('.p-amt') || {}).textContent).replace(/[^\d]/g, '') : null, String(Plans.PLANS[id].monthly));
  }
  const ldCmp = ld.getElementById('plan-compare');
  const ldRows = ldCmp ? [...ldCmp.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => norm(td.textContent))) : [];
  eq('2c landing has the plan comparison, row for row from plans.js', ldRows, Plans.comparisonRows().map(([l, v]) => [l, ...v]));
  const gen = require(path.join(ROOT, 'scripts', 'gen-plan-cards.js'));
  const cur = fs.readFileSync(path.join(ROOT, 'public', 'landing.html'), 'utf8');
  A('2d landing.html is exactly what the generator writes from plans.js (nobody edited a card by hand)', gen.render(cur) === cur, 'run: node scripts/gen-plan-cards.js');

  // ── in-app Pricing page
  try { w.initPricing(); } catch (_) {}
  await settle(4, 30);
  for (const [id, el] of [['pro', 'pro-features'], ['business', 'biz-features'], ['scale', 'scale-features']]) {
    eq('3  in-app ' + id + ' card lines = plans.js', lines(d.getElementById(el)), Plans.cardLines(id));
  }
  const appCmp = d.getElementById('plan-compare-app');
  const appRows = appCmp ? [...appCmp.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => norm(td.textContent))) : [];
  eq('3b in-app plan comparison, row for row from plans.js (replaces the removed competitor table)', appRows, Plans.comparisonRows().map(([l, v]) => [l, ...v]));
  eq('3c in-app prices = plans.js (monthly)', ['price-pro', 'price-biz', 'price-scale'].map(i => norm((d.getElementById(i) || {}).textContent)), Plans.PAID.map(p => '$' + Plans.PLANS[p].monthly));
  const tg = d.getElementById('billing-toggle'); if (tg) tg.checked = true;
  try { w.toggleBilling(); } catch (_) {}
  eq('3d in-app prices = plans.js (yearly: per month, and the year)', [norm((d.getElementById('price-pro') || {}).textContent), norm((d.getElementById('price-pro-sub') || {}).textContent).split(' ·')[0]],
     ['$' + Plans.PLANS.pro.annualMonthly, '$' + (Plans.PLANS.pro.annualMonthly * 12).toLocaleString('en-US') + '/yr']);
  if (tg) tg.checked = false; try { w.toggleBilling(); } catch (_) {}

  // ── the client gates, executed as a Pro account (D-F)
  eq('4  premise: the account is on Pro', w.eval('currentUserPlan'), 'pro');
  const upgradeShown = () => !!d.getElementById('upgrade-modal-overlay');
  const clearUpgrade = () => { const o = d.getElementById('upgrade-modal-overlay'); if (o) o.remove(); };
  clearUpgrade();
  try { w.showPage('banking'); } catch (_) {}
  await settle(4, 30);
  A('4b Pro opens Banking (bug: upgrade prompt — the landing page sold bank sync on Pro)', !upgradeShown() && !!(d.getElementById('page-banking') || {}).classList && d.getElementById('page-banking').classList.contains('active'), 'upgrade prompt: ' + upgradeShown());
  clearUpgrade();
  let scannerBlocked = false;
  const _orig = w.showUpgradeModal; w.showUpgradeModal = f => { if (f === 'scanner') scannerBlocked = true; return _orig && _orig(f); };
  // Past the gate the page previews the file and sends it to /api/ai/scan — a pass-through fetch spy records that the
  // scan request was made. (jsdom has no URL.createObjectURL; a stand-in is provided for the preview only.)
  let scannerReached = false; const _f = w.fetch;
  w.fetch = function (u) { if (String(u).indexOf('/api/ai/scan') >= 0) scannerReached = true; return _f.apply(this, arguments); };
  if (!w.URL.createObjectURL) w.URL.createObjectURL = () => 'blob:harness';
  try { w.handleScannerFile(new w.File(['receipt'], 'r.png', { type: 'image/png' })); } catch (_) {}
  for (let i = 0; i < 40 && !scannerReached && !scannerBlocked; i++) await new Promise(r => setTimeout(r, 50));
  await settle(4, 50);
  w.fetch = _f; w.showUpgradeModal = _orig; clearUpgrade();
  A('4c Pro can use the receipt scanner (bug: upgrade prompt)', !scannerBlocked && scannerReached, 'blocked: ' + scannerBlocked + ' · reached the scanner: ' + scannerReached);
  try { w.showPage('mrr'); } catch (_) {}
  await settle(3, 30);
  A('4d MRR stays Business and up — Pro sees the upgrade prompt', upgradeShown(), 'no prompt');
  clearUpgrade();
  eq('4e the client entity cap = plans.js (Pro: 1)', w.eval('typeof _entityLimitFor === "function" ? _entityLimitFor("pro") : null'), Plans.limit('pro', 'entities'));
}, { extraSeed: async ({ client, userId }) => {
  await client.query(`UPDATE users SET data = data || '{"plan":"pro"}'::jsonb WHERE id = $1`, [userId]);
} });
