#!/usr/bin/env node
'use strict';
/**
 * verify-la15b-accountant-client-currency.js — LA15b: the accountant's client view (accountant-client.html) wrote every
 * figure as "$" + amount, whatever the client business's currency (C3 class). A selected business now shows its own
 * symbol (shared table, public/finflow-currency.js). "All entities" is the server's consolidation into the base
 * currency (computeBooks per-row FX) — "$" is right there — but a business that cannot be converted (no rate) was
 * left out SILENTLY (C5 class); the page now says which currency is not included and how to fix it.
 *
 * Seed through the client's own routes: Island Traders (TTD) invoice 8,000 · Northwind (USD) invoice 1,500, both
 * pending, issued 2026-07-10. Clock 2026-07-25, period year.
 *   TTD selected            → Revenue "TT$8,000.00"                          bug: "$8,000.00"
 *   USD selected            → Revenue "$1,500.00"
 *   LA21 (owner decision 2026-10-15): with no reporting currency chosen, "All entities" reports in the OLDEST business's
 *   currency. Island Traders (TTD) is created first, so the base is TTD (it was USD before — the NEWEST business).
 *   All, no USD↔TTD rate    → Revenue "TT$8,000.00" + note: USD not included   bug: no note (1,500 dropped silently)
 *   All, rate 1 USD = 6.8 TTD → Revenue "TT$18,200.00" (8,000 + 1,500 × 6.8), no note
 *   node -r ./tests/harness/clock.js tests/harness/verify-la15b-accountant-client-currency.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };
const settle = async (n = 60, ms = 100) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, ms)); };

(async () => {
  let scratch, server, dom;
  console.log('\nLA15b — the accountant\'s client view shows each business\'s own currency\n');
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    await initSchema(scratch.url);
    server = await bootServer(scratch.url);

    const clientId = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'la15b-client@finflow.test', name: 'Client LA15b', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const ch = new HarnessHttp(server.baseUrl, { xff: '203.0.113.71' });
    if ((await ch.post('/api/auth/login', { email: 'la15b-client@finflow.test', password: PW })).status !== 200) throw new Error('client login');
    const J = async (m, p, b) => { const r = await ch.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
    const tt = await J('POST', '/api/entities', { name: 'Island Traders', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
    const us = await J('POST', '/api/entities', { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('POST', '/api/entities/' + tt.id + '/activate', {});
    await J('POST', '/api/invoices', { client: 'Port Co', amount: 8000, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-10', idempotency_key: 'la15b-tt' });
    await J('POST', '/api/entities/' + us.id + '/activate', {});
    await J('POST', '/api/invoices', { client: 'Acme', amount: 1500, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-10', idempotency_key: 'la15b-us' });

    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ($1,$2,'Acc','LA15b','Firm','CODELA15B','verified') RETURNING id`, ['la15b-acc@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','view')`, [accId, clientId]);

    const http = new HarnessHttp(server.baseUrl, { xff: '203.0.113.72' });
    if ((await http.post('/api/accountants/login', { email: 'la15b-acc@finflow.test', password: PW })).status !== 200) throw new Error('acc login');
    const cookiePair = [...http.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const htmlRes = await http.get(`/accountant-client?client=${clientId}`);
    if (htmlRes.status !== 200) throw new Error('GET page ' + htmlRes.status);
    const jar = new CookieJar();
    for (const [k, v] of http.cookies.entries()) jar.setCookieSync(`${k}=${v}; Path=/`, server.baseUrl);
    dom = new JSDOM(htmlRes.text, { url: `${server.baseUrl}/accountant-client?client=${clientId}`, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: new VirtualConsole() });
    const w = dom.window, d = w.document;
    const nodeFetch = global.fetch;
    w.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const abs = url.startsWith('http') ? url : server.baseUrl + (url.startsWith('/') ? url : '/' + url);
      return nodeFetch(abs, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Cookie: cookiePair }) }));
    };
    await settle(70, 100);
    const rev = () => (d.getElementById('d-revenue') || {}).textContent;
    const noteEl = () => d.getElementById('fx-coverage-note');
    const note = () => { const n = noteEl(); return !!(n && n.style.display !== 'none' && n.textContent.trim()); };
    const noteText = () => (noteEl() || {}).textContent || '';
    const pick = async id => { await w.switchEntity(String(id), d.querySelector(`.entity-item[data-entity="${id}"]`)); await settle(10, 60); };

    await pick(tt.id);
    eq('Island Traders (TTD): Revenue', rev(), 'TT$8,000.00', '$8,000.00');
    eq('TTD selected: no coverage note', note(), false);
    await pick(us.id);
    eq('Northwind (USD): Revenue', rev(), '$1,500.00');
    await pick('all');
    eq('All entities (base TTD — the oldest business, LA21), USD unconvertible: Revenue', rev(), 'TT$8,000.00');
    eq('All entities: the page says the USD figures are not included', note(), true, false);
    eq('note names the left-out currency (USD) and the fix', /USD/.test(noteText()) && /rate/i.test(noteText()), true, false);

    await J('POST', '/api/fx-rates', { from_currency: 'USD', to_currency: 'TTD', rate: 6.8, rate_date: '2026-01-01' });
    await pick(tt.id); await pick('all');
    eq('All entities with a rate: USD converted into the total (8,000 + 1,500 × 6.8)', rev(), 'TT$18,200.00');
    eq('All entities with a rate: no note', note(), false, true);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally {
    try { if (dom) dom.window.close(); } catch (_) {}
    try { if (server && server.close) await server.close(); } catch (_) {}
    try { if (scratch) await scratch.stop(); } catch (_) {}
  }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
