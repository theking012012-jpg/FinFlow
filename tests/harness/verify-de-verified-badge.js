'use strict';
/**
 * verify-de-verified-badge.js — D-E (owner decision 2026-10-23): the "Verified" badge shows WHEN FinFlow checked the
 * accountant's credentials. Before: a bare "✓ Verified" with no date — a client could not tell a check from last week
 * from one years old (the Conduct Policy, section 3, promises the date is shown).
 * The check date is accountants.verified_at, set when an admin approves the accountant.
 * The REAL SPA + real server (clientMoneyKit). Seed: one verified accountant, checked 14 March 2026 10:00 UTC.
 */
const { run } = require('./clientMoneyKit.js');

run('D-E — the Verified badge shows the date the credentials were checked', async ({ w, d, settle, http, A }) => {
  const dir = (await http.get('/api/accountants/directory')).json || [];
  const a = dir.find(x => x.last_name === 'Checked') || {};
  A('1  the directory says when each accountant was checked (verified_at; bug: not returned)', String(a.verified_at || '').slice(0, 10) === '2026-03-14', JSON.stringify(a).slice(0, 200));
  try { w.showPage('find-accountant'); } catch (_) {}
  await settle(20, 60);
  try { w.filterAccountants(); } catch (_) {}
  await settle(4, 40);
  const grid = ((d.getElementById('acc-directory-grid') || {}).textContent || '').replace(/\s+/g, ' ');
  A('2  the card\'s badge reads "Verified · checked 14 Mar 2026" (bug: a bare "✓ Verified")', /Verified · checked 14 Mar 2026/.test(grid), grid.slice(0, 300));
  const badge = d.querySelector('#acc-directory-grid [data-verified-on]');
  A('2b hovering the badge says what was checked and when', !!badge && /credentials/i.test(badge.getAttribute('title') || '') && /14 March 2026/.test(badge.getAttribute('title') || ''), badge ? badge.getAttribute('title') : 'no badge');
}, { extraSeed: async ({ client }) => {
  await client.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, verified_at, country, specialisation)
                      VALUES ('chk@finflow.test', 'x', 'Cara', 'Checked', 'Checked & Co', 'CODECHK', 'verified', '2026-03-14T10:00:00Z', 'United Kingdom', 'Tax')`);
} });
