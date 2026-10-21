'use strict';
/**
 * verify-lr18-quote-template-preview.js — LR18: a Quote template previews as a quote, on the business's own letterhead.
 *  • "Retainer Agreement" (type Quote) previewed with "INVOICE", "#INV-1042", "Bill to", "Due within 30 days".
 *  • The From block printed a made-up "New York, NY 10001" for every business, and the USER's own e-mail (s-email)
 *    rather than the business's (the F196 class: personal contact on a business document).
 *  • LR25 class: the preview is put in a srcdoc ATTRIBUTE escaping only '"' — the attribute decode turned escaped
 *    "&lt;b&gt;" back into live markup inside a same-origin frame.
 *
 * Real scratch Postgres, real server, real SPA (bundle). The preview is opened with the page's own Preview button
 * handler (openTemplatePreview) and the frame's srcdoc is parsed as the browser would.
 *   retainer: "QUOTE" · "#Q-1042" · "Prepared for" · "Valid for"; no "INVOICE"      (old: INVOICE / Bill to — measured)
 *   From: "billing@island.test" + "Port of Spain"; no "New York, NY 10001"; not the user's own e-mail
 *   business named "Island <b>LR18</b>" → no <b> element inside the frame          (old: 2)
 *   classic (an invoice template) still reads "INVOICE"                             [GUARD]
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr18-quote-template-preview.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot;
  console.log('\nLR18 — quote template preview: QUOTE, the business letterhead, no live markup\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client, userId }) => {
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'Island <b>LR18</b>', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT',
        address: '12 Frederick St\nPort of Spain', email: 'billing@island.test' });
      await J('POST', '/api/entities/' + e.id + '/activate', {});
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);
    w.showPage('templates');
    await settle(30, 40);
    // The user's OWN e-mail sits in Settings › Your profile (s-email); a value there must never reach a business document.
    const userEmail = 'me.personal@example.test';
    d.getElementById('s-email').value = userEmail;
    const frameDoc = () => {
      const f = d.getElementById('tmpl-preview-frame');
      return f ? new w.DOMParser().parseFromString(f.getAttribute('srcdoc') || '', 'text/html') : null;
    };

    w.openTemplatePreview('retainer'); await settle(5, 10);
    const q = frameDoc(); const qt = q ? q.body.textContent : '';
    eq('retainer previews as a QUOTE', [/QUOTE/.test(qt), /#Q-1042/.test(qt), /Prepared for/.test(qt), /Valid for/.test(qt), /INVOICE/.test(qt)],
      [true, true, true, true, false], [false, false, false, false, true]);
    eq('From = the business letterhead (no made-up city)', [/billing@island\.test/.test(qt), /Port of Spain/.test(qt), /New York, NY 10001/.test(qt)],
      [true, true, false], [false, false, true]);
    eq('…and never the user\'s own e-mail', qt.includes(userEmail), false, true);
    eq('a business name with markup draws no element inside the frame', q ? q.querySelectorAll('b').length : -1, 0, 2);
    const ov = d.getElementById('tmpl-preview-overlay'); if (ov) ov.remove();

    w.openTemplatePreview('classic'); await settle(5, 10);
    const c = frameDoc();
    eq('[GUARD] an invoice template still reads INVOICE', !!(c && /INVOICE/.test(c.body.textContent) && !/QUOTE/.test(c.body.textContent)), true, undefined);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
