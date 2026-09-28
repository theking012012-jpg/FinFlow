'use strict';
/**
 * verify-help-center-ui.js — the world-class Help experience, client + admin (Pillars A/B/C/D UI).
 *
 * Part 1 (STRUCTURAL): the concrete wiring that would be missing if any pillar regressed —
 *   Cmd/Ctrl-K palette, guided tours, Ask FinFlow panel, live checklist + My-tickets mounts, and
 *   the admin Support inbox page + loader.
 * Part 2 (BEHAVIOURAL, jsdom): actually renders the client Help Center against a stubbed backend and
 *   drives the interactive pieces — the accordion fills (11 categories / 25 articles), the AI panel
 *   renders an answer, the ⌘K palette lists results, and a guided tour paints its spotlight tooltip.
 *
 *   node tests/harness/verify-help-center-ui.js
 */
const fs = require('fs');
const path = require('path');

(async () => {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

  const idx = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(process.cwd(), 'public', 'admin.html'), 'utf8');

  // ── Part 1: STRUCTURAL ────────────────────────────────────────────────────────
  // Redesigned Help Center shell
  A('client: page-help present', /<div class="page" id="page-help">/.test(idx));
  A('client: hero search with ⌘K hint', /id="help-search"/.test(idx) && /(&#8984;K|⌘K)/.test(idx));
  A('client: Ask FinFlow mount + panel', /id="help-ask"/.test(idx) && /function renderAskPanel/.test(idx) && /help-ask-input/.test(idx));
  A('client: live checklist mount + renderer', /id="help-checklist"/.test(idx) && /function renderChecklist/.test(idx) && /\/api\/help\/progress/.test(idx));
  A('client: My tickets mount + renderer', /id="help-tickets"/.test(idx) && /function renderTickets/.test(idx));
  A('client: category cards + accordion renderer', /function renderCats/.test(idx) && /HELP_CAT_META/.test(idx) && /help-chip/.test(idx));
  A('client: article text HTML-escaped', /_helpEsc\(/.test(idx));

  // Ask FinFlow
  A('client: helpAsk posts /api/help/ask', /window\.helpAsk\s*=/.test(idx) && /fetch\('\/api\/help\/ask'/.test(idx));
  A('client: Ask renders suggested deep-link chips', /_helpLinkChips/.test(idx));

  // Guided tours
  A('client: tour engine defined', /window\.startTour\s*=/.test(idx) && /HELP_TOURS/.test(idx) && /tour-ring/.test(idx));
  A('client: tours cover the core workflows', ['create-invoice', 'log-expense', 'run-payroll', 'connect-bank', 'add-entity', 'reconcile'].every(t => new RegExp("'" + t + "'").test(idx)));
  A('client: tour steps target real UI (nav + action buttons)', /openInvoiceModal\(\)/.test(idx) && /openAddBizModal/.test(idx) && /showPage\('invoices'/.test(idx));

  // Cmd-K palette
  A('client: openHelpPalette defined', /window\.openHelpPalette\s*=/.test(idx) && /help-palette/.test(idx));
  A('client: global ⌘/Ctrl-K listener', /metaKey\|\|e\.ctrlKey/.test(idx) && /openHelpPalette\(\)/.test(idx));
  A('client: palette can search guides AND jump to pages', /HELP_PALETTE_PAGES/.test(idx) && /Ask FinFlow:/.test(idx));

  // showPage hook still renders the center
  A('client: showPage hook renders the center', /id==='help'\)\{ try\{ renderHelpCenter\(\)/.test(idx));

  // Admin Support inbox
  A('admin: Support nav item + open-count badge', /showPage\('support'\)/.test(admin) && /id="support-count"/.test(admin));
  A('admin: page-support with status/actor filters', /id="page-support"/.test(admin) && /support-status-filter/.test(admin) && /support-actor-filter/.test(admin));
  A('admin: loadSupport reads /api/admin/support', /function loadSupport/.test(admin) && /\/api\/admin\/support/.test(admin));
  A('admin: resolve + reply actions', /function resolveSupport/.test(admin) && /function replySupport/.test(admin));
  A('admin: support wired into showPage loaders', /support:\s*loadSupport/.test(admin));

  // ── Part 2: BEHAVIOURAL (jsdom) ────────────────────────────────────────────────
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); } catch (_) {
    A('[jsdom] not installed — behavioural checks skipped (structural still ran)', true);
  }
  if (JSDOM) {
    const page = (idx.match(/<div class="page" id="page-help">[\s\S]*?<div id="help-contact"[^>]*><\/div>\s*<\/div>\s*<\/div>/) || [])[0];
    const s = idx.indexOf('var HELP_ARTICLES = [');
    const hook = idx.indexOf("if(id==='help'){ try{ renderHelpCenter(); }catch(e){} } return r; }; } })();");
    const js = idx.slice(s, idx.indexOf('\n', hook));
    A('[jsdom] extracted the help markup + module', !!page && s > 0 && hook > s, `page=${!!page} s=${s} hook=${hook}`);

    const doc = `<!doctype html><html><head></head><body>
      <div class="nav-item" onclick="showPage('invoices',this)">Invoices</div>
      <button onclick="openInvoiceModal()">+ New invoice</button>
      <button onclick="openAddBizModal(event)">+ Add business</button>
      ${page}</body></html>`;
    const dom = new JSDOM(doc, { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.showPage = () => true;
    w.fetch = (url) => {
      url = String(url);
      if (url.indexOf('/api/help/progress') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ completed: 2, total: 6, allDone: false, steps: [
        { key: 'entity', label: 'Set up your business', done: true, tour: 'add-entity', page: 'entities' },
        { key: 'invoice', label: 'Create your first invoice', done: false, tour: 'create-invoice', page: 'invoices' },
        { key: 'books', label: 'Confirm your books balance', done: false, tour: null, page: 'reports' } ] }) });
      if (url.indexOf('/api/support') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ requests: [{ id: 1, subject: 'Test ticket', category: 'help-center', status: 'open', created_at: new Date().toISOString() }] }) });
      if (url.indexOf('/api/help/ask') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ reply: 'Switch the entity picker to the consolidated view.', links: [{ page: 'entities', label: 'Businesses' }] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    };
    w.eval(js);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const d = w.document;
    let threw = null;
    try { w.renderHelpCenter(); } catch (e) { threw = e.message; }
    A('[jsdom] renderHelpCenter runs without throwing', !threw, threw);
    await sleep(180);
    A('[jsdom] 11 category cards render', d.querySelectorAll('#help-cats .help-cat').length === 11, 'cats=' + d.querySelectorAll('#help-cats .help-cat').length);
    A('[jsdom] all 25 articles render', d.querySelectorAll('#help-cats .help-art').length === 25, 'articles=' + d.querySelectorAll('#help-cats .help-art').length);
    A('[jsdom] category filter chips render (All + 11)', d.querySelectorAll('#help-cats .help-chip').length === 12, 'chips=' + d.querySelectorAll('#help-cats .help-chip').length);
    A('[jsdom] live checklist rendered from progress', /Getting started|all set/.test(d.getElementById('help-checklist').innerHTML));
    A('[jsdom] My tickets rendered from /api/support', /Your requests/.test(d.getElementById('help-tickets').innerHTML));
    A('[jsdom] Ask FinFlow input present', !!d.getElementById('help-ask-input'));

    let askThrew = null; try { w.helpAsk('how do I consolidate'); } catch (e) { askThrew = e.message; }
    await sleep(80);
    const askThread = d.getElementById('help-ask-thread');
    A('[jsdom] Ask renders the AI answer in the thread', !askThrew && !!askThread && /consolidate/.test(askThread.innerHTML), askThrew || (askThread ? askThread.innerHTML.slice(0, 80) : 'no thread'));
    A('[jsdom] Ask shows the escalation action after an answer', !!askThread && /Send this to support/.test(askThread.innerHTML));
    let newThrew = null; try { w.helpNewChat(); } catch (e) { newThrew = e.message; }
    const clearedHtml = d.getElementById('help-ask-thread').innerHTML;
    A('[jsdom] New chat clears the thread (answer gone, empty hint back)', !newThrew && !/consolidated view/.test(clearedHtml) && /Ask anything about using FinFlow/.test(clearedHtml), newThrew || clearedHtml.slice(0, 80));

    let palThrew = null; try { w.openHelpPalette(); } catch (e) { palThrew = e.message; }
    A('[jsdom] ⌘K palette opens with results', !palThrew && !!d.getElementById('help-palette') && d.querySelectorAll('#hp-results .hp-row').length > 5, palThrew || ('rows=' + d.querySelectorAll('#hp-results .hp-row').length));

    let tourThrew = null; try { w.startTour('create-invoice'); } catch (e) { tourThrew = e.message; }
    await sleep(350);
    const tip = d.querySelector('.tour-tip');
    A('[jsdom] guided tour paints a spotlight tooltip', !tourThrew && !!tip && /Open Invoices/.test(tip.innerHTML), tourThrew || (tip ? 'ok' : 'no tip'));
  }

  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (help center UI — client + admin)`);
  console.log('');
  process.exitCode = fail === 0 ? 0 : 1;
})();
