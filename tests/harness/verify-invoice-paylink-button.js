#!/usr/bin/env node
'use strict';
/**
 * verify-invoice-paylink-button.js — F172. The invoice list renders a "Pay link ↗" action for
 * UNPAID invoices, wired to window.ffInvoicePaymentLink(invoice.id), and NOT for paid ones.
 * Executes the actual shipped source of the runtime-winner renderInvoices (window.renderInvoices in
 * finflow-api-wiring-medium.js — the bundle is regenerated from it), so this reflects what ships.
 *
 *   node tests/harness/verify-invoice-paylink-button.js
 *
 * No database — pure render. Safe to run anywhere.
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

console.log('\n' + '='.repeat(78));
console.log('  INVOICE "Pay link" BUTTON — renders for unpaid invoices, wired to ffInvoicePaymentLink');
console.log('='.repeat(78) + '\n');

A('extracted the runtime-winner renderInvoices', /Pay link/.test(fnSrc), 'source should contain the new button');
eval(fnSrc);                       // defines window.renderInvoices in this scope
A('window.renderInvoices is callable', typeof window.renderInvoices === 'function');

// ── an UNPAID invoice shows Pay link wired to the DB id ──
window.userInvoices = [{ client: 'Acme', amount: 500, due: '2026-07-01', color: '#000', status: 'pending', id: 42 }];
window.renderInvoices();
A('unpaid invoice: "Pay link" button present', /Pay link/.test(el.innerHTML));
A('unpaid invoice: wired to ffInvoicePaymentLink(window.userInvoices[0].id)',
  /ffInvoicePaymentLink\(window\.userInvoices\[0\]\.id\)/.test(el.innerHTML), el.innerHTML.slice(0, 200));
A('unpaid invoice: still has Record Payment (not replaced)', /Record Payment/.test(el.innerHTML));

// ── a PAID invoice must NOT show Pay link ──
window.userInvoices = [{ client: 'Beta', amount: 300, due: '2026-06-01', color: '#000', status: 'paid', id: 7 }];
window.renderInvoices();
A('paid invoice: no "Pay link" button', !/Pay link/.test(el.innerHTML), el.innerHTML.slice(0, 160));

console.log('\n' + '-'.repeat(78));
console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (invoice Pay-link button)'
                       : '  ' + fail + ' FAILED, ' + pass + ' passed');
console.log('-'.repeat(78) + '\n');
process.exit(fail === 0 ? 0 : 1);
