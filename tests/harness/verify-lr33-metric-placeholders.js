'use strict';
/**
 * verify-lr33-metric-placeholders.js — LR33: no metric card shows a made-up "$0".
 *  46 `.mc-val` cards in index.html started as a static "$0": a bare "$" on every non-USD business until a writer ran, and
 *  a fabricated 0 wherever a writer failed or never existed (LR14's Intercompany and LR28's Unattached were two). They
 *  now start as "—", which a writer replaces with a real figure — so a card nothing writes SAYS so.
 *
 * Real scratch Postgres, real server, real SPA (bundle). A TT$ business with an invoice and an expense; EVERY page is
 * opened the way the nav does it (showPage), then each card is read.
 *   Data loaded: business cards showing a bare "$" figure: 0 [GUARD — writers overwrite the placeholder, old and new]
 *   The document the server SERVES (what a card shows before — or without — its writer): cards starting as a
 *     "$" figure: 0                                                                  (old: 40 — measured; 3 more are in lazy screens)
 *   Personal pages (sidebar nav-item--personal) are skipped for "$": they are in the personal currency (USD here).
 *   FINDING (printed): business figures on pages the sidebar files under Personal → LR35
 *   [STRUCTURAL] no `.mc-val` placeholder in index.html is a static "$0"           (old: 43 left after LR14 / LR15 / LR20)
 *   INSTRUMENT (printed, not asserted): every card still "—" after its page loaded = a card nothing wrote on this seed
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr33-metric-placeholders.js
 */
require('./clock.js');
const fs = require('fs'), path = require('path');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR33 — metric cards: no static "$0"\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'Island LR33', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('POST', '/api/invoices', { client: 'Acme', amount: 1200, date: '2026-07-01', due_date: '2026-07-31', status: 'pending' });
      await J('POST', '/api/expenses', { description: 'Rent', amount: 400, category: 'Rent', expense_date: '2026-07-05' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    const realFetchFn = (u) => w.fetch(u, { credentials: 'include' });
    const pages = Array.from(d.querySelectorAll('.page[id^="page-"]')).map(p => p.id.slice(5));
    const personal = new Set(Array.from(d.querySelectorAll('.nav-item--personal')).map(n => ((n.getAttribute('onclick') || '').match(/showPage\('([^']+)'/) || [])[1]).filter(Boolean));
    const readAll = async () => {
      const bare = [], never = [], wall = [];
      for (const p of pages) {
        try { w.showPage(p); } catch (_) { continue; }
        await settle(25, 30);
        d.querySelectorAll('#page-' + p + ' .mc-val').forEach((el, i) => {
          const v = el.textContent.trim();
          const lbl = ((el.parentElement.querySelector('.mc-label') || {}).textContent || '#' + i).trim();
          if (personal.has(p)) { if (/TT\$/.test(v)) wall.push(p + ' · ' + lbl + ' = ' + v); }
          else if (/(?<![A-Z]{2})\$-?\d/.test(v)) bare.push(p + ' · ' + lbl + ' = ' + v);
          if (v === '—') never.push(p + ' · ' + lbl + (el.id ? ' (#' + el.id + ')' : ''));
        });
      }
      return { bare, never, wall };
    };
    eq('[GUARD] pages opened', pages.length > 40, true, undefined);

    // 1) What every card shows BEFORE its writer runs (and for good, if the writer fails or does not exist): the
    //    document the server actually serves (the regenerated /app build), parsed as the browser parses it.
    //    (A network-failure injection was tried and dropped: some loaders do not go through window.fetch, so its
    //    result depended on timing — nondeterministic evidence.)
    const served = await (await realFetchFn('/app')).text();
    const sd = new w.DOMParser().parseFromString(served, 'text/html');
    const servedBare = Array.from(sd.querySelectorAll('.mc-val')).filter(el => /(?<![A-Z]{2})\$-?\d/.test(el.textContent.trim()))
      .map(el => ((el.closest('.page') || {}).id || '?') + ' · ' + ((el.parentElement.querySelector('.mc-label') || {}).textContent || '').trim() + ' = ' + el.textContent.trim());
    eq('served page: no card starts as a "$" figure (it reads "—" until its writer runs)', servedBare.length, 0, 40);
    if (servedBare.length) servedBare.slice(0, 50).forEach(x => console.log('     ' + x));

    // 2) Then the data loads: every writer runs.
    const ok = await readAll();
    eq('[GUARD] loaded: no business card shows a bare "$" figure (writers overwrite the placeholder)', ok.bare, [], undefined);
    console.log('\n  INSTRUMENT — cards still "—" after their page loaded on this seed (' + ok.never.length + '):');
    ok.never.forEach(x => console.log('     ' + x));
    console.log('\n  FINDING (LR35, printed, not asserted) — business figures on pages the sidebar files under Personal (' + ok.wall.length + '):');
    ok.wall.forEach(x => console.log('     ' + x));

    const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
    eq('[STRUCTURAL] no static "$0" .mc-val placeholder', (html.match(/class="mc-val"[^>]*>\$0</g) || []).length, 0, 43);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
