'use strict';
/**
 * verify-lr28-documents-no-false-claims.js — LR28: the Documents cards claim nothing the product does not do.
 *  "Unattached · Needs linking" had no writer and documents have no link field (it read 0 for ever); "Storage used …
 *  of 5 GB" named a quota nothing enforces (the server's limit is 5 MB per file — MAX_DOC_SIZE). Both are gone; the
 *  storage caption states the real limit.
 *
 * Real scratch Postgres, real server, real SPA (bundle). One 1,000-byte document seeded.
 *   cards: Total Files 1 · Storage Used "1000 B" · Added this month — no "Unattached" card   (old: + "Unattached 0")
 *   storage caption "Up to 5 MB per file"                                                  (old: "of 5 GB")
 *   [GUARD] the server refuses a file over 5 MB (413) — the caption's limit is real
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr28-documents-no-false-claims.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR28 — Documents cards: no "Unattached", no "of 5 GB"\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR28 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('POST', '/api/documents', { name: 'a.pdf', type: 'report', file_data: Buffer.alloc(1000).toString('base64'), media_type: 'application/pdf' });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('documents'); await settle(40, 50);
    const cards = Array.from(d.querySelectorAll('#page-documents .mc')).map(m => [m.querySelector('.mc-label').textContent.trim(), m.querySelector('.mc-val').textContent.trim(), m.querySelector('.mc-change').textContent.trim()]);
    eq('the cards', cards.map(c => c[0]), ['Total Files', 'Storage Used', 'Added this month'], ['Total Files', 'Storage Used', 'Unattached', 'Added this month']);
    eq('storage states the real limit', (cards.find(c => c[0] === 'Storage Used') || [])[2], 'Up to 5 MB per file', 'of 5 GB');
    const big = await w.fetch('/api/documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'big.bin', type: 'other', file_data: Buffer.alloc(5 * 1024 * 1024 + 10).toString('base64') }) });
    eq('[GUARD] a file over 5 MB is refused', big.status, 413, undefined);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
