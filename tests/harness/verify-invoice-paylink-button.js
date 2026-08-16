#!/usr/bin/env node
'use strict';
/**
 * verify-invoice-paylink-button.js — F172 / F181 / F185. The invoice list renders a "Pay link" action
 * for UNPAID invoices and NOT for paid ones, wired to the DB id (._dbId) and routed through
 * window.ffInvoicePayLinkChoose. Executes the shipped source of the runtime-winner renderInvoices
 * (window.renderInvoices in finflow-api-wiring-medium.js — the bundle is regenerated from it).
 *
 * F181 REGRESSION GUARD (Rule 3/5): real invoice objects carry the DB id as ._dbId, NOT .id. The old
 * stub seeded .id and asserted on SOURCE TEXT, so it stayed green while the button shipped .id
 * (undefined) -> /api/invoices/undefined/payment-link 500. This version seeds _dbId (the real field)
 * and EXECUTES the button's onclick, asserting the id/URL actually produced — it fails on undefined.
 *
 *   node tests/harness/verify-invoice-paylink-button.js
 *
 * No database — pure render + execute. Safe to run anywhere.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

function extract(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('not found: ' + marker);
  let depth = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced');
}

const file = path.resolve(__dirname, '..', '..', 'public', 'finflow-api-wiring-medium.js');
const src = fs.readFileSync(file, 'utf8');
const fnSrc = extract(src, 'window.renderInvoices = function');

// minimal environment the function touches
const el = { innerHTML: '' };
global.esc = (x) => String(x == null ? '' : x);
global.S = (x) => String(x);
global.updateInvoices = () => {};
global.document = { getElementById: (id) => (id === 'invoice-list' ? el : null) };
global.window = { _isScheduled: () => false };

// Capture what the button actually calls (Rule 5: assert executed values, not source text).
let calledId = 'MISSING', calledUrl = null;
global.ffInvoicePaymentLink = (invoiceId) => { calledId = invoiceId; calledUrl = '/api/invoices/' + invoiceId + '/payment-link'; };
// F185: the button routes through the chooser; with one resolved processor it forwards the id on.
global.ffInvoicePayLinkChoose = (invoiceId) => global.ffInvoicePaymentLink(invoiceId);

console.log('\n' + '='.repeat(78));
console.log('  INVOICE "Pay link" BUTTON — unpaid only, DB id, EXECUTED (F181 guard)');
console.log('='.repeat(78) + '\n');

A('[structural] extracted the runtime-winner renderInvoices', /Pay link/.test(fnSrc), 'source should contain the button');
eval(fnSrc);                       // defines window.renderInvoices in this scope
A('window.renderInvoices is callable', typeof window.renderInvoices === 'function');

// ── an UNPAID invoice: real objects carry _dbId, NEVER .id ──
window.userInvoices = [{ client: 'Acme', amount: 500, due: '2026-07-01', color: '#000', status: 'pending', _dbId: 42 }];
window.renderInvoices();
A('unpaid invoice: "Pay link" button present', /Pay link/.test(el.innerHTML));
A('unpaid invoice: still has Record Payment (not replaced)', /Record Payment/.test(el.innerHTML));

// Execute the button's onclick and assert the id/URL it actually produces.
const call = (el.innerHTML.match(/ffInvoicePayLinkChoose\(window\.userInvoices\[0\][^)]*\)/) || [])[0];
A('unpaid invoice: Pay link wired through ffInvoicePayLinkChoose(window.userInvoices[0]...)', !!call, el.innerHTML.slice(0, 240));
if (call) {
  calledId = 'MISSING'; calledUrl = null;
  eval(call);
  A('EXECUTED: id resolves to the DB id 42, not undefined (F181 regression guard)', calledId === 42, 'got id: ' + calledId);
  A('EXECUTED: builds /api/invoices/42/payment-link (never /undefined/)', calledUrl === '/api/invoices/42/payment-link', 'got url: ' + calledUrl);
}

// ── a PAID invoice must NOT show Pay link ──
window.userInvoices = [{ client: 'Beta', amount: 300, due: '2026-06-01', color: '#000', status: 'paid', _dbId: 7 }];
window.renderInvoices();
A('paid invoice: no "Pay link" button', !/Pay link/.test(el.innerHTML), el.innerHTML.slice(0, 160));

console.log('\n' + '-'.repeat(78));
console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (invoice Pay-link button)'
                       : '  ' + fail + ' FAILED, ' + pass + ' passed');
console.log('-'.repeat(78) + '\n');
process.exit(fail === 0 ? 0 : 1);
