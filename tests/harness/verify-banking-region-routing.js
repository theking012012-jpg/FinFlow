'use strict';
/* verify-banking-region-routing.js — F192 / Track A A4:
 *   1. Un-orphan: the reachable Banking page (#page-banking) is the REAL bank UI (accounts, link,
 *      import, reconcile) — not the old "Bank Sync — Coming Soon" placeholder, and the duplicate
 *      #page-banking-biz is gone (so its element IDs are unique / actually populated).
 *   2. Region routing: "Link bank" routes by the active entity's COUNTRY — LatAm → Belvo, US/CA/EU →
 *      Plaid — falling back to whichever aggregator is configured, and to manual statement import when
 *      neither is. No dishonest "coming soon".
 *
 * Discriminating (Rule 14): pre-A4, #page-banking WAS the coming-soon placeholder and ffBankLinkFromPage
 * always called Plaid regardless of country. Assertions 1–3 and the MX→Belvo case go red on that code.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-banking-region-routing.js
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

    // ── 1. Un-orphan (static structure) ──
    const mBank = html.match(/<div class="page" id="page-banking">([\s\S]*?)\n      <\/div>/);
    const bankInner = mBank ? mBank[1] : '';
    A('#page-banking exists', !!mBank);
    A('Banking page is no longer the "Coming Soon" placeholder', !/Coming Soon/.test(bankInner), 'still shows coming-soon');
    A('Banking page carries the real bank UI (accounts + link + import)',
      /id="bank-accounts-list"/.test(bankInner) && /ffBankLinkFromPage\(\)/.test(bankInner) && /ffImportStatement\(\)/.test(bankInner),
      'functional bank UI not on the reachable page');
    A('orphaned #page-banking-biz is retired (no duplicate IDs)', !/id="page-banking-biz"/.test(html));
    A('key banking IDs are unique', (html.match(/id="bank-total-bal"/g)||[]).length === 1 && (html.match(/id="plaid-linked-strip"/g)||[]).length === 1);

    // ── 2. Region routing (behaviour) ──
    const mFn = html.match(/window\.ffBankLinkFromPage = async function\(\)\{[\s\S]*?\n\};/);
    A('ffBankLinkFromPage is country-aware (async, reads entity country)',
      !!mFn && /country/.test(mFn[0]) && /BELVO_MARKETS/.test(mFn[0]), 'routing not country-aware');
    if (!mFn) { console.log('\n  RED — ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.test/app' });
    const { window } = dom;
    const g = window;
    // configurability of each aggregator, flipped per scenario
    let plaidCfg = true, belvoCfg = true;
    g.fetch = (url) => {
      const p = String(url);
      let body = {};
      if (p.includes('/api/plaid/items')) body = { configured: plaidCfg };
      else if (p.includes('/api/belvo/status')) body = { configured: belvoCfg };
      return Promise.resolve({ ok: true, json: async () => body });
    };
    const launched = [];
    g.ffLinkBank = () => launched.push('plaid');
    g.ffLinkBelvo = () => launched.push('belvo');
    g.renderPlaidLinked = () => {};
    g.loadBankingFromDB = () => {};
    const notes = [];
    g.notify = (m, e) => notes.push({ m: String(m), e: !!e });
    g.ENTITIES = [];
    window.eval(mFn[0]);   // installs window.ffBankLinkFromPage in this realm

    const run = async (country, pCfg, bCfg) => {
      launched.length = 0; notes.length = 0; plaidCfg = pCfg; belvoCfg = bCfg;
      g.ENTITIES = [{ active: true, country }];
      await g.ffBankLinkFromPage();
      await new Promise(r => setTimeout(r, 10));
    };

    await run('US', true, true);
    A('US entity → Plaid', launched[0] === 'plaid', JSON.stringify(launched));
    await run('MX', true, true);
    A('Mexico entity → Belvo (region-preferred over Plaid)', launched[0] === 'belvo', JSON.stringify(launched));
    await run('BR', false, true);
    A('Brazil with only Belvo configured → Belvo', launched[0] === 'belvo', JSON.stringify(launched));
    await run('MX', true, false);
    A('Mexico but only Plaid configured → falls back to Plaid', launched[0] === 'plaid', JSON.stringify(launched));
    await run('JP', false, false);
    A('unserved region, neither configured → no auto-link, points to manual Import',
      launched.length === 0 && notes.some(n => n.e && /Import/.test(n.m)), JSON.stringify({ launched, notes }));

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : 'RED') + ` — ${pass} passed, ${fail} failed  (F192/A4: banking un-orphan + region routing)`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('  HARNESS ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
