'use strict';
/**
 * verify-fab1-doc-design.js — FA-B1 part 2. The Templates page offered invoice designs, an accent colour, a logo and a
 * "Powered by FinFlow" switch — and changed a PREVIEW only: real documents (finflow-docview.js) used one fixed design and
 * colour, the editor's Save toasted "saving templates is coming soon", and the preview printed a made-up "Tax (12.5%)".
 * After: the business picks a design (Classic / Modern minimal / Compact), colour and footer — saved on the business —
 * and every real invoice / quote is drawn in it; the logo is the business logo; invoices state their payment terms.
 * Real SPA in jsdom + real bundle + real scratch Postgres; the invoice is created through the route.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fab1-doc-design.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, seedExtra: async (c, uid) => {
      await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1, payment_terms: 15 }]);
    } });
    const { window, http, settle } = boot;
    const d = window.document;
    for (let i = 0; i < 250 && typeof window.renderTemplates !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    const inv = (await http.post('/api/invoices', { client: 'Acme', amount: 1200, status: 'pending', issue_date: '2026-07-10', idempotency_key: 'b1p2-inv' })).json || {};
    const ent = () => ((http.get && 0) || null);
    void ent;
    const srvEnt = async () => (((await http.get('/api/entities')).json || []).find(e => e.is_active == 1 || e.is_active === true) || {});
    try { window.showPage('templates'); window.renderTemplates(); } catch (_) {}
    await settle(4, 40);
    const list = ((d.getElementById('inv-templates-list') || {}).textContent || '').replace(/\s+/g, ' ');
    A('1  the page offers the three designs the documents really use, Classic in use (bug: preview-only styles)', /Classic In use/.test(list) && /Modern minimal/.test(list) && /Compact/.test(list), list.slice(0, 200));
    try { await window.useDocDesign('minimal'); } catch (e) { A('useDocDesign ran', false, e.message); }
    await settle(4, 40);
    A('2  "Use this design" saves it on the business', ((await srvEnt()).doc_style || {}).template === 'minimal', JSON.stringify((await srvEnt()).doc_style));
    try { window.openTemplateEditor('minimal'); window.setTemplateColor('#1f6feb'); window.setTemplatePoweredBy(false); await window.saveTemplateSettings(); } catch (e) { A('editor ran', false, e.message); }
    await settle(4, 40);
    const ds = (await srvEnt()).doc_style || {};
    A('3  the colour and the footer switch are saved (bug: "saving templates is coming soon")', ds.accent === '#1f6feb' && ds.powered_by === false, JSON.stringify(ds));
    // the REAL invoice, drawn by the document renderer from its own record
    const doc = { number: inv.number, party: inv.client, issue_date: inv.issue_date, due_date: inv.due_date, status: inv.status, amount: inv.amount, currency: 'USD' };
    const html = String(window.buildDocumentHTML(doc, 'invoice'));
    A('4  the real invoice is drawn in that design: the colour header band in #1f6feb (bug: fixed design, #c9a84c)', /background:#1f6feb/.test(html) && !/#c9a84c/.test(html), (html.match(/background:#[0-9a-f]{6}/gi) || []).slice(0, 3).join(','));
    A('5  …without the FinFlow footer line, as chosen', !/POWERED BY/.test(html), '');
    A('6  …and it states the business\'s payment terms: Net 15 (the due date 25 Jul follows them)', /Terms:<\/span> Net 15/.test(html) && /25 Jul 2026|Jul 25, 2026/.test(html.replace(/<[^>]+>/g, ' ')), (html.replace(/<[^>]+>/g, ' ').match(/Terms:[^<]{0,40}/) || [''])[0]);
    const prev = String(window.buildInvoiceHTML('classic', null, {}));
    A('7  previews come from the same renderer — no made-up "Tax (12.5%)" line', !/12\.5%/.test(prev) && /INV-0042/.test(prev), '');
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    try { await window._ffSaveDocStyle({ logo }); } catch (e) { A('logo save ran', false, e.message); }
    await settle(3, 30);
    A('8  the editor\'s logo is the business logo, saved — and on the real invoice', (await srvEnt()).logo === logo && String(window.buildDocumentHTML(doc, 'invoice')).includes(logo.slice(0, 40)), '');
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-B1 document design)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
