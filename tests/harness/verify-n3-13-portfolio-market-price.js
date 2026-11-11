#!/usr/bin/env node
'use strict';
/**
 * verify-n3-13-portfolio-market-price.js — N3-13 (live re-audit 2026-11-11; owner chose option (a)).
 *
 * The server values holdings from the STORED price (accountant portal net worth + "Portfolio"; net-worth / portfolio
 * snapshots). A holding added with an empty "Current price" kept its COST as that price, and the live quote only reached
 * the owner's screen — so the accountant saw net worth 14,000 while the owner saw 15,985.10. Now a quote the owner's page
 * fetches (GET /api/stock-price) is saved to that person's holdings of the symbol, at most once per day.
 *
 * Real routes, real Postgres. The ONLY thing replaced is the upstream market feed: Finnhub is answered with a frozen
 * quote (the harness blocks the network — VERIFICATION.md's "price feed frozen" rule). Day 1 quote 348.51; a second quote
 * the same day at 400.00 must NOT re-write (once per day).
 *
 * Seed (the live audit's own numbers): personal accounts Savings 10,000 + Car 8,000 (assets), Car loan 5,500 (liability);
 * personal holding AAPL 10 shares, cost 150, no current price.
 * HAND-COMPUTED (Rule 6): net worth = 10,000 + 8,000 − 5,500 + 10 × 348.51 = 15,985.10 · portfolio 3,485.10
 * BUG VALUES (Rule 4): net worth 14,000.00 · portfolio 1,500.00 (10 × the 150 cost)
 *   node -r ./tests/harness/clock.js tests/harness/verify-n3-13-portfolio-market-price.js
 */
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// the frozen market feed — everything else stays blocked by clock.js
let QUOTE = 348.51;
const _blocked = global.fetch;
global.fetch = function (input, init) {
  const url = String(input && input.url || input);
  if (/^https:\/\/finnhub\.io\/api\/v1\/quote\?symbol=AAPL/.test(url)) {
    return Promise.resolve(new Response(JSON.stringify({ c: QUOTE, pc: 350.69, d: QUOTE - 350.69, dp: 0 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return _blocked(input, init);
};

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    process.env.FINNHUB_API_KEY = 'harness-frozen-feed';   // AFTER boot (boot.js scrubs it); read per request. Only the frozen AAPL feed answers — the network guard blocks the rest
    console.log('\n' + '='.repeat(78) + '\n  N3-13 — the stored price follows the market; accountant net worth == owner\'s\n' + '='.repeat(78) + '\n');
    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: 'n313@finflow.test', name: 'N313 Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('n313-acc@finflow.test', $1, 'Acc', 'N313', 'Firm', 'N313CODE', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, entity_access) VALUES ($1, $2, 'active', 'view', $3)`,
      [acc, uid, JSON.stringify({ entities: {}, personal: 'view' })]);

    const owner = new HarnessHttp(server.baseUrl);
    const OK = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 200)); return r; };
    OK(await owner.post('/api/auth/login', { email: 'n313@finflow.test', password: PW }));
    const ent = JSON.parse(OK(await owner.post('/api/entities', { name: 'N313 Co', currency: 'USD', timezone: 'UTC', country: 'US' })).text);
    OK(await owner.post('/api/entities/' + ent.id + '/activate', {}));
    OK(await owner.post('/api/personal-accounts', { name: 'Savings account', kind: 'asset', type: 'savings', value: 10000, currency: 'USD' }));
    OK(await owner.post('/api/personal-accounts', { name: 'Car', kind: 'asset', type: 'other', value: 8000, currency: 'USD' }));
    OK(await owner.post('/api/personal-accounts', { name: 'Car loan', kind: 'liability', type: 'loan', value: 5500, currency: 'USD' }));
    const h = JSON.parse(OK(await owner.post('/api/holdings', { ticker: 'AAPL', name: 'Apple Inc.', asset_type: 'Stock', shares: 10, cost_per: 150, scope: 'personal' })).text);
    A('holding created with no current price (the live form left it empty)', h && h.id != null, JSON.stringify(h).slice(0, 200));

    const accHttp = new HarnessHttp(server.baseUrl);
    OK(await accHttp.post('/api/accountants/login', { email: 'n313-acc@finflow.test', password: PW }));
    const before = JSON.parse((await accHttp.get(`/api/accountants/clients/${uid}/books`)).text || '{}').personal || {};
    console.log('  info  before any quote: portal portfolio ' + before.portfolio + ' · net worth ' + before.netWorth + ' (cost-based — nothing has priced it yet)');

    // the owner's Investments / Personal page fetches the live quote
    const q = JSON.parse(OK(await owner.get('/api/stock-price?symbol=AAPL&type=stock')).text);
    A('quote served 348.51 (frozen feed)', near(q.price, 348.51), JSON.stringify(q));
    const stored = (await c.query(`SELECT data->>'price' AS p, data->>'price_as_of' AS d FROM holdings WHERE id = $1`, [h.id])).rows[0];
    A('stored price is now the market 348.51 (bug: unchanged — the 150 cost / empty)', near(stored.p, 348.51) && !!stored.d, JSON.stringify(stored));

    const p = JSON.parse((await accHttp.get(`/api/accountants/clients/${uid}/books`)).text || '{}').personal || {};
    A('accountant portfolio 3,485.10 (bug 1,500.00)', near(p.portfolio, 3485.10), 'portfolio=' + p.portfolio);
    A('accountant net worth 15,985.10 = 12,500 + 10 × 348.51 (bug 14,000.00)', near(p.netWorth, 15985.10), 'netWorth=' + p.netWorth);

    const snap = JSON.parse(OK(await owner.post('/api/snapshots/capture', { kind: 'networth' })).text || '{}');
    const snapV = snap.value != null ? snap.value : (snap.row && snap.row.value);
    A('net-worth snapshot 15,985.10 (bug 14,000)', near(snapV, 15985.10), JSON.stringify(snap).slice(0, 200));

    // once per day: a second quote the same day at 400 does not re-write (one audited valuation change a day)
    QUOTE = 400.00;
    await owner.get('/api/stock-price?symbol=AAPL&type=stock');   // may be served from the 1-min cache; either way no re-write today
    const again = (await c.query(`SELECT data->>'price' AS p FROM holdings WHERE id = $1`, [h.id])).rows[0];
    A('same-day second quote does not re-write the stored price (still 348.51)', near(again.p, 348.51), JSON.stringify(again));

    // the wall: another person's AAPL is never touched
    const other = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: 'n313-other@finflow.test', name: 'Other', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const oh = (await c.query(`INSERT INTO holdings (user_id, entity_id, data, created_at, updated_at) VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
      [other, { ticker: 'AAPL', shares: 1, cost_per: 100, price: 100 }])).rows[0].id;
    await c.query(`UPDATE holdings SET data = data - 'price_as_of' WHERE id = $1`, [h.id]);   // force the next quote to write for the owner
    QUOTE = 348.51;
    await owner.get('/api/stock-price?symbol=AAPL&type=stock');
    const o2 = (await c.query(`SELECT data->>'price' AS p FROM holdings WHERE id = $1`, [oh])).rows[0];
    A('another user\'s AAPL holding is untouched (100)', near(o2.p, 100), JSON.stringify(o2));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
    if (e && e.errors) e.errors.forEach(x => console.log('    ' + (x && x.stack || x)));
  } finally {
    if (server && server.close) await server.close().catch(() => {});
    await scratch.stop().catch(() => {});
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-13 portfolio at market)'));
  process.exit(fail ? 1 : 0);
}
main();
