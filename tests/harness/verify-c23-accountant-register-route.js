'use strict';
/**
 * C23 (Cowork end-to-end test): /accountant-register reaches the accountant sign-up form.
 * BUG: /accountant-register showed the home page; the form only lived at /join.
 *   GET /accountant-register → 301 to /join     bug: 200 with the home page
 *   GET /join → the accountant sign-up page (control)
 */
const { run } = require('./moneyFixKit.js');

run('C23 — /accountant-register reaches the accountant sign-up', async ({ server, eq, A }) => {
  const r = await fetch(server.baseUrl + '/accountant-register', { redirect: 'manual' });
  eq('/accountant-register redirects to /join', [r.status, r.headers.get('location')], [301, '/join'], [200, null]);
  const j = await fetch(server.baseUrl + '/join');
  const html = await j.text();
  A('control: /join serves the accountant sign-up page', j.status === 200 && /accountant/i.test(html) && /register|sign up|join/i.test(html));
});
