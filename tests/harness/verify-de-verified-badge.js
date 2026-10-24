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
  const badge = [...d.querySelectorAll('#acc-directory-grid [data-verified-on]')].find(b => b.getAttribute('data-verified-on') === '2026-03-14');   // Cara's card
  A('2b hovering the badge says what was checked and when', !!badge && /credentials/i.test(badge.getAttribute('title') || '') && /14 March 2026/.test(badge.getAttribute('title') || ''), badge ? badge.getAttribute('title') : 'no badge');
  // FA-L3: the accountants page promises Preferred Partners a badge and to be listed first — make it true
  A('3  a Preferred Partner (rated 4.6) is listed before a higher-rated non-partner (4.9) (bug: by rating only)', dir.length >= 2 && dir[0].last_name === 'Partner' && dir[0].preferred_partner === true, JSON.stringify(dir.map(x => [x.last_name, x.avg_rating, x.preferred_partner])));
  const cardsTxt = [...d.querySelectorAll('#acc-directory-grid .card')].map(c => c.textContent.replace(/\s+/g, ' '));
  A('3b …and their card shows the Preferred Partner badge (only theirs)', cardsTxt.some(t => /Pia Partner/.test(t) && /Preferred Partner/.test(t)) && !cardsTxt.some(t => /Cara Checked/.test(t) && /Preferred Partner/.test(t)), cardsTxt.map(t => t.slice(0, 80)).join(' || '));
}, { extraSeed: async ({ client }) => {
  await client.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, verified_at, country, specialisation, avg_rating, review_count, preferred_partner)
                      VALUES ('pp@finflow.test', 'x', 'Pia', 'Partner', 'Partner LLP', 'CODEPP', 'verified', '2026-02-01T10:00:00Z', 'United Kingdom', 'Tax', 4.6, 12, true)`);
  await client.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, verified_at, country, specialisation, avg_rating, review_count)
                      VALUES ('hr@finflow.test', 'x', 'Hal', 'Rated', 'Rated Co', 'CODEHR', 'verified', '2026-02-02T10:00:00Z', 'United Kingdom', 'Tax', 4.9, 30)`);
  await client.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, verified_at, country, specialisation)
                      VALUES ('chk@finflow.test', 'x', 'Cara', 'Checked', 'Checked & Co', 'CODECHK', 'verified', '2026-03-14T10:00:00Z', 'United Kingdom', 'Tax')`);
} });
