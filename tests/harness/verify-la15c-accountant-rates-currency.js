'use strict';
/**
 * verify-la15c-accountant-rates-currency.js — LA17 + LA15c.
 *
 * LA17 (found during LA15c): the accountant sign-up form collects pricing (hourly rate, up to 4 packages, a note) and
 * POSTs it, but /api/accountants/register never read it — every accountant's pricing was dropped, so the marketplace
 * could only ever say "Rates on request".
 * LA15c (owner decision 2026-10-14): an accountant's rates are in THEIR OWN currency (`rate_currency`), shown with that
 * currency's symbol on the marketplace — the card printed a literal "$".
 *
 * Real SPA + real scratch Postgres. An accountant registers through the real route (Trinidad & Tobago, TTD): hourly
 * 450, package "Year-end accounts" 3,000, a pricing note. Test setup marks them verified (admin step).
 *   stored        hourly_rate 450 · packages [3,000] · rate_currency TTD · has_pricing true     bug: null / [] / — / false
 *   directory API rate_currency "TTD"                                                          bug: absent
 *   marketplace   card "From TT$450/hr"                                                        bug: "Rates on request"
 *   validation    rateCurrency "XX" → 400                                                      bug: 201 (ignored)
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la15c-accountant-rates-currency.js
 */
const { run } = require('./clientMoneyKit.js');

const REG = (email, extra) => Object.assign({
  conductAccepted: true, conductVersion: require('../../conduct-policy').VERSION,   // D-E: sign-up accepts the current Professional Conduct Policy
  firstName: 'Tara', lastName: 'Ledger', email, password: 'harness-password-not-a-secret', firm: 'Ledger & Co',
  country: 'Trinidad & Tobago', specialisation: 'Small business', bio: 'Caribbean SMEs', experience: '5-10',
  verification: { method: 'membership', membershipNumber: 'ICATT-1234' },
  hourlyRate: 450, packages: [{ name: 'Year-end accounts', price: 3000 }], pricingNote: 'Free first call', rateCurrency: 'TTD',
}, extra || {});

run('LA15c / LA17 — accountant pricing is saved and shown in the accountant\'s own currency', async ({ w, d, settle, eq, http }) => {
  const { client: c } = global.__la15c;
  // Whole row as JSON, so a schema without rate_currency (the old code) reports it absent instead of erroring.
  const row = ((await c.query(`SELECT row_to_json(a) AS j FROM accountants a WHERE email = $1`, ['la15c@finflow.test'])).rows[0] || {}).j || {};
  eq('stored: hourly rate', row.hourly_rate == null ? null : Number(row.hourly_rate), 450, null);
  eq('stored: packages', (row.packages || []).map(p => [p.name, Number(p.price)]), [['Year-end accounts', 3000]], []);
  eq('stored: pricing note', row.pricing_note, 'Free first call', '');
  eq('stored: has_pricing', row.has_pricing, true, false);
  eq('stored: rate currency', row.rate_currency, 'TTD', undefined);

  const dir = (await http.get('/api/accountants/directory')).json || [];
  const me = dir.find(a => a.last_name === 'Ledger') || {};
  eq('directory API carries the rate currency', me.rate_currency, 'TTD', undefined);

  w.showPage('find-accountant');   // the directory loads at sign-in (ff:authed); opening the page renders it
  await settle(20, 50);
  const grid = ((d.getElementById('acc-directory-grid') || {}).textContent || '').replace(/\s+/g, ' ');
  eq('marketplace card: "From TT$450/hr"', /From TT\$450\/hr/.test(grid), true, false);
  eq('marketplace card: no bare "$450"', /(^|[^T])\$450/.test(grid), false);

  // The real sign-up form (/join): picking the country defaults the rate currency, the "$" adornments follow it,
  // and the pricing the form submits carries it.
  {
    const { JSDOM } = require('jsdom');
    const origin = new URL(w.location.href).origin;
    const page = await http.get('/join');
    const jd = new JSDOM(page.text, { url: origin + '/join', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
    await new Promise(r => setTimeout(r, 1500));
    const jw = jd.window, jdoc = jw.document;
    const cty = jdoc.getElementById('country');
    cty.value = 'Trinidad & Tobago'; cty.dispatchEvent(new jw.Event('change'));
    eq('sign-up: currency follows the country (TTD)', (jdoc.getElementById('rate-currency') || {}).value, 'TTD', undefined);
    eq('sign-up: rate adornment shows TT$', [...jdoc.querySelectorAll('.rate-sym')].map(e => e.textContent), ['TT$'], ['$']);
    jdoc.getElementById('rate-hourly').value = '450';
    const sent = jw.collectPricing();
    eq('sign-up: submitted pricing carries rateCurrency', [sent.hourlyRate, sent.rateCurrency], [450, 'TTD'], [450, undefined]);
    jw.close();
  }

  const bad = await http.request('POST', '/api/accountants/register', REG('la15c-bad@finflow.test', { rateCurrency: 'XX' }));
  eq('an invalid rate currency is refused', bad.status, 400, 201);
}, { extraSeed: async ({ http, client }) => {
  global.__la15c = { client };
  const r = await http.request('POST', '/api/accountants/register', REG('la15c@finflow.test'));
  if (r.status >= 300) throw new Error('register ' + r.status + ' ' + r.text);
  await client.query(`UPDATE accountants SET status = 'verified', verified_at = NOW() WHERE email = $1`, ['la15c@finflow.test']);   // test setup: the admin verification step
} });
