'use strict';
/**
 * verify-n3-6-bankrec-category.js — N3-6 (live re-audit 2026-11-11).
 * Bank Rec "Book expense" sent no category, so a CSV-imported line (stored 'Uncategorized') was booked as an
 * "Uncategorized" expense although "Bank Fees" exists (live: P&L "Uncategorized $35").
 * Real SPA (jsdom) + real server: the line is imported through POST /api/banking/import (the shipped CSV path).
 * Expected: the Money Out row offers the expense-form categories; booking with none chosen is refused with a message
 * and sends nothing; choosing "Bank Fees" books ONE expense of 35.00 categorised "Bank Fees".
 * Bug values: no category control; the expense is booked at once as "Uncategorized".
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function seed({ http }) {
  const J = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 200)); return JSON.parse(r.text); };
  const ent = J(await http.post('/api/entities', { name: 'BankRec Co', currency: 'USD', timezone: 'UTC', country: 'US' }));
  J(await http.post('/api/entities/' + ent.id + '/activate', {}));
  const imp = J(await http.post('/api/banking/import', { format: 'csv', content: 'Date,Description,Amount\n2026-07-08,BANK FEE,-35.00\n' }));
  if (imp.imported !== 1) throw new Error('import: ' + JSON.stringify(imp));
}

(async () => {
  let ctx;
  try {
    console.log('\n' + '='.repeat(78) + '\n  N3-6 — Bank Rec "Book expense" takes a category; never "Uncategorized" silently\n' + '='.repeat(78) + '\n');
    ctx = await bootSpaInJsdom({ baseSeed: false, apiSeed: seed });
    const { window: w, http, settle } = ctx;
    const notes = []; const on = w.notify; w.notify = (m, e) => { notes.push((e ? 'ERR: ' : '') + m); return on && on(m, e); };
    const posts = []; const rf = w.fetch.bind(w);
    w.fetch = (input, init) => { const u = String(input && input.url || input); if (/book-expense/.test(u)) posts.push(init && init.body); return rf(input, init); };
    w.showPage('bank-rec'); await settle(40, 100); if (typeof w.loadBankRec === 'function') { await w.loadBankRec(); await settle(20, 100); }
    const line = (JSON.parse((await http.get('/api/banking')).text) || []).find(r => /BANK FEE/.test(r.description || ''));
    A('the imported line exists (stored category "' + (line && line.category) + '")', !!line, JSON.stringify(line || null).slice(0, 160));
    const sel = w.document.getElementById('brec-cat-' + line.id);
    const opts = sel ? [...sel.options].map(o => o.value) : [];
    A('the Money Out row offers the expense categories incl. "Bank Fees" (bug: no control)', !!sel && opts.includes('Bank Fees') && opts.includes('Other'), 'options=' + JSON.stringify(opts));
    if (sel) { sel.value = ''; }
    w.ffBankBookExpense(line.id); await sleep(400);
    A('booking with no category chosen is refused with a message and sends nothing (bug: booked as Uncategorized)', posts.length === 0 && notes.some(n => /Choose a category/.test(n)), 'posts=' + posts.length + ' notes=' + JSON.stringify(notes));
    if (sel) { sel.value = 'Bank Fees'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); }
    w.ffBankBookExpense(line.id); await sleep(1200); await settle(20, 100);
    const ex = (JSON.parse((await http.get('/api/expenses')).text) || []).filter(e => /BANK FEE/.test(e.description || ''));
    A('one expense booked: 35.00, category "Bank Fees" (bug: "Uncategorized")', ex.length === 1 && Math.abs(Number(ex[0].amount) - 35) < 0.005 && ex[0].category === 'Bank Fees', JSON.stringify(ex.map(e => ({ amt: e.amount, cat: e.category }))));
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally {
    if (ctx) await ctx.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (N3-6 bank rec category)'));
  process.exit(fail ? 1 : 0);
})();
