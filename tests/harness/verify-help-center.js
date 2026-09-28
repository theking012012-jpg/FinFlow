'use strict';
/**
 * verify-help-center.js — the in-app help / getting-started system for BOTH audiences.
 *
 * FinFlow ships end-to-end how-to help in the product, not just a support inbox:
 *   CLIENT  → a full "Help Center" page (page-help) reachable from the sidebar, with a searchable,
 *             categorised article library covering the app start to finish, plus a contact form.
 *   ACCOUNTANT → a "Help" control in the portal opening an acctHelp overlay of portal how-tos plus
 *             a contact form.
 *
 * This is a STATIC/structural harness (Rule: UI wiring can't be exercised over HTTP without a DOM),
 * so it asserts the concrete wiring that would be missing if the feature regressed. Discriminating:
 * each assertion names a specific symbol/attribute that did not exist before this feature and whose
 * removal would break the user-visible behaviour (nav entry, article breadth, search filter, category
 * grouping, HTML-escaping of article/how-to text, and the correct /api/support category per audience).
 *
 *   node tests/harness/verify-help-center.js
 */
const fs = require('fs');
const path = require('path');

(function () {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

  const idx = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  const acct = fs.readFileSync(path.join(process.cwd(), 'public', 'accountant-dashboard.html'), 'utf8');

  // ── CLIENT HELP CENTER ──────────────────────────────────────────────────────
  A('client: page-help div exists', /<div class="page" id="page-help">/.test(idx));
  A('client: sidebar nav opens the Help Center', /showPage\('help'/.test(idx) && /Help Center<\/div>/.test(idx));
  A('client: search box present', /id="help-search"/.test(idx));
  A('client: category + contact mount points present', /id="help-cats"/.test(idx) && /id="help-contact"/.test(idx));

  // Article breadth — extract the HELP_ARTICLES literal and count articles + distinct categories.
  const artBlock = (idx.match(/var HELP_ARTICLES\s*=\s*\[([\s\S]*?)\n\];/) || [])[1] || '';
  const qCount = (artBlock.match(/\bq:\s*'/g) || []).length;
  const cats = new Set((artBlock.match(/\bc:\s*'([^']+)'/g) || []).map(s => s.replace(/.*c:\s*'/, '').replace(/'$/, '')));
  A('client: article library is comprehensive (≥20 articles)', qCount >= 20, 'articles=' + qCount);
  A('client: covers the whole app (≥8 categories)', cats.size >= 8, 'categories=' + cats.size + ' [' + [...cats].join(', ') + ']');
  // Sanity: the core surfaces each have a category.
  for (const need of ['Invoices & income', 'Expenses & bills', 'Payroll', 'Reports, GL & tax', 'Importing & migrating', 'Working with your accountant']) {
    A('client: category present — ' + need, cats.has(need));
  }

  A('client: renderHelpCenter defined and groups by category into <details>', /window\.renderHelpCenter\s*=/.test(idx) && /help-cat/.test(idx) && /<details class="help-art"/.test(idx));
  A('client: article text is HTML-escaped (XSS-safe)', /_helpEsc/.test(idx) && /_helpEsc\(a\.q\)/.test(idx));
  A('client: search filters articles by indexed text', /data-text/.test(idx) && /help-search'\)/.test(idx) && /getAttribute\('data-text'\)/.test(idx));
  A('client: showPage hook renders the center on navigation', /id==='help'\)\{\s*try\{\s*renderHelpCenter\(\)/.test(idx));
  A('client: contact form posts /api/support with category help-center', /category:'help-center'/.test(idx) && /fetch\('\/api\/support'/.test(idx));

  // ── ACCOUNTANT HELP ─────────────────────────────────────────────────────────
  A('accountant: Help control wired to acctHelp()', /onclick="acctHelp\(\)"/.test(acct));
  A('accountant: acctHelp overlay defined', /window\.acctHelp\s*=\s*function/.test(acct) && /acct-help-ov/.test(acct));
  const howBlock = (acct.match(/var HOW\s*=\s*\[([\s\S]*?)\];/) || [])[1] || '';
  const howCount = (howBlock.match(/\['/g) || []).length;
  A('accountant: covers the portal workflow (≥6 how-tos)', howCount >= 6, 'how-tos=' + howCount);
  A('accountant: how-to text is HTML-escaped', /esc2\(/.test(acct));
  A('accountant: overlay is dismissable (close + backdrop)', /ah-x'\)\.onclick=close/.test(acct) && /if\(e\.target===ov\)\s*close\(\)/.test(acct));
  A('accountant: contact form posts /api/support with category accountant', /category:'accountant'/.test(acct) && /fetch\('\/api\/support'/.test(acct));

  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (in-app help — client Help Center + accountant help)`);
  console.log('');
  process.exitCode = fail === 0 ? 0 : 1;
})();
