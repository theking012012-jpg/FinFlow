'use strict';
/**
 * verify-fx-live-rates.js — the FX-live layer: pair resolution (pickRate / _pickDirectRate) and the
 * USD-base live feed upsert (refreshLiveFxRates). Previously UNHARNESSED.
 *
 * Resolution (pure, in-memory rows): identity, direct, inverse (1/reverse), cross-via-USD, date
 * carry-forward (most-recent on/before), carry-backward fallback (earliest), and null when a pair
 * genuinely has no path — never a fabricated rate.
 * Refresh (real scratch Postgres, network stubbed): writes USD->X `source:'live'` rows for the
 * account's currencies, NEVER clobbers a hand-entered `source:'manual'` pair, and is idempotent per day.
 * Discriminating (Rule 14): cross-via-USD ≠ any stored direct rate; the manual pair keeps its value
 * after a refresh that returned a different number; a second refresh adds no duplicate row.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-fx-live-rates.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const near = (a, b) => Math.abs((+a) - (+b)) < 1e-9;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    const { pickRate, _pickDirectRate, refreshLiveFxRates } = require('../../server.js');
    A('FX functions are exported as a test surface', typeof pickRate === 'function' && typeof _pickDirectRate === 'function' && typeof refreshLiveFxRates === 'function');

    // ── pure resolution ──────────────────────────────────────────────────────────
    const R = (f, t, rate, d) => ({ from_currency: f, to_currency: t, rate, rate_date: d || '2026-01-01' });
    A('identity: from==to → 1 (no lookup, no fabrication)', pickRate([], 'USD', 'USD') === 1);
    A('direct pair', near(pickRate([R('USD', 'GBP', 0.8)], 'USD', 'GBP'), 0.8));
    A('inverse: only USD→GBP stored resolves GBP→USD as 1/rate', near(pickRate([R('USD', 'GBP', 0.8)], 'GBP', 'USD'), 1.25));
    const usdBase = [R('USD', 'GBP', 0.8), R('USD', 'EUR', 0.9)];
    A('cross-via-USD: GBP→EUR = (1/0.8)*0.9 = 1.125 (no direct pair exists)', near(pickRate(usdBase, 'GBP', 'EUR'), 1.125));
    A('cross result is NOT any stored direct rate (discriminating)', !near(pickRate(usdBase, 'GBP', 'EUR'), 0.8) && !near(pickRate(usdBase, 'GBP', 'EUR'), 0.9));
    const dated = [R('USD', 'GBP', 0.80, '2026-01-01'), R('USD', 'GBP', 0.90, '2026-06-01')];
    A('carry-forward: as-of 2026-03-01 → 0.80 (most recent on/before)', near(pickRate(dated, 'USD', 'GBP', '2026-03-01'), 0.80));
    A('carry-forward: as-of 2026-07-01 → 0.90', near(pickRate(dated, 'USD', 'GBP', '2026-07-01'), 0.90));
    A('carry-backward: as-of before any rate → earliest (0.80), not null', near(pickRate(dated, 'USD', 'GBP', '2025-01-01'), 0.80));
    A('no path → null (never a fabricated rate or 0)', pickRate([], 'GBP', 'EUR') === null && pickRate([R('USD', 'GBP', 0.8)], 'JPY', 'CAD') === null);
    A('_pickDirectRate returns null for an unknown pair', _pickDirectRate([R('USD', 'GBP', 0.8)], 'USD', 'EUR') === null);

    // ── refresh (network stubbed) ─────────────────────────────────────────────────
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'fxlive@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync('x', 10) }])).rows[0].id;
    await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`, [uid, { name: 'Co', currency: 'USD' }]);
    // a HAND-ENTERED pair that must survive the refresh untouched
    await c.query(`INSERT INTO fx_rates (user_id,entity_id,from_currency,to_currency,rate,rate_date,source) VALUES ($1,NULL,'USD','GBP',0.70,CURRENT_DATE,'manual')`, [uid]);

    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: 'success', rates: { GBP: 0.8, EUR: 0.9 } }) });
    try {
      await refreshLiveFxRates();
      await refreshLiveFxRates();   // second run — must be idempotent per (user,pair,day)
    } finally { global.fetch = realFetch; }

    const eur = (await c.query(`SELECT rate, source FROM fx_rates WHERE user_id=$1 AND from_currency='USD' AND to_currency='EUR'`, [uid])).rows;
    A('refresh wrote a live USD→EUR row', eur.length === 1 && Number(eur[0].rate) === 0.9 && eur[0].source === 'live', JSON.stringify(eur));
    A('refresh is idempotent per day (one EUR row, not two)', eur.length === 1, 'rows=' + eur.length);
    const gbp = (await c.query(`SELECT rate, source FROM fx_rates WHERE user_id=$1 AND from_currency='USD' AND to_currency='GBP' ORDER BY source`, [uid])).rows;
    A('manual-wins: hand-entered USD→GBP (0.70) is NOT clobbered by the live 0.80', gbp.some(r => r.source === 'manual' && Number(r.rate) === 0.70) && !gbp.some(r => r.source === 'live'), JSON.stringify(gbp));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (FX-live resolution + feed refresh)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
