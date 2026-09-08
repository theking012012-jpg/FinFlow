'use strict';
/**
 * verify-accountant-dashboard-qa.js — accountant dashboard QA fixes, loaded as a static page in jsdom
 * with a stubbed API. Proves:
 *   - STORED XSS FIX: a linked client whose name contains markup is rendered ESCAPED (no live <img>
 *     element is injected into the accountant's DOM; the markup shows as text).
 *   - OVERDUE DEADLINES FIX: a past-due deadline is shown (previously only future dates rendered, so
 *     overdue filings silently vanished) and carries the "overdue" label.
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-dashboard-qa.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const XSS_NAME = '<img src=x onerror="window.__xss=1">Evil Corp';

const API = {
  '/api/accountants/me': { first_name: 'Ada', last_name: 'Lovelace', status: 'verified', referral_code: 'ADA123', avg_rating: 0, firm: 'Lovelace & Co', specialisation: 'Tax', email: 'ada@x.test', country: 'UK', experience: '10y', bio: 'Bio' },
  '/api/accountants/clients': [
    { id: 1, client_name: XSS_NAME, client_email: 'evil@x.test', client_plan: 'business', status: 'active', subscription_status: 'active', referral_month: 1, referral_months_total: 3 },
  ],
  '/api/accountants/earnings': { earnings: [], totalFormatted: '$0.00' },
  '/api/accountants/pending-requests': [],
  '/api/accountants/deadlines': [
    { id: 1, client_name: 'Past Due Co', filing_type: 'VAT Return', due_date: '2020-01-15T00:00:00.000Z' },
    { id: 2, client_name: 'Future Co', filing_type: 'Annual Return', due_date: '2035-06-01T00:00:00.000Z' },
  ],
  '/api/accountants/stripe-status': { connected: true },
};

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    let html = fs.readFileSync(path.join(process.cwd(), 'public', 'accountant-dashboard.html'), 'utf8');
    // Replace the external tier-config <script src> with a minimal inline stub, and inject a fetch stub
    // BEFORE the page's own script so boot()'s API calls are served canned data (no server needed).
    const tierStub = `<script>window.FinFlowTiers={TIERS:[{name:'Bronze',min:1,max:24},{name:'Silver',min:25,max:49}],tierForAccountant:function(n){return this.TIERS[0];},commissionRateFor:function(){return 0;},estimateStripeFeeCents:function(){return 0;},splitBilling:function(c){return {billedCents:c,stripeFeeCents:0,commissionCents:0,accountantNetCents:c};}};
      window.fetch=function(u){var p=String(u).split('?')[0];var data=(${JSON.stringify(API)})[p];return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(data==null?{}:data);}});};</script>`;
    html = html.replace('<script src="/tier-config.js"></script>', tierStub);

    const vc = new VirtualConsole();
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://finflow.test/accountant-dashboard.html' });
    const { window } = dom;
    // let boot()'s promise chain settle
    for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 50));
    const doc = window.document;

    // ── XSS ──
    const tbody = doc.getElementById('clients-tbody');
    A('clients table rendered', tbody && tbody.innerHTML.length > 0);
    A('malicious client name did NOT inject a live <img> element', tbody && tbody.querySelector('img') === null);
    A('the markup is present as escaped TEXT (not HTML)', tbody && tbody.textContent.includes('<img'), 'tbody text: ' + (tbody && tbody.textContent.slice(0, 80)));
    A('onerror handler never fired (window.__xss unset)', !window.__xss);

    // ── OVERDUE DEADLINES ──
    const all = doc.getElementById('all-deadlines');
    A('deadlines list rendered', all && all.innerHTML.length > 0);
    A('overdue (past-due) deadline IS shown', all && all.textContent.includes('Past Due Co'), 'text: ' + (all && all.textContent.slice(0, 120)));
    A('overdue item carries the "overdue" label', all && /overdue/i.test(all.textContent));
    A('future deadline also shown', all && all.textContent.includes('Future Co'));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (accountant dashboard QA: XSS + overdue)\n`);
    try { window.close(); } catch {}
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  process.exitCode = fail === 0 ? 0 : 1;
})();
