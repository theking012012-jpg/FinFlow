'use strict';
/**
 * LR13 (live retest C11): after an upload the Documents cards stayed "TOTAL FILES 0 · STORAGE USED 0 KB · ADDED THIS
 * MONTH 0" with the file listed; the size showed "93" with no unit for a 91-byte file; .txt was not in the picker.
 * Read: app-main keeps the list in a script-scoped `let _docsCache` — never window._docsCache, which is what the cards'
 * wrapper (finflow-api-wiring-medium.js) reads → always []. The size is stored in BYTES (an estimate: ceil(len × 0.75)
 * of the base64 = 93 for 91 bytes) and the card summed it as KB.
 *
 * Real SPA in jsdom → real server → scratch Postgres (clientMoneyKit seed; clock pinned 2026-07-25). Two uploads through
 * the real route: a.txt = 91 bytes, b.pdf = 2,048 bytes (sizes chosen so bytes-vs-KB and the padding estimate both show).
 *   1  Total files 2                                       bug: 0
 *   2  Storage used "2.1 KB" (2,139 bytes)                  bug: "0 KB"
 *   3  Added this month 2                                  bug: 0
 *   4  the list shows "91 B" and "2 KB" (a unit, exact)     bug: "93", "2732"
 *   5  the upload picker accepts .txt                      bug: not listed
 */
const { run } = require('./clientMoneyKit.js');

run('LR13 — Documents cards count what is listed, with real sizes', async ({ w, d, settle, eq, A, http }) => {
  const b64 = n => Buffer.alloc(n, 65).toString('base64');
  await http.post('/api/documents', { name: 'a.txt', type: 'other', file_data: b64(91), media_type: 'text/plain' });
  await http.post('/api/documents', { name: 'b.pdf', type: 'receipt', file_data: b64(2048), media_type: 'application/pdf' });
  try { w.showPage('documents'); } catch (_) {}
  await settle(20, 60);
  try { await w.renderDocuments(); } catch (_) {}
  await settle(20, 60);
  const t = id => (d.getElementById(id) || {}).textContent;
  eq('1  Total files', t('docs-count'), '2', '0');
  eq('2  Storage used (2,139 bytes)', t('docs-storage'), '2.1 KB', '0 KB');
  eq('3  Added this month', t('docs-added'), '2', '0');
  const list = ((d.getElementById('documents-list') || {}).textContent || '').replace(/\s+/g, ' ');
  A('4  list shows "91 B" and "2 KB"', /91 B/.test(list) && /2 KB/.test(list), list.slice(0, 200));
  if (typeof w.openUploadModal === 'function') { try { w.openUploadModal(); } catch (_) {} await settle(5, 30); }
  const inp = d.getElementById('doc-file-input');
  A('5  upload picker accepts .txt', !!inp && /(^|,)\.txt(,|$)/.test(inp.getAttribute('accept') || ''), inp && inp.getAttribute('accept'));
});
