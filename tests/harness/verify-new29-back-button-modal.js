'use strict';
/**
 * verify-new29-back-button-modal — NEW-29. The phone Back-button handling (app-10-open-modal-el.js) pushes one history
 * entry while a modal is open and removes it when the modal closes. It found "an open modal" with
 * querySelector('.modal-overlay:not(.hidden)') — but the Edit Employee modal hides with display:none, not the class, so
 * that selector ALWAYS found it: after opening and closing any modal the entry was never removed (one Back press did
 * nothing), and a Back press with nothing open "closed" the invisible Edit Employee modal.
 *
 * Executed: the real /app in jsdom (real server + scratch Postgres). Bug values: history.state stays {ffOverlay:1} after
 * the modal closes; a Back with nothing open adds "hidden" to #modal-edit-employee.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new29-back-button-modal.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok || !d ? '' : '\n          ' + d}`); };
(async () => {
  let h;
  console.log('\nNEW-29 — the Back button and modals\n');
  try {
    h = await bootSpaInJsdom({}); await h.idle();
    const w = h.window, d = w.document;
    const emp = d.getElementById('modal-edit-employee');
    w.openModal('invoice-modal'); await h.settle(4, 50);
    A('opening a modal adds the Back entry', JSON.stringify(w.history.state) === '{"ffOverlay":1}', JSON.stringify(w.history.state));
    w.closeModal('invoice-modal'); await h.settle(10, 50);
    A('closing it removes the entry again (bug: stays — one Back press does nothing)', w.history.state == null || !w.history.state.ffOverlay, JSON.stringify(w.history.state));
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
    await h.settle(3, 50);
    A('a Back press with nothing open touches no modal (bug: "closes" the invisible Edit Employee)', !emp.classList.contains('hidden'), emp.className);
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (h) { try { await h.stop(); } catch (_) {} } }
  console.log(`\n  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (NEW-29 Back button + modals)\n`);
  process.exitCode = fail ? 1 : 0;
})();
