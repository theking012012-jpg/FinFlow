'use strict';
/**
 * verify-docview-invoice.js — the rich document viewer (finflow-docview.js) renders a Money In /
 * Money Out record's REAL data, not a placeholder, and is the runtime winner over the bare
 * "Invoice Details" modal.
 *
 * WHAT WENT WRONG BEFORE (the feature this replaces): "View" on an invoice opened a bare grid of
 * client/amount/due/status (finflow-api-wiring-extra.js:42), and buildInvoiceHTML (app-main.js:5954)
 * — the only rich renderer — was wired ONLY to the Templates preview and hardcoded sample line items
 * ('Product design & strategy', …). So no user ever saw their real invoice as a document.
 *
 * finflow-docview.js ships DIRECT and overrides window.viewInvoice AFTER the bundle (Rule 1), so this
 * asserts (a) the override is the copy that runs, (b) it renders the record's real client + amount +
 * business letterhead from the settings inputs, (c) NONE of buildInvoiceHTML's sample strings leak in,
 * and (d) the line-items path sums qty×rate correctly with discriminating values (Rule 4).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-docview-invoice.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    const doc = window.document;
    await settle(60, 60);

    // ── Rule 1: which viewInvoice actually runs? The docview override, or the bare-modal copy? ──
    const vSrc = String(window.viewInvoice);
    A('[structural] window.viewInvoice is the docview override (invoiceToDoc/openDoc), not the bare modal',
      /invoiceToDoc|openDoc\(/.test(vSrc) && !/Invoice Details/.test(vSrc), `src="${vSrc.slice(0, 90)}…"`);

    // A real seeded invoice is loaded into the client array. Read it — don't assume the order.
    const invs = window.userInvoices || [];
    A('boot: at least one invoice loaded into userInvoices', invs.length > 0, `len=${invs.length}`);
    const rec = invs[0] || {};
    const realClient = String(rec.client || '');
    const amtNum = (parseFloat(rec.amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Letterhead sentinel: prove the doc reads the live settings input, not a hardcoded name.
    const setV = (id, v) => { const el = doc.getElementById(id); if (el) el.value = v; };
    setV('s-biz-name', 'Sentinel Books Ltd');
    setV('s-email', 'hello@sentinelbooks.test');

    // ── open the document ──
    window.viewInvoice(0);
    await settle(4, 30);
    const overlay = doc.getElementById('ff-docview');
    const frame = doc.getElementById('ff-docview-frame');
    A('viewInvoice opens the docview overlay (visible)', overlay && overlay.style.display === 'flex', `display="${overlay && overlay.style.display}"`);
    const html = (frame && (frame.getAttribute('srcdoc') || frame.srcdoc)) || '';
    A('rendered document is non-empty HTML', html.length > 200 && /INVOICE/.test(html), `len=${html.length}`);

    // (b) real data — the record's own client + amount, executed value not source text (Rule 5)
    A('document shows the invoice\'s REAL client (not a placeholder)', realClient.length > 0 && html.indexOf(realClient) !== -1, `client="${realClient}"`);
    A('document shows the invoice\'s REAL amount, formatted', html.indexOf(amtNum) !== -1, `amount="${amtNum}"`);
    // letterhead read from the live settings input
    A('document letterhead reads the live settings biz-name input', html.indexOf('Sentinel Books Ltd') !== -1, 'sentinel biz-name missing');

    // (c) NO buildInvoiceHTML sample-data leak
    const SAMPLES = ['Product design &amp; strategy', 'Product design & strategy', 'Frontend development', 'QA testing & delivery'];
    const leaked = SAMPLES.filter(s => html.indexOf(s) !== -1);
    A('NO buildInvoiceHTML sample line-items leak into the real document', leaked.length === 0, `leaked=${JSON.stringify(leaked)}`);

    // (d) line-items path (Phase 2 forward-compat) — sums qty×rate with DISCRIMINATING values (Rule 4).
    //     A wrong reducer (e.g. summing rate, or qty) would NOT produce 1,300.00.
    const liDoc = {
      party: 'LineItem Client', amount: 999 /* must be IGNORED when line_items present */,
      line_items: [
        { desc: 'Design sprint', qty: 2, rate: 150 },   // 300
        { desc: 'Build phase',   qty: 5, rate: 200 },   // 1000
      ],
      currency: 'USD',
    };
    const liHTML = window.buildDocumentHTML(liDoc, 'invoice');
    A('line-items: both line descriptions render', /Design sprint/.test(liHTML) && /Build phase/.test(liHTML), 'a line desc missing');
    A('line-items: subtotal/total = Σ qty×rate = 1,300.00 (not the ignored .amount 999)',
      liHTML.indexOf('1,300.00') !== -1 && liHTML.indexOf('999.00') === -1, 'total mis-summed or fell back to .amount');
    A('line-items: per-line total 1,000.00 for 5×200 renders', liHTML.indexOf('1,000.00') !== -1, 'line total wrong');

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (rich document viewer renders real data)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
