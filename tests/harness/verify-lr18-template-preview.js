'use strict';
/**
 * LR18 (live retest A10 / C11): the "Retainer Agreement" template (type Quote) previewed with the heading "INVOICE", and
 * every template's From block printed "New York, NY 10001" — not the business's address. Read (app-main.js
 * buildInvoiceHTML, the only copy): heading + number hard-coded "INVOICE #INV-1042" for every type; the From address a
 * hard-coded sample line.
 *
 * Real SPA in jsdom (clientMoneyKit seed); the account's address is set to "12 Harbour Road, Port of Spain" before boot.
 *   1  Quote template (Retainer Agreement) → heading QUOTE, number QT-…, never "INVOICE"      bug: INVOICE / INV-
 *   2  every template's From block shows the business's address, never "New York, NY 10001"   bug: New York
 *   3  an Invoice-type template still says INVOICE (control)
 */
const { run } = require('./clientMoneyKit.js');

run('LR18 — template previews say what the document is, and whose address', async ({ w, A, ev }) => {
  const tpls = JSON.parse(ev(`JSON.stringify((typeof invTemplatesData!=='undefined'?invTemplatesData:[]).map(t=>({id:t.id,type:t.type})))`));
  // FA-B1 part 2 (2026-10-24): the designs are the three the document renderer draws, each used for EVERY document type;
  // a quote preview is the 'retainer' id kept by buildInvoiceHTML (it renders a QUOTE), an invoice the classic design.
  const inv = tpls.find(t => t.id === 'classic');
  A('setup: the three real designs are listed (classic, minimal, compact)', tpls.map(t => t.id).join() === 'classic,minimal,compact', JSON.stringify(tpls));
  const html = id => String(w.buildInvoiceHTML(id, null, {}) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const q = html('retainer');
  A('1  Quote template: heading QUOTE, number QT-, no "INVOICE"', /\bQUOTE\b/.test(q) && /QT-\d+/.test(q) && !/\bINVOICE\b/.test(q) && !/INV-\d+/.test(q), q.slice(0, 200));
  const bad = tpls.filter(t => /New York, NY 10001/.test(html(t.id)) || !/12 Harbour Road, Port of Spain/.test(html(t.id))).map(t => t.id);
  A('2  every template shows the business address, none "New York, NY 10001"', bad.length === 0, 'wrong: ' + bad.join(', '));
  if (inv) { const i = html(inv.id); A('3  Invoice template still says INVOICE (control)', /\bINVOICE\b/.test(i), i.slice(0, 160)); }
}, { extraSeed: async ({ http }) => { await http.put('/api/settings', { address: '12 Harbour Road, Port of Spain' }); } });
