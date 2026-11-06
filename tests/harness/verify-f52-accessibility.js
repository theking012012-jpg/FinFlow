'use strict';
/**
 * verify-f52-accessibility — F52. Every page's structure is accessible (axe-core: names, labels, roles, landmarks,
 * headings, table headers), every modal window — static or built at runtime — is a named dialog with a named close
 * button, and modals work from the keyboard (focus moves in on open and back on close; Escape closes).
 *
 * Executed: (1) axe-core over the 10 static pages (a11y-audit's set); (2) axe-core inside the LIVE app after boot in jsdom
 * (real server + scratch Postgres), plus a runtime-built modal opened for real. color-contrast needs real layout and is
 * measured separately in Chromium (verify-f52b-contrast). Bug values (old code): 216 violation nodes on the static pages
 * (37 nameless close buttons, 152 contents outside any landmark/dialog, 16 unlabeled controls, 5 empty headers, …);
 * runtime modals unnamed; Escape did nothing.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f52-accessibility.js
 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const axe = require('axe-core');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
const PUB = path.join(__dirname, '..', '..', 'public');
const PAGES = ['index.html', 'landing.html', 'accountant-login.html', 'accountant-register.html', 'reset-password.html', 'team-accept.html', 'privacy.html', 'terms.html', 'security.html', 'accountants.html'];
const OFF = { 'color-contrast': { enabled: false } };   // needs real layout — f52b
const summarize = (v) => v.map(r => `${r.id}×${r.nodes.length} (${r.nodes.slice(0, 2).map(n => n.target.join(' ')).join(', ')})`).join('; ');

(async () => {
  let h;
  console.log('\nF52 — accessibility: structure, dialogs, keyboard\n');
  try {
    for (const f of PAGES) {
      const dom = new JSDOM(fs.readFileSync(path.join(PUB, f), 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true });
      dom.window.eval(axe.source);
      const r = await dom.window.axe.run(dom.window.document, { rules: OFF, resultTypes: ['violations'] });
      const n = r.violations.reduce((s, x) => s + x.nodes.length, 0);
      A(`${f}: 0 structural violations (bug: index 213, accountant-register 3)`, n === 0, summarize(r.violations));
      dom.window.close();
    }

    h = await bootSpaInJsdom({});
    await h.idle();
    const w = h.window, d = w.document;
    const ovs = [...d.querySelectorAll('.modal-overlay')];
    const unnamed = ovs.filter(o => o.getAttribute('role') !== 'dialog' || !(o.getAttribute('aria-label') || '').trim()).map(o => o.id);
    A(`live app: all ${ovs.length} modal windows are named dialogs`, ovs.length >= 37 && unnamed.length === 0, `unnamed: ${unnamed.join(', ')}`);
    const xs = [...d.querySelectorAll('.modal-close')].filter(b => !(b.getAttribute('aria-label') || b.textContent || '').trim());
    A('live app: every close button has a name', xs.length === 0, xs.map(b => b.outerHTML.slice(0, 80)).join(' | '));

    // A modal built at RUNTIME (app-main openNewAccountModal) — not in index.html.
    w.openNewAccountModal(); await h.settle(5, 50);
    const coa = d.getElementById('coa-new-modal');
    A('a runtime-built modal is a dialog named "New account", its close button named', coa && coa.getAttribute('role') === 'dialog' && coa.getAttribute('aria-label') === 'New account'
      && coa.querySelector('.modal-close').getAttribute('aria-label') === 'Close', coa && coa.outerHTML.slice(0, 200));
    const code = d.getElementById('coa-code'), lab = [...coa.querySelectorAll('label')].find(l => /Code/.test(l.textContent));
    A('…its "Code *" label is linked to its field', lab && lab.getAttribute('for') === 'coa-code' && !!code, lab && lab.outerHTML);
    await h.settle(3, 50);
    A('…focus moved into it on open', coa.contains(d.activeElement), `active=${d.activeElement && (d.activeElement.id || d.activeElement.tagName)}`);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await h.settle(3, 50);
    A('Escape closes the open modal (bug: nothing)', coa.classList.contains('hidden'), coa.className);

    // A static modal: open with the app's own openModal, focus in, Escape, focus back.
    const opener = d.createElement('button'); opener.id = 'f52-opener'; opener.textContent = 'New invoice'; d.body.appendChild(opener); opener.focus();
    w.openModal('invoice-modal'); await h.settle(3, 50);
    const inv = d.getElementById('invoice-modal');
    A('invoice modal: focus moves into it', inv.contains(d.activeElement), `active=${d.activeElement && (d.activeElement.id || d.activeElement.tagName)}`);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await h.settle(3, 50);
    A('invoice modal: Escape closes it and focus returns to what opened it', !w._ffModalA11y.isOpen(inv) && d.activeElement === opener, `open=${w._ffModalA11y.isOpen(inv)} active=${d.activeElement && d.activeElement.id}`);

    // The whole live app, as rendered after boot (+ the runtime modal in the DOM).
    w.eval(axe.source);
    const live = await w.axe.run(d, { rules: OFF, resultTypes: ['violations'] });
    const ln = live.violations.reduce((s, x) => s + x.nodes.length, 0);
    A('live app after boot: 0 structural violations', ln === 0, summarize(live.violations));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (h) { try { await h.stop(); } catch (_) {} } }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (F52 accessibility)\n`);
  process.exitCode = fail ? 1 : 0;
})();
