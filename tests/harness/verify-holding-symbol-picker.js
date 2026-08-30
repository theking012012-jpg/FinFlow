'use strict';
/* verify-holding-symbol-picker.js — Add/Edit Holding live symbol picker:
 *   As you type, the Ticker field queries the keyed search proxy (crypto→CoinGecko, else Finnhub) and
 *   shows real matches; picking one fills the exchange ticker + name. This is the entry-time guardrail —
 *   bad symbols can't be entered because the user chooses a real one from live results.
 *
 * Drives the REAL picker script (extracted from index.html) in jsdom against a stubbed search proxy.
 *
 * Discriminating (Rule 14): before this feature window.ffHoldingSearch didn't exist and the modal had
 * no #h-ticker-suggest dropdown. Assertions 1–2 go red on the pre-change code.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-holding-symbol-picker.js
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
    A('Add Holding modal has a symbol-suggest dropdown', /id="h-ticker-suggest"/.test(html));
    const blocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    const tag = blocks.find(b => b.includes('window.ffHoldingSearch') && b.includes('window.ffHoldingPick'));
    A('picker script defines ffHoldingSearch + ffHoldingPick', !!tag);
    if (!tag) { console.log('\n  RED — ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
    const script = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

    const dom = new JSDOM('<!doctype html><body>' +
      '<input id="h-ticker"><select id="h-type"><option>Stock</option><option>Crypto</option><option>Cash</option></select>' +
      '<input id="h-name"><input id="h-price"><div id="h-ticker-suggest" style="display:none"></div></body>',
      { runScripts: 'outside-only', url: 'https://x.test/app' });
    const { window } = dom;
    window.esc = s => String(s == null ? '' : s);
    window.notify = () => {};
    // stub the resolver used by the blur-fill path
    window._ffResolveSymbol = async (raw) => String(raw || '').toUpperCase();
    const searchUrls = [];
    const priceCalls = [];
    window.fetch = (url) => {
      const u = String(url);
      if (u.includes('/api/stock-price')) {
        const sym = decodeURIComponent((u.match(/symbol=([^&]+)/) || [])[1] || '');
        priceCalls.push(u);
        const P = { MSFT: 513.53, BTC: 78045, AAPL: 319.7 };
        return Promise.resolve({ ok: true, json: async () => ({ symbol: sym, price: P[sym] != null ? P[sym] : null }) });
      }
      searchUrls.push(u);
      const isCrypto = /[?&]type=crypto/.test(u);
      return Promise.resolve({ ok: true, json: async () => (isCrypto
        ? { results: [{ symbol: 'BTC', description: 'Bitcoin', type: 'Crypto' }, { symbol: 'BCH', description: 'Bitcoin Cash', type: 'Crypto' }] }
        : { results: [{ symbol: 'MSFT', description: 'Microsoft Corp', type: 'Common Stock' }, { symbol: 'MSFUT', description: 'Other', type: 'Stock' }] }) });
    };
    window.eval(script);
    A('window.ffHoldingSearch exposed', typeof window.ffHoldingSearch === 'function');

    const $ = id => window.document.getElementById(id);
    const type = (id, v) => { $(id).value = v; };

    // ── stock search shows matches ──
    $('h-type').value = 'Stock';
    type('h-ticker', 'micro');
    window.ffHoldingSearch();
    await new Promise(r => setTimeout(r, 350));
    const sug = $('h-ticker-suggest');
    A('typing a name shows the suggestion dropdown', sug.style.display === 'block' && /MSFT/.test(sug.innerHTML), sug.style.display);
    A('stock search did NOT use &type=crypto', searchUrls.some(u => /symbol-search/.test(u)) && !searchUrls[searchUrls.length - 1].includes('type=crypto'));

    // ── picking a result fills ticker + name + live current price ──
    priceCalls.length = 0;
    window.ffHoldingPick(0);
    await new Promise(r => setTimeout(r, 30));
    A('picking a result fills the exchange ticker (MSFT)', $('h-ticker').value === 'MSFT');
    A('picking a result fills the name (Microsoft Corp)', $('h-name').value === 'Microsoft Corp');
    A('picking a result fetches + fills the live current price (513.53)', Number($('h-price').value) === 513.53, $('h-price').value);
    A('dropdown hides after a pick', $('h-ticker-suggest').style.display === 'none');

    // ── typing a ticker + blur fills price when empty (no manual value) ──
    $('h-price').value = ''; $('h-type').value = 'Stock';
    type('h-ticker', 'AAPL');
    priceCalls.length = 0;
    window.ffHoldingTickerBlur();
    await new Promise(r => setTimeout(r, 60));
    A('blur on a typed ticker fills the live price (AAPL 319.7)', Number($('h-price').value) === 319.7, $('h-price').value);

    // ── a manually entered price is NOT overwritten on blur ──
    $('h-price').value = '999'; type('h-ticker', 'MSFT');
    priceCalls.length = 0;
    window.ffHoldingTickerBlur();
    await new Promise(r => setTimeout(r, 60));
    A('a manual price is preserved on blur (not clobbered)', $('h-price').value === '999' && priceCalls.length === 0, $('h-price').value);

    // ── crypto type routes the search to CoinGecko ──
    searchUrls.length = 0;
    $('h-name').value = '';
    $('h-type').value = 'Crypto';
    type('h-ticker', 'bitc');
    window.ffHoldingSearch();
    await new Promise(r => setTimeout(r, 350));
    A('crypto type searches with &type=crypto', searchUrls.some(u => /[?&]type=crypto/.test(u)), JSON.stringify(searchUrls));
    A('crypto results render (BTC — Bitcoin)', /BTC/.test($('h-ticker-suggest').innerHTML));

    // ── cash type never searches; short queries never search ──
    searchUrls.length = 0;
    $('h-type').value = 'Cash';
    type('h-ticker', 'anything');
    window.ffHoldingSearch();
    await new Promise(r => setTimeout(r, 350));
    A('Cash type does not query the search proxy', searchUrls.length === 0);
    searchUrls.length = 0;
    $('h-type').value = 'Stock';
    type('h-ticker', 'a');
    window.ffHoldingSearch();
    await new Promise(r => setTimeout(r, 350));
    A('single-character query does not search (needs ≥2)', searchUrls.length === 0);

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : 'RED') + ` — ${pass} passed, ${fail} failed  (Add Holding live symbol picker)`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('  HARNESS ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
