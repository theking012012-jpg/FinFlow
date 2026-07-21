#!/usr/bin/env node
// scripts/dryrun-holdings-tickers.js — READ-ONLY dry-run for the holdings ticker/asset-type
// normalization (live investment pricing, Part 2). Proposes provider keys; writes NOTHING.
//
//   node scripts/dryrun-holdings-tickers.js            # all users
//   node scripts/dryrun-holdings-tickers.js --user 1
//
// Normalizes each holding to a PROVIDER KEY + asset_type ∈ {stock, crypto}:
//   • stock  → Finnhub symbol, UPPERCASE     (MSFT)
//   • crypto → CoinGecko coin id, lowercase  (bitcoin — NOT "BTC"; CoinGecko keys on id,
//              and symbols collide across coins, so a symbol can NEVER be auto-promoted to an id)
//
// Buckets:
//   NORMALIZE      confident mapping (known table) → shows current → proposed
//   ALREADY_OK     already a plausible provider key, left as-is
//   NEEDS_REVIEW   crypto whose coin id isn't confidently known, or anything ambiguous —
//                  requires the CoinGecko /coins/list resolution step at build time (never guessed)
'use strict';

// Confident, hand-verified mappings for the known legacy rows. Extend as needed; anything not
// here that isn't already a plausible symbol falls to NEEDS_REVIEW (never auto-guessed).
const KNOWN = {
  MICROSOFT: { key: 'MSFT',    asset_type: 'stock',  provider: 'finnhub'   },
  MSFT:      { key: 'MSFT',    asset_type: 'stock',  provider: 'finnhub'   },
  BITCOIN:   { key: 'bitcoin', asset_type: 'crypto', provider: 'coingecko' },
  BTC:       { key: 'bitcoin', asset_type: 'crypto', provider: 'coingecko' }, // symbol→id only because hand-verified
};

const isPlausibleStockSymbol = s => /^[A-Z]{1,5}(\.[A-Z]{1,3})?$/.test(s);   // MSFT, BRK.B
const looksCrypto = at => /crypto/i.test(at || '');

function classifyHolding(row) {
  const cur = String(row.ticker || '').trim().toUpperCase();
  const name = String(row.name || '').trim();
  const at = String(row.asset_type || '').trim();
  const base = { id: row.id, user_id: row.user_id, current_ticker: row.ticker, name, current_asset_type: at };

  const hit = KNOWN[cur] || KNOWN[name.toUpperCase()];
  if (hit) {
    const changed = hit.key !== row.ticker || hit.asset_type.toLowerCase() !== at.toLowerCase();
    return { bucket: changed ? 'NORMALIZE' : 'ALREADY_OK', ...base,
             proposed_ticker: hit.key, proposed_asset_type: hit.asset_type, provider: hit.provider };
  }
  // Not in the known table. A plausible stock symbol that's already marked stock is fine as-is.
  if (isPlausibleStockSymbol(cur) && !looksCrypto(at)) {
    return { bucket: 'ALREADY_OK', ...base, proposed_ticker: cur, proposed_asset_type: 'stock', provider: 'finnhub' };
  }
  // Everything else — crypto without a known id, or an unrecognized name — needs human/id resolution.
  return { bucket: 'NEEDS_REVIEW', ...base,
           reason: looksCrypto(at) ? 'crypto: resolve to a CoinGecko coin id (/coins/list) — symbol≠id, collisions possible'
                                   : 'unrecognized ticker/name — confirm the provider symbol/id' };
}

function classifyAll(holdings) {
  const out = { NORMALIZE: [], ALREADY_OK: [], NEEDS_REVIEW: [] };
  for (const h of holdings || []) out[classifyHolding(h).bucket].push(classifyHolding(h));
  out.totals = { rows: (holdings || []).length, normalize: out.NORMALIZE.length, alreadyOk: out.ALREADY_OK.length, needsReview: out.NEEDS_REVIEW.length };
  return out;
}

function render(res) {
  const L = ['=== Holdings ticker/asset-type normalization — READ-ONLY DRY-RUN (writes nothing) ===',
             `rows scanned .......... ${res.totals.rows}`, ''];
  L.push(`NORMALIZE (${res.totals.normalize}) — will be rewritten on apply:`);
  for (const r of res.NORMALIZE) L.push(`   • id ${r.id}  "${r.current_ticker}" / ${r.current_asset_type || '—'}  →  ticker "${r.proposed_ticker}", asset_type ${r.proposed_asset_type}  [${r.provider}]`);
  L.push(`ALREADY_OK (${res.totals.alreadyOk}) — no change:`);
  for (const r of res.ALREADY_OK) L.push(`   • id ${r.id}  "${r.current_ticker}" (${r.proposed_asset_type}) [${r.provider}]`);
  L.push(`NEEDS_REVIEW (${res.totals.needsReview}) — NOT auto-mapped, owner/id-resolution required:`);
  for (const r of res.NEEDS_REVIEW) L.push(`   • id ${r.id}  "${r.current_ticker}" / ${r.current_asset_type || '—'}  — ${r.reason}`);
  L.push('', 'Nothing written. Apply is a separate, owner-gated step.');
  return L.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const uIdx = argv.indexOf('--user');
  const userId = uIdx >= 0 ? Number(argv[uIdx + 1]) : null;
  const { pool, rowToObj } = require('../database.js');
  try {
    const sql = userId != null
      ? ['SELECT * FROM holdings WHERE user_id = $1 ORDER BY id', [userId]]
      : ['SELECT * FROM holdings ORDER BY user_id, id', []];
    const { rows } = await pool.query(sql[0], sql[1]);
    console.log(render(classifyAll(rows.map(rowToObj))));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error('[dryrun-holdings-tickers] failed:', e.message); process.exit(1); });

module.exports = { classifyHolding, classifyAll, render };
