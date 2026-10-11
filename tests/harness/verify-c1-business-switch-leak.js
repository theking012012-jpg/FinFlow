'use strict';
/**
 * C1 (Cowork end-to-end test, 2026-10-11, items 4.1a / 4.5d / 5.4c): after switching business, NO page shows the
 * previous business's data, and the Personal page does not change at all.
 * BUG (seen live, gone on reload): the browser kept the previous business's data in memory after a switch: Island
 * Traders' Payroll page showed Northwind's owner pay, and Northwind's stock, investment and bank-rec figures stayed
 * on screen. Choosing a TTD business also flipped the Personal page to TTD.
 * This is the test the wall work lacked: it does what a user does. It opens every page in business A (so A's data is
 * loaded), switches to business B in the same session, opens every page again, and fails on any A-only text.
 * Seed: clientMoneyKit Business A (customers Acme Ltd / Beta Co, vendor Supply Co, item Widget, employee Sam Field)
 *   + owner "Olive Owner" on A's roster (net 3,600) + A's business holding "NWHOLD" + A's bank line "NW BANK LINE"
 *   + Business B "Island Co" (TTD), with nothing in it.
 * A token that appears anywhere in the static page HTML is never used (it could not prove a leak).
 */
const { run } = require('./clientMoneyKit.js');
const fs = require('fs');
const path = require('path');

const PAGES = ['dashboard', 'banking', 'bank-rec', 'invoices', 'customers', 'quotes', 'payments-received', 'sales-receipts',
  'recurring-invoices', 'credit-notes', 'expenses', 'bills', 'vendors', 'payments-made', 'recurring-bills', 'vendor-credits',
  'payroll', 'inventory', 'items', 'projects', 'timesheet', 'reports', 'budget', 'biz-investments', 'manual-journals',
  'chart-of-accounts', 'documents', 'audit', 'entities'];
const TOKENS_ALL = ['Acme Ltd', 'Beta Co', 'Supply Co', 'Widget', 'Sam Field', 'Olive Owner', 'NWHOLD', 'NW BANK LINE', '3,600', 'Net Host'];

run('C1 — switching business leaves nothing of the previous one on any page; Personal unchanged', async ({ w, d, ev, settle, eq, A, http }) => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const TOKENS = TOKENS_ALL.filter(t => !html.includes(t));
  const pageText = id => { const el = d.getElementById('page-' + id); return el ? el.textContent.replace(/\s+/g, ' ') : ''; };
  const open = async id => { try { w.showPage(id); } catch (_) {} await settle(12, 50); };
  const persSnap = async () => {
    await open('personal'); await w.loadPersonalFinance(); await settle(20, 50);
    return { cur: ev('typeof persCurrency !== "undefined" ? persCurrency : null'), income: (d.getElementById('pers-income') || {}).textContent, nw: (d.getElementById('pers-nw') || {}).textContent };
  };

  // Business A: open every page so its data is loaded the way a user loads it.
  for (const p of PAGES) await open(p);
  const seenInA = TOKENS.filter(t => PAGES.some(p => pageText(p).includes(t)));
  A('control: A\'s data is visible in A (' + seenInA.length + ' tokens)', seenInA.length >= 5, JSON.stringify(seenInA));
  const pers0 = await persSnap();

  // Switch to B in the same session.
  const idxB = ev(`(window.ENTITIES||[]).findIndex(e => e.name === 'Island Co')`);
  A('B exists', idxB >= 0, String(idxB));
  // The user's path: the sidebar business switcher.
  const bizIdB = ev(`(function(){ var e = (window.ENTITIES||[]).find(x => x.name === 'Island Co'); return e ? 'biz-' + e._dbId : null; })()`);
  ev(`switchBusiness(${JSON.stringify(bizIdB)})`); await settle(60, 60);
  if (process.env.C1_DUMP) { for (const u of ['/api/inventory', '/api/payroll', '/api/payroll-runs']) { const r = await http.request('GET', u); console.log('API ' + u + ' -> ' + JSON.stringify((r.json || []).map(x => [x.name || x.fname || x.period, x.entity_id]))); } console.log('ENT ' + JSON.stringify(ev(`(window.ENTITIES||[]).map(e=>[e.name,e._dbId,e.active])`))); }
  if (process.env.C1_DUMP) for (const p of PAGES) { await open(p); console.log('DUMP ' + p + ': ' + JSON.stringify(Array.from(d.querySelectorAll('#page-' + p + ' .mc-val, #page-' + p + ' .stat-val, #page-' + p + ' [class*="kpi"]')).map(e => e.textContent.trim()).filter(Boolean).slice(0, 14))); }
  const leaks = [];
  for (const p of PAGES) { await open(p); const t = pageText(p); TOKENS.forEach(k => { if (t.includes(k)) leaks.push(p + ': ' + k); }); }
  if (process.env.C1_DUMP) leaks.forEach(l => { const [pg, tok] = l.split(': '); const t = pageText(pg); const i = t.indexOf(tok); console.log('CTX ' + l + ' :: ' + t.slice(Math.max(0, i - 160), i + 60)); const el = Array.from(d.querySelectorAll('#page-' + pg + ' *')).filter(e => e.children.length === 0 && e.textContent.includes(tok))[0]; if (el) console.log('ELEM ' + (el.id || '') + ' / parent ' + (el.parentElement && el.parentElement.id)); });
  eq('no page in B shows anything of A', leaks, []);
  eq('B dashboard revenue is zero', (d.getElementById('d-rev') || {}).textContent, 'TT$0');
  // B is EMPTY, so every stat card on its pages reads zero / "—". (Entities lists every business by design; the audit
  // trail counts account events.) Cowork saw A's stock value, investment totals and bank-rec counts here.
  const nonZero = [];
  for (const p of PAGES.filter(x => x !== 'entities' && x !== 'audit')) {
    await open(p);
    d.querySelectorAll('#page-' + p + ' .mc-val').forEach(e => { const t = e.textContent.trim(); if (/[1-9]/.test(t.replace(/\b20\d\d\b/g, ''))) nonZero.push(p + ': ' + t); });
  }
  eq("every stat card in the empty business reads zero", nonZero, []);

  const pers1 = await persSnap();
  eq('Personal is identical after the business switch (currency, income, net worth)', pers1, pers0);
}, { extraSeed: async ({ http, client, userId }) => {
  await client.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
  const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + String(r.text).slice(0, 200)); return r.json; };
  await J('POST', '/api/payroll', { fname: 'Olive', lname: 'Owner', gross: 4000, is_owner: true, deductions: [{ label: 'Tax', value: 10, type: 'percent' }] });
  await J('POST', '/api/holdings', { scope: 'business', ticker: 'NWHOLD', name: 'NWHOLD Fund', shares: 3, cost_per: 100, price: 100 });
  await J('POST', '/api/banking', { desc: 'NW BANK LINE', amount: 77, type: 'debit', date: '2026-07-11' });
  await J('POST', '/api/entities', { name: 'Island Co', currency: 'TTD', timezone: 'America/Port_of_Spain', country: 'TT' });
} });
