'use strict';
/**
 * verify-a0-inapp-compare.js — A0 section 4, the same claim on its second surface (Rule 13). The owner approved removing
 * the unsourced competitor comparison from the landing page (861ed95); the in-app Pricing page carried its own copy
 * ("How we compare" — QuickBooks / Xero / FreshBooks prices, ✗ marks, "7-year audit trail", "20% annual discount").
 * The REAL SPA, rendered Pricing page text after initPricing().
 */
const { run } = require('./clientMoneyKit.js');

run('A0 — the in-app Pricing page has no unsourced competitor comparison', async ({ w, d, settle, A }) => {
  try { w.initPricing(); } catch (_) {}
  await settle(4, 30);
  const feats = d.getElementById('pro-features');
  const page = feats ? (feats.closest('.page') || d.body) : d.body;
  const t = (page.textContent || '').replace(/\s+/g, ' ');
  A('0  premise: the Pricing page rendered its plan cards', /Business/.test(t) && !!feats && feats.textContent.trim().length > 0, t.slice(0, 160));
  const m = t.match(/How we compare|QuickBooks|FreshBooks|\bXero\b/);
  A('1  no competitor comparison (bug: "How we compare" with QuickBooks / Xero / FreshBooks prices)', !m, m ? '…' + t.slice(Math.max(0, m.index - 40), m.index + 80) : '');
});
