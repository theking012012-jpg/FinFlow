'use strict';
/**
 * verify-accountant-pending-ui.js — N78, accountant side. The dashboard's pending list offers "Approve"
 * only for CLIENT-initiated requests; a referral link (the client never asked) shows "awaiting client
 * approval" instead. The response shape (requested_by) is executed against the real server in
 * verify-accountant-consent.js; here the static page renders a canned pending-requests list in jsdom.
 *   client-initiated row → Approve button              (control)
 *   referral row         → no Approve button, awaiting-client note   (bug: Approve button)
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-pending-ui.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const API = {
  '/api/accountants/me': { first_name: 'Ada', last_name: 'L', status: 'verified', referral_code: 'ADA1', avg_rating: 0, firm: 'F', specialisation: 'Tax', email: 'ada@x.test', country: 'UK', experience: '1y', bio: 'B' },
  '/api/accountants/clients': [],
  '/api/accountants/earnings': { earnings: [], totalFormatted: '$0.00' },
  '/api/accountants/pending-requests': [
    { user_id: 11, client_name: 'Asked Co', client_email: 'a@x.test', client_plan: 'business', requested_at: '2026-07-20T00:00:00Z', requested_by: 'client' },
    { user_id: 22, client_name: 'Referred Co', client_email: 'r@x.test', client_plan: 'trial', requested_at: '2026-07-21T00:00:00Z', requested_by: 'referral' },
  ],
  '/api/accountants/deadlines': [],
  '/api/accountants/stripe-status': { connected: true },
};

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    let html = fs.readFileSync(path.join(process.cwd(), 'public', 'accountant-dashboard.html'), 'utf8');
    const stub = `<script>window.FinFlowTiers={TIERS:[{name:'Bronze',min:1,max:24}],tierForAccountant:function(){return this.TIERS[0];},commissionRateFor:function(){return 0;},estimateStripeFeeCents:function(){return 0;},splitBilling:function(c){return {billedCents:c,stripeFeeCents:0,commissionCents:0,accountantNetCents:c};}};
      window.fetch=function(u){var p=String(u).split('?')[0];var data=(${JSON.stringify(API)})[p];return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(data==null?{}:data);}});};</script>`;
    html = html.replace('<script src="/tier-config.js"></script>', stub);
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://finflow.test/accountant-dashboard.html' });
    const { window } = dom;
    for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 50));
    const rows = [...window.document.querySelectorAll('[onclick^="approveRequest("]')].map(b => b.getAttribute('onclick'));
    A('client-initiated request has an Approve button (control)', rows.some(o => /approveRequest\(11,/.test(o)), JSON.stringify(rows));
    A('referral link has NO Approve button (bug: Approve)', !rows.some(o => /approveRequest\(22,/.test(o)), JSON.stringify(rows));
    A('referral link shows "awaiting client approval"', /awaiting client approval/i.test(window.document.body.textContent));
    try { window.close(); } catch {}
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (accountant pending UI)\n`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
