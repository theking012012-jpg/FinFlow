'use strict';
/**
 * verify-lr32-template-no-sample-tax.js — LR32: template previews invent no tax.
 *  Every preview printed "Tax (12.5%)" — one region's VAT rate hard-coded on every business (FinFlow has no VAT engine;
 *  tax is estimates only) — and a Total that included it. A real document shows a Tax line only when the document
 *  carries a tax amount (finflow-docview.js); the sample carries none, so it shows none.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Sample items 4,800 + 4,800 + 900 = 10,500.
 *   classic and receipt previews: no "Tax" line; Total = $10,500     (old: "Tax (12.5%)" $1,313, Total $11,813 — measured)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr32-template-no-sample-tax.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR32 — template previews invent no tax\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR32 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('templates'); await settle(20, 30);
    const read = id => {
      w.openTemplatePreview(id);
      const f = d.getElementById('tmpl-preview-frame');
      const doc = new w.DOMParser().parseFromString(f.getAttribute('srcdoc') || '', 'text/html');
      const txt = doc.body.textContent.replace(/\s+/g, ' ');
      const ov = d.getElementById('tmpl-preview-overlay'); if (ov) ov.remove();
      const totals = [...txt.matchAll(/(?<!Sub)total\s*\$([\d,]+)/gi)].map(m => '$' + m[1]);   // the grand total, not "Subtotal"
      return [/Tax/.test(txt), totals[totals.length - 1] || null];
    };
    eq('classic: no tax line, Total = the items', read('classic'), [false, '$10,500'], [true, '$11,813']);
    eq('receipt: no tax line, Total = the items', read('receipt'), [false, '$10,500'], [true, '$11,813']);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
