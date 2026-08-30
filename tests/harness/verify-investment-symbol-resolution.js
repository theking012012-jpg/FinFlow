'use strict';
/* verify-investment-symbol-resolution.js — investments live-data fix:
 *   Holdings entered as NAMES ("Microsoft", "Bitcoin") or wrong symbols pulled no live price — the
 *   quote APIs need the exchange TICKER (MSFT, BTC). resolveSymbol maps name→ticker (built-in map for
 *   common stocks + every supported crypto, plain-ticker passthrough, /api/symbol-search fallback);
 *   fetchQuote quotes the RESOLVED symbol; holdings that still can't be quoted are FLAGGED (_noQuote)
 *   instead of silently showing cost basis as a live price.
 *
 * Drives the REAL investments IIFE (extracted from index.html) in jsdom against a stubbed quote proxy.
 *
 * Discriminating (Rule 14): before this fix window._ffResolveSymbol didn't exist and fetchQuote called
 * the proxy with the raw name (→ null price, silent). Assertion 1 and the MICROSOFT→MSFT quote go red
 * on the pre-fix code.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-investment-symbol-resolution.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const blocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    const tag = blocks.find(b => b.includes('window.refreshMarketData') && b.includes('resolveSymbol'));
    A('investments script defines symbol resolution (resolveSymbol)', !!tag, 'resolveSymbol not present — fix missing');
    if (!tag) { console.log('\n  RED — ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
    const iife = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.test/app', pretendToBeVisual: true });
    const { window } = dom;
    if (typeof window.requestAnimationFrame !== 'function') window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

    // globals the IIFE reads (bare identifiers → window props)
    window.holdings = [];
    window.bizHoldings = [];
    // stubs
    const quoteCalls = [];        // symbols passed to /api/stock-price
    const quoteUrls = [];         // full stock-price URLs (to assert &type=)
    window.fetch = (url) => {
      const u = String(url);
      if (u.includes('/api/stock-price')) {
        const sym = decodeURIComponent((u.match(/symbol=([^&]+)/) || [])[1] || '');
        quoteCalls.push(sym); quoteUrls.push(u);
        // Known-good tickers (stocks + crypto) return a price; unknown → price:null (like Finnhub c:0)
        const GOOD = { MSFT: 513.53, BTC: 78045, AAPL: 319.7, TSLA: 348.75, PLTR: 42.1, PEPE: 0.0000012, DOGE: 0.16 };
        const price = GOOD[sym] != null ? GOOD[sym] : null;
        return Promise.resolve({ ok: true, json: async () => ({ symbol: sym, price, prevClose: price, dayChange: price != null ? 1.23 : null, dayChangePct: price != null ? 0.5 : null, dividend: 0 }) });
      }
      if (u.includes('/api/symbol-search')) {
        // type-aware: crypto query → a coin symbol; else an equity symbol
        const isCrypto = /[?&]type=crypto/.test(u);
        return Promise.resolve({ ok: true, json: async () => (isCrypto ? { symbol: 'SHIB', results: [{ symbol: 'SHIB', description: 'Shiba Inu', type: 'Crypto' }] } : { symbol: 'PLTR', results: [{ symbol: 'PLTR', description: 'Palantir', type: 'Stock' }] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    window.getCachedQuote = () => null;
    window.setCachedQuote = () => {};
    window.setLiveStatus = () => {};
    window.injectStatusPill = () => {};
    window.renderInvestments = () => {};
    window.renderBizInvestments = () => {};
    window._refreshDashboardUI = () => {};
    window.notify = () => {};
    window.AbortSignal = window.AbortSignal || { timeout: () => undefined };

    window.eval(iife);   // installs window._ffResolveSymbol + window.refreshMarketData; runs init()
    const resolve = window._ffResolveSymbol;
    A('window._ffResolveSymbol exposed', typeof resolve === 'function');

    // ── resolution correctness ──
    A('name "MICROSOFT" → MSFT', (await resolve('MICROSOFT')) === 'MSFT');
    A('mixed-case "Microsoft" → MSFT', (await resolve('Microsoft')) === 'MSFT');
    A('crypto "BITCOIN" → BTC', (await resolve('BITCOIN')) === 'BTC');
    A('valid ticker "TSLA" passes through', (await resolve('TSLA')) === 'TSLA');
    A('"CASH" stays CASH (not exchange-traded)', (await resolve('CASH')) === 'CASH');
    A('unknown long name → symbol-search fallback (stub PLTR)', (await resolve('Palantir Technologies')) === 'PLTR');

    // ── fetchQuote quotes the RESOLVED symbol, and holdings get live data / flags ──
    quoteCalls.length = 0;
    window.holdings = [
      { ticker: 'MICROSOFT', shares: 10, cost: 300 },   // name → should quote MSFT
      { ticker: 'ZZZZZ',     shares: 5,  cost: 100 },    // junk → no quote → flagged
      { ticker: 'CASH',      shares: 1,  cost: 1 },      // cash → never flagged
    ];
    await window.refreshMarketData();
    await new Promise(r => setTimeout(r, 60));
    A('MICROSOFT holding is quoted as MSFT (resolved), not the raw name', quoteCalls.includes('MSFT') && !quoteCalls.includes('MICROSOFT'), JSON.stringify(quoteCalls));
    const hMsft = window.holdings[0], hJunk = window.holdings[1], hCash = window.holdings[2];
    A('MICROSOFT holding got the live price ($513.53)', hMsft.price === 513.53 && hMsft._noQuote === false, JSON.stringify(hMsft));
    A('MICROSOFT holding records its resolved ticker (MSFT)', hMsft._resolved === 'MSFT');
    A('junk-ticker holding is FLAGGED _noQuote (not silently cost)', hJunk._noQuote === true, JSON.stringify(hJunk));
    A('CASH holding is never flagged', hCash._noQuote !== true);

    // ── crypto / asset-type routing (coverage beyond the built-in list) ──
    A('crypto name "DOGECOIN" → DOGE (map)', (await resolve('DOGECOIN', 'crypto')) === 'DOGE');
    A('any coin ticker "PEPE" passes through (not in the 20-map)', (await resolve('PEPE', 'crypto')) === 'PEPE');
    A('crypto multi-word "Shiba Inu" → CoinGecko search (stub SHIB)', (await resolve('Shiba Inu', 'crypto')) === 'SHIB');
    A('same raw string resolves differently by asset type (ARB: stock vs crypto search)',
      (await resolve('Arbitrum Foundation', 'crypto')) === 'SHIB' && (await resolve('Palantir Technologies', '')) === 'PLTR');

    quoteCalls.length = 0; quoteUrls.length = 0;
    window.bizHoldings = [{ ticker: 'PEPE', shares: 1000000, cost: 0.000001, type: 'Crypto' }];
    window.holdings = [];
    await window.refreshMarketData();
    await new Promise(r => setTimeout(r, 60));
    A('crypto holding is quoted with &type=crypto (routes to CoinGecko)',
      quoteUrls.some(u => /symbol=PEPE/.test(u) && /[?&]type=crypto/.test(u)), JSON.stringify(quoteUrls));
    A('any coin (PEPE) now gets a live price', window.bizHoldings[0].price === 0.0000012 && window.bizHoldings[0]._noQuote === false, JSON.stringify(window.bizHoldings[0]));

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : 'RED') + ` — ${pass} passed, ${fail} failed  (investments: symbol resolution + type routing + honest no-price flag)`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('  HARNESS ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
