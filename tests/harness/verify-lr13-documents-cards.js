'use strict';
/**
 * verify-lr13-documents-cards.js — LR13: the Documents cards count what is listed; a size carries its unit; .txt can
 * be picked; a document's type is one of the picker's (never free text written into the page).
 *  Root cause (cards): the card writer wrapped renderDocuments and read window._docsCache — never set (app-main's
 *  _docsCache is a script-scoped let) — so TOTAL FILES / STORAGE / ADDED THIS MONTH stayed 0 beside a listed file.
 *  Size: stored as ceil(base64 length × 0.75) bytes (93 for a 91-byte file) and printed with no unit.
 *
 * Real scratch Postgres, real server, real SPA (bundle). The upload goes through the page's own Upload form: a 91-byte
 * .txt File read by the browser's FileReader and POSTed by uploadDocument(). One older document (June) is seeded so
 * "added this month" must tell months apart (Rule 4: 2 files, 1 this month).
 *   cards: count 2 · storage "1.1 KB" (91 + 1,000 B) · added this month 1      (old: 0 · 0 KB · 0 — measured)
 *   list: the new file reads "91 B"                                              (old: "93")
 *   picker accepts .txt                                                          (old: no)
 *   POST type '<img …>' → stored "other", no element drawn                       (old: stored as sent)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr13-documents-cards.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR13 — Documents cards, size units, .txt, document type\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR13 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await client.query(`INSERT INTO documents (user_id, entity_id, data) VALUES ($1,$2,$3)`,
        [userId, e.id, { name: 'june.pdf', type: 'report', media_type: 'application/pdf', size: 1000, file_data: Buffer.alloc(1000).toString('base64'), uploaded_at: '2026-06-15T10:00:00.000Z' }]);
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('documents');
    await settle(30, 40);

    w.openUploadModal(); await settle(5, 10);
    const fi = d.getElementById('doc-file-input');
    eq('the picker accepts .txt', (fi.getAttribute('accept') || '').split(',').includes('.txt'), true, false);
    const text = 'x'.repeat(91);
    const file = new w.File([text], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(fi, 'files', { value: [file], configurable: true });
    d.getElementById('doc-type-input').value = 'report';
    await w.uploadDocument();
    await settle(60, 60);

    const t = id => ((d.getElementById(id) || {}).textContent || '').trim();
    eq('cards: files · storage · added this month', [t('docs-count'), t('docs-storage'), t('docs-added')], ['2', '1.1 KB', '1'], ['0', '0 KB', '0']);
    const list = t('documents-list');
    const row = list.slice(list.indexOf('notes.txt'), list.indexOf('notes.txt') + 60);
    eq('the uploaded file shows "91 B"', /notes\.txt\s*91 B/.test(row), true, false);

    const r = await w.fetch('/api/documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'odd.txt', type: '<img src=x id=lr13img>', file_data: Buffer.from('hi').toString('base64'), media_type: 'text/plain' }) });
    const saved = await r.json();
    eq('a type outside the picker is stored as "other"', saved.type, 'other', '<img src=x id=lr13img>');
    await w.renderDocuments(); await settle(10, 20);
    eq('…and no element is drawn from it', d.querySelectorAll('#documents-list img').length, 0, 2);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
