'use strict';
/**
 * FA-P1d (2026-10-28) — the Documents page never trusts a 200 body to be a list.
 *
 * BUG (executed on the old code, this harness; also sweep round 2, verify-bankrec-render exit 7): app-main renderDocuments
 * stored whatever /api/documents answered (`_docsCache = await res.json()`), and both list reads sit OUTSIDE its try —
 * app-main's `_docsCache.filter(...)` (a type filter on) and the KPI wrapper's `cache.reduce(...)`
 * (finflow-api-wiring-medium.js). A 200 whose body is not an array (`{}`, an `{error}` object, `null` — a proxy page, a
 * shape change, a stub) threw an UNCAUGHT TypeError and left the page on "Loading…" with stale cards.
 * Class (Rule 13): 18 client sites keep a raw .json() body and use it as a list; 17 are inside a try whose catch shows an
 * error/empty state. This is the one whose list reads were uncaught.
 *
 * Seed: clientMoneyKit + one real upload (a.txt, 91 bytes) — so the real path reads 1 / "91 B", which a page that
 * ignores its data (always 0) cannot show.
 *   1  real server: Total files 1, Storage "91 B"
 *   2  200 with {} / {error} / null, filter "all" and filter "receipt": no rejection; the list says it could not load
 *      (a failed load is not an empty folder); every card "—"   bug: TypeError (cache.reduce / .filter / .length), cards
 *      stuck on the last visit ("91 B")
 *   3  the real server again: 1 / "91 B" (nothing stuck)
 *   4  a 500 from the server: the same "could not load" + "—" (it used to read "No documents yet" and 0 — a false empty)
 */
const { run } = require('./clientMoneyKit.js');

run('FA-P1d — Documents survive a 200 body that is not a list', async ({ w, d, settle, eq, http }) => {
  await http.post('/api/documents', { name: 'a.txt', type: 'other', file_data: Buffer.alloc(91, 65).toString('base64'), media_type: 'text/plain' });
  try { w.showPage('documents'); } catch (_) {}
  await settle(20, 60);
  const t = id => (d.getElementById(id) || {}).textContent;
  const render = async () => { try { await w.renderDocuments(); await settle(5, 30); return 'ok'; } catch (e) { return String(e && e.message || e).slice(0, 60); } };

  eq('1  real server: 1 file, 91 B', [await render(), t('docs-count'), t('docs-storage')], ['ok', '1', '91 B']);

  const realFetch = w.fetch;
  const got = [];
  for (const [label, body] of [['{}', '{}'], ['{error}', '{"error":"Upstream unavailable"}'], ['null', 'null']]) {
    for (const filter of ['all', 'receipt']) {
      w.fetch = (url, opts) => /\/api\/documents(\?|$)/.test(String(url))
        ? Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(body) })   // the bankrec stub's shape (jsdom has no Response)
        : realFetch(url, opts);
      if (typeof w.filterDocs === 'function') { try { await w.filterDocs(filter); } catch (_) {} }
      const r = await render();
      const list = ((d.getElementById('documents-list') || {}).textContent || '').trim();
      got.push([label, filter, r, /Could not load your documents/.test(list) && !/No documents yet/.test(list), t('docs-count'), t('docs-storage'), t('docs-added')]);
    }
  }
  w.fetch = realFetch;
  eq('2  a non-list 200 body → no crash; the list says it could not load (not "No documents yet"); every card "—" (each body × each filter)', got,
    ['{}', '{error}', 'null'].flatMap(l => ['all', 'receipt'].map(f => [l, f, 'ok', true, '—', '—', '—'])));

  w.fetch = (url, opts) => /\/api\/documents(\?|$)/.test(String(url)) ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'x' }) }) : realFetch(url, opts);
  if (typeof w.filterDocs === 'function') { try { await w.filterDocs('all'); } catch (_) {} }
  const r4 = await render();
  eq('4  a 500 → "could not load" and "—", not an empty folder of 0', [r4, /Could not load your documents/.test(d.getElementById('documents-list').textContent), t('docs-count'), t('docs-storage')], ['ok', true, '—', '—'], ['ok', false, '0', '0 B']);
  w.fetch = realFetch;

  eq('3  the real server again: 1 file, 91 B', [await render(), t('docs-count'), t('docs-storage')], ['ok', '1', '91 B']);
});
