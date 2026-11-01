'use strict';
/**
 * verify-sanctions-country — owner decision 2026-11-01 (US-registered company): FinFlow is not offered to businesses in
 * countries under comprehensive United States embargoes (Terms §11). Cuba came off every country list, and the SERVER
 * refuses Cuba, Iran and North Korea at the write — a business created or edited with one, or a personal bank country —
 * because the page list alone was never the authority (the server took any 2-letter code). Existing records are listed
 * by a read-only tool, never changed (Rule 8).
 * Real server, real /app in Chromium, scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-sanctions-country.js
 *
 * Bug values: POST /api/entities {country:'CU'} 201 (3 embargoed businesses stored); PUT 200; personal bank 200; Cuba offered in 3 lists.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const { runBrowser } = require('./browserKit.js');

runBrowser('Embargoed countries — refused at the write, gone from the lists', async ({ open, A, eq, J, http, c, uid, base, server }) => {
  const mk = (country, name) => http.post('/api/entities', { name, currency: 'USD', country, timezone: 'UTC' });
  for (const [cc, n] of [['CU', 'Cuba'], ['IR', 'Iran'], ['KP', 'North Korea'], ['cu', 'Cuba']]) {
    const r = await mk(cc, 'Biz ' + cc);
    eq(`create a business in ${cc}: refused (SANCTIONED_COUNTRY)`, [r.status, (r.json || {}).code, new RegExp('not available for ' + n + ' because of United States sanctions').test((r.json || {}).error || '')], [400, 'SANCTIONED_COUNTRY', true], [201, undefined, false]);
  }
  eq('…and nothing was stored', (await c.query(`SELECT count(*)::int n FROM entities WHERE upper(data->>'country') IN ('CU','IR','KP')`)).rows[0].n, 0, 3);
  const ok = await mk('TT', 'Port of Spain Co');
  eq('control: a business in Trinidad and Tobago is created (201)', ok.status, 201);
  const e1 = (await J('GET', '/api/entities'))[0];
  const up = await http.put('/api/entities/' + e1.id, { country: 'CU' });
  eq('changing a business to Cuba: refused', [up.status, (up.json || {}).code], [400, 'SANCTIONED_COUNTRY'], [200, undefined]);
  eq('…the business keeps its country', (await c.query(`SELECT data->>'country' AS c FROM entities WHERE id = $1`, [e1.id])).rows[0].c, e1.country || null);
  eq('control: changing it to Jamaica works', (await http.put('/api/entities/' + e1.id, { country: 'JM' })).status, 200);
  const pb = await http.put('/api/personal-bank', { country: 'IR' });
  eq('personal bank country Iran: refused', [pb.status, (pb.json || {}).code], [400, 'SANCTIONED_COUNTRY'], [200, undefined]);
  eq('control: personal bank country Barbados works', (await http.put('/api/personal-bank', { country: 'BB' })).status, 200);

  // the lists the pages render
  const page = await open({ width: 1280, height: 900 });
  const lists = await page.evaluate(() => {
    if (typeof window._f94FillRegion === 'function') window._f94FillRegion();
    const vals = id => { const el = document.getElementById(id); return el ? [...el.options].map(o => o.value) : null; };
    return { nb: vals('nb-country'), pb: vals('pers-bank-country') };
  });
  A('Create Business country list (F94): no Cuba, still lists the Caribbean', lists.nb && !lists.nb.includes('CU') && lists.nb.includes('TT') && lists.nb.includes('PR'), JSON.stringify(lists.nb && lists.nb.length));
  A('personal bank country list: no Cuba', lists.pb && !lists.pb.includes('CU') && lists.pb.length > 10, JSON.stringify(lists.pb && lists.pb.length));
  const ob = String((await http.get('/js/app-15-steps.js')).text || '');
  A('[structural] onboarding country list (served app-15-steps.js): no Cuba, still has Puerto Rico', !/value="CU"/.test(ob) && /value="PR"/.test(ob));
  const dates = await page.evaluate(() => [window.FinFlowDates && FinFlowDates.currencyForCountry && FinFlowDates.currencyForCountry('CU'), window.FinFlowDates && FinFlowDates.currencyForCountry('TT')]);
  eq('no default currency is suggested for Cuba any more (TT still TTD)', dates, [null, 'TTD'], ['CUP', 'TTD']);

  // the read-only tool reports a pre-existing record and changes nothing
  await c.query(`INSERT INTO entities (user_id, data, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`, [uid, { name: 'Legacy Havana', country: 'CU', currency: 'USD' }]);
  await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW())`, [uid, { key: 'pers_bank_country', value: JSON.stringify('KP') }]);
  const snap = async () => (await c.query(`SELECT md5(string_agg(id || ':' || data::text, ',' ORDER BY id)) h FROM entities`)).rows[0].h + '|' + (await c.query(`SELECT md5(string_agg(id || ':' || data::text, ',' ORDER BY id)) h FROM user_settings`)).rows[0].h;
  const before = await snap();
  let out = '';
  try { out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'tools', 'launch', 'list-embargoed-country-records.js')], { env: Object.assign({}, process.env, { DATABASE_URL: process.env.DATABASE_URL }), encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  A('read-only tool lists the existing Cuba business and the North Korea bank setting', /Businesses: 1/.test(out) && /"Legacy Havana" · CU Cuba/.test(out) && /Personal bank country settings: 1/.test(out) && /KP North Korea/.test(out), out.slice(0, 400));
  eq('…and changed nothing', await snap(), before);
}, {});
