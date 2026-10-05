'use strict';
/* verify-connections-hub-view.js — the connections page leads with the aggregator HUBS, not a wall.
 *
 * Drives the real connections-hub IIFE (extracted from index.html) in jsdom. Asserts:
 *  - DEFAULT view (no search) renders the live "Available now" hubs + ONE compact request line, and does
 *    NOT dump the full request-directory (no category wall like "Healthcare", card count stays small).
 *  - The hub cards carry the aggregator coverage copy ("via Plaid / via Codat" model — e.g. Plaid's
 *    "12,000+ institutions", Codat's "QuickBooks, Xero …").
 *  - The directory is still fully searchable: typing a directory-only name (Salesforce) surfaces it.
 *
 * Discriminating (Rule 14): the old page rendered every non-built integration as a category wall by
 * default — so "default view has no Healthcare section and < 40 cards" is RED on the pre-change code
 * (which rendered ~750 cards incl. a Healthcare section). Coverage-copy assertions are RED pre-change too.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-connections-hub-view.js
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
    const iifeTag = blocks.find(b => b.includes('window.connFilterAll') && b.includes('INTEGRATIONS='));
    A('connections-hub IIFE found', !!iifeTag);
    if (!iifeTag) { console.log('\n  RED — ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
    const iife = iifeTag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

    const dom = new JSDOM('<!doctype html><body><div id="page-connections">' +
      '<input id="conn-search"><div id="conn-cat-pills"></div><div id="conn-results-ct"></div>' +
      '<div id="conn-catalog"></div><div id="cs-total"></div><div id="cs-connected"></div></body>',
      { runScripts: 'outside-only', url: 'https://x.test/app' });
    const { window } = dom;
    window.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });  // status/hydrate probes → empty
    window.notify = () => {};
    window.eval(iife);   // runs buildPills + render() (default view)

    const catalog = window.document.getElementById('conn-catalog');
    const cards = () => catalog.querySelectorAll('.conn-card').length;
    const text = () => catalog.textContent || '';

    // ── DEFAULT view ──────────────────────────────────────────────────────────────
    A('default view renders the "Available now" hubs', /Available now/.test(text()));
    A('default view shows ONE compact request line (points to search)', /Search the directory/.test(text()));
    A('[DISCRIMINATING] default view does NOT dump the directory wall (no Healthcare section)',
      !/Healthcare/.test(text()), 'the full category wall is being rendered by default');
    A('[DISCRIMINATING] default card count is small (hubs only, not ~750)',
      cards() > 0 && cards() < 40, 'rendered ' + cards() + ' cards by default');
    A('hub cards carry aggregator coverage copy (Plaid → 12,000+ institutions)', /12,000\+ institutions/.test(text()));
    A('hub cards name the Codat-covered platforms (QuickBooks, Xero…)', /QuickBooks, Xero/.test(text()));
    A('[DISCRIMINATING] category-pill grid hidden by default (not a directory wall of pills)',
      window.document.getElementById('conn-cat-pills').style.display === 'none', 'pills shown on default load');
    A('result count hidden by default', window.document.getElementById('conn-results-ct').style.display === 'none');
    // Reach highlight (always visible): the aggregator coverage numbers, each tied to its hub.
    A('reach highlight present — 12,000+ banks via Plaid, 200+ payroll via Finch, accounting via Codat',
      /class="conn-reach"/.test(html) && /12,000\+/.test(html) && /200\+/.test(html) && /via Plaid/.test(html) && /via Finch/.test(html) && /via Codat/.test(html),
      'the aggregator reach highlight is missing');

    // ── SEARCH still works: the directory is reachable ───────────────────────────────
    window.document.getElementById('conn-search').value = 'salesforce';
    window.connFilterAll();
    A('[DISCRIMINATING] searching a directory-only tool surfaces it (Salesforce)', /Salesforce/i.test(text()),
      'directory search no longer finds non-hub entries');
    A('category pills appear once searching (directory browsing enabled)',
      window.document.getElementById('conn-cat-pills').style.display !== 'none');

    // ── clearing search returns to the lean default (no wall) ────────────────────────
    window.document.getElementById('conn-search').value = '';
    window.connFilterAll();
    A('clearing search returns to the lean hub view (no Healthcare wall)', !/Healthcare/.test(text()) && cards() < 40);

    console.log('\n  ' + (fail === 0 ? 'ALL GREEN' : 'RED') + ` — ${pass} passed, ${fail} failed  (connections hub view)`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('  HARNESS ERROR:', e && e.stack || e);
    process.exit(1);
  }
})();
