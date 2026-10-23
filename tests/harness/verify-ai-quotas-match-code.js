'use strict';
/**
 * verify-ai-quotas-match-code.js — owner ruling 2026-10-23: "AI questions per month: fix according to what the code says".
 * The server's monthly caps (ai-cap.js, F18): Pro 500 questions · Business 2,000 + 50 receipt scans · Scale 5,000 + 100.
 * What users were told instead:
 *   landing + in-app plan cards   Pro "50 AI queries / month", Business "Unlimited", Pro's missing feature "Unlimited AI"
 *   the AI upgrade prompt          "Unlimited AI Queries — No monthly cap — ask anything", "Priority AI processing"
 *   the AI panel itself            a SECOND cap in the browser: a Pro user was stopped after 50 questions per PAGE LOAD
 *                                  (an in-memory counter, back to 0 on reload) — neither 50 a month nor the server's 500
 *   when the real cap is reached   "Error: Monthly AI limit reached — upgrade for more." with no numbers, no upgrade path
 * After: every surface states the code's numbers; the browser keeps no cap of its own (the server's 402 is the one
 * gate) and, at the cap, says how many were used of how many this month and offers the upgrade.
 * Seed (clientMoneyKit + DB): the account is on Pro and has used 500 of 500 questions this month.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const aiCap = require('../../ai-cap.js');
const { run } = require('./clientMoneyKit.js');

run('AI quotas — every surface says what the server enforces; one cap, the server\'s', async ({ w, d, settle, eq, A }) => {
  const N = n => n.toLocaleString('en-US');
  const caps = { pro: aiCap.capFor('pro', 'shared'), business: aiCap.capFor('business', 'shared'), businessScan: aiCap.capFor('business', 'scan'), scale: aiCap.capFor('scale', 'shared'), scaleScan: aiCap.capFor('scale', 'scan') };
  eq('0  premise: the code\'s caps (hand-checked against ai-cap.js defaults)', [caps.pro, caps.business, caps.businessScan, caps.scale, caps.scaleScan], [500, 2000, 50, 5000, 100]);

  // landing page pricing cards — rendered text, one card per plan
  const ld = new JSDOM(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'landing.html'), 'utf8')).window.document;
  const cards = [...ld.querySelectorAll('.p-card')].map(c => c.textContent.replace(/\s+/g, ' '));
  const card = t => cards.find(c => c.includes(t)) || '';
  A('1  landing Pro: "' + N(caps.pro) + ' AI questions a month" (bug: 50)', card('Pro').includes(N(caps.pro) + ' AI questions a month') && !/\b50 AI/.test(card('Pro')), card('Pro').slice(0, 260));
  A('1b landing Business: "' + N(caps.business) + ' AI questions + ' + caps.businessScan + ' receipt scans a month" (bug: Unlimited)', card('Business').includes(N(caps.business) + ' AI questions + ' + caps.businessScan + ' receipt scans a month'), card('Business').slice(0, 300));
  A('1c landing Scale: "' + N(caps.scale) + ' AI questions + ' + caps.scaleScan + ' receipt scans a month"', card('Scale').includes(N(caps.scale) + ' AI questions + ' + caps.scaleScan + ' receipt scans a month'), card('Scale').slice(0, 260));
  A('1d landing: nothing says AI is unlimited', !/Unlimited[^.]{0,20}AI/i.test(cards.join(' ')), (cards.join(' ').match(/Unlimited[^.]{0,30}AI[^.]{0,10}/i) || [''])[0]);

  // in-app Pricing page
  try { w.initPricing(); } catch (_) {}
  await settle(4, 30);
  const txt = id => ((d.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ');
  A('2  in-app Pro card: ' + N(caps.pro) + ' AI questions a month (bug: 50)', txt('pro-features').includes(N(caps.pro) + ' AI questions a month') && !/Unlimited AI/i.test(txt('pro-features')), txt('pro-features').slice(0, 300));
  A('2b in-app Business card: ' + N(caps.business) + ' + ' + caps.businessScan + ' scans (bug: Unlimited)', txt('biz-features').includes(N(caps.business) + ' AI questions + ' + caps.businessScan + ' receipt scans a month') && !/Unlimited AI/i.test(txt('biz-features')), txt('biz-features').slice(0, 300));
  A('2c in-app Scale card: ' + N(caps.scale) + ' + ' + caps.scaleScan + ' scans', txt('scale-features').includes(N(caps.scale) + ' AI questions + ' + caps.scaleScan + ' receipt scans a month'), txt('scale-features').slice(0, 300));

  // the AI upgrade prompt
  try { w.showUpgradeModal('ai_limit'); } catch (_) {}
  await settle(3, 30);
  const up = ((d.getElementById('upgrade-modal-overlay') || {}).textContent || '').replace(/\s+/g, ' ');
  A('3  the AI upgrade prompt states the Business and Scale numbers, never "no monthly cap" (bug: "Unlimited AI Queries — No monthly cap")', up.includes(N(caps.business)) && up.includes(N(caps.scale)) && !/No monthly cap|Unlimited AI|Priority AI/i.test(up), up.slice(0, 260));
  try { const o = d.getElementById('upgrade-modal-overlay'); if (o) o.remove(); } catch (_) {}

  // one cap: the server's. The browser must not stop a Pro user on its own count.
  eq('4  premise: this account is on Pro', w.eval('currentUserPlan'), 'pro');
  w.eval('try { _aiQueryCount = 50; } catch (e) {}');   // the old in-memory counter at its limit (a no-op once it is gone)
  let aiCalls = 0; const _f = w.fetch;
  w.fetch = function (u, o) { if (String(u).indexOf('/api/ai') >= 0 && String(u).indexOf('/api/ai/') < 0) aiCalls++; return _f.apply(this, arguments); };   // a spy, passes through
  try { await w.sendAIQuery('What were my expenses this month?'); } catch (_) {}
  await settle(10, 50);
  w.fetch = _f;
  eq('4b after 50 questions in one session the question still reaches the server (bug: stopped in the browser, 0 requests)', aiCalls, 1, 0);

  // …and the server's cap, when reached, is shown with its numbers and the way up
  const bot = [...d.querySelectorAll('#ai-messages .ai-msg-bot')].map(e => e.textContent.replace(/\s+/g, ' ')).pop() || '';
  A('5  at the cap the chat says "You have used 500 of 500 AI questions this month" (bug: "Error: Monthly AI limit reached…")', /used 500 of 500 AI questions this month/.test(bot) && !/^Error:/.test(bot), JSON.stringify(bot.slice(0, 200)));
  A('5b …and the upgrade prompt opens', !!d.getElementById('upgrade-modal-overlay'), 'no upgrade prompt');
}, { extraSeed: async ({ client, userId }) => {
  await client.query(`UPDATE users SET data = data || '{"plan":"pro"}'::jsonb WHERE id = $1`, [userId]);
  await client.query(`INSERT INTO ai_usage (user_id, billing_month, query_count) VALUES ($1, date_trunc('month', NOW()), 500)
                      ON CONFLICT (user_id, billing_month) DO UPDATE SET query_count = 500`, [userId]);
} });
