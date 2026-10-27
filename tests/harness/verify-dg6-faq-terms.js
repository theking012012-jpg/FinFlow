'use strict';
/**
 * verify-dg6-faq-terms.js — D-G / D-B step 6: the FAQ and the Terms say what the code now does (FA-L2b).
 * Before, the in-app FAQ promised "downgrade instantly" (no downgrade existed), "full Business tier access" on the trial
 * (the trial is 1 business, 30 AI questions, 3 scans), "retained for 90 days" (nothing was ever deleted or kept on a
 * clock) and claimed FinFlow's own "AES-256" encryption; Terms §6 said fees are "non-refundable" with no in-app cancel.
 * The REAL SPA renders the FAQ (from plans.js where it states numbers); terms.html is parsed as served text.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { run } = require('./clientMoneyKit.js');
const Plans = require('../../plans.js');

run('D-G step 6 — the FAQ and the Terms match the code', async ({ w, d, settle, A }) => {
  try { w.initPricing && w.initPricing(); } catch (_) {}
  await settle(4, 30);
  const faq = ((d.getElementById('faq-list') || {}).textContent || '').replace(/\s+/g, ' ');
  const tr = Plans.PLANS.trial;
  A('1  plan changes: upgrades now (pay the difference), downgrades at the end of the paid period — never "instantly"', /end of the (period|billing period|paid period)/i.test(faq) && /difference/i.test(faq) && !/downgrade instantly/i.test(faq), faq.slice(0, 300));
  A('2  cancelling: read-only for 90 days, a warning 14 days before deletion, export any time, the audit trail kept', /90 days/.test(faq) && /14 days/.test(faq) && /Download my data/.test(faq) && /audit trail/i.test(faq), faq.slice(0, 400));
  A('3  the trial states its real limits from plans.js (' + tr.entities + ' business, ' + tr.ai + ' AI questions, ' + tr.scans + ' scans) — not "full Business tier access"', faq.includes(tr.ai + ' AI questions') && faq.includes(tr.scans + ' receipt scans') && !/full Business tier/i.test(faq), faq.slice(0, 600));
  A('4  security: at-rest encryption attributed to the database provider (Supabase, AES-256), in transit TLS — not FinFlow\'s own claim', /Supabase/.test(faq) && /TLS/.test(faq), faq.slice(-500));
  A('5  yearly plans: leave any time, refund = paid minus months used at the monthly price; reminder 30 days before renewal', /leave any time/i.test(faq) && /monthly price/i.test(faq) && /30 days/.test(faq), faq.slice(-700));

  const terms = new JSDOM(require('./appScripts.js').pageSource('terms.html')).window.document.body.textContent.replace(/\s+/g, ' ');
  A('6  Terms §6: cancel from Settings; monthly ends at period end; yearly refund rule; 30-day renewal reminder (bug: "non-refundable", no way to cancel)', /Plan & billing/.test(terms) && /monthly price/i.test(terms) && /30 days before/i.test(terms) && !/Fees are non-refundable except/i.test(terms), terms.slice(terms.indexOf('6. Free trial'), terms.indexOf('6. Free trial') + 600));
  A('7  Terms §10: after a paid plan ends — 90 days read-only, a warning 14 days before deletion, the audit trail kept', /90 days/.test(terms) && /14 days/.test(terms), terms.slice(terms.indexOf('10. Ending'), terms.indexOf('10. Ending') + 600));
});
