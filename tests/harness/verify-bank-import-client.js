#!/usr/bin/env node
'use strict';
/**
 * verify-bank-import-client.js — F178 client. EXECUTES the shipped window.ffImportStatement source
 * (from index.html) through a simulated file upload: fake <input>, stubbed FileReader, captured
 * fetch. Asserts it detects the format from the extension and POSTs the file text to
 * /api/banking/import. Closes the "button exists but the upload chain was inspection-only" gap.
 *
 *   node tests/harness/verify-bank-import-client.js
 *
 * No database — pure client logic. Safe to run anywhere.
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

const IDX = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const fnSrc = extract(IDX, 'window.ffImportStatement = function');

console.log('\n' + '='.repeat(78));
console.log('  BANK IMPORT — client upload chain executed (file → FileReader → POST)');
console.log('='.repeat(78) + '\n');

// controlled browser-ish environment — set as REAL globals so the helper's bareword
// fetch/document/FileReader/notify resolve to them (as they would to window.* in a browser).
let posted = null;
let fakeInput;
global.window = {};
global.fetch = async (url, opts) => { posted = { url, opts }; return { ok: true, json: async () => ({ ok: true, imported: 3, skipped: 0 }) }; };
global.notify = () => {};
global.loadBankingFromDB = () => {};
global.document = {
  createElement: (tag) => {
    if (tag === 'input') { fakeInput = { type: '', accept: '', files: [], onchange: null, click() { /* user picks a file below */ } }; return fakeInput; }
    return {};
  },
};
global.FileReader = class { readAsText(file) { this.result = file._text; if (this.onload) this.onload(); } };

eval(fnSrc);   // defines window.ffImportStatement; its barewords resolve to the globals above
A('window.ffImportStatement is defined', typeof window.ffImportStatement === 'function');

async function upload(name, text) {
  posted = null;
  window.ffImportStatement();                                   // creates the fake input, sets onchange
  A('file input accepts ofx/qfx/csv', /ofx/.test(fakeInput.accept) && /csv/.test(fakeInput.accept), fakeInput.accept);
  fakeInput.files = [{ name, _text: text }];
  await fakeInput.onchange();                                    // simulate the user selecting a file
  await new Promise(r => setTimeout(r, 5));                      // let the async POST settle
  return posted;
}

(async () => {
  // ── .ofx file ──
  let p = await upload('republic-bank.ofx', '<STMTTRN><TRNAMT>-45.00<FITID>X1</STMTTRN>');
  A('OFX upload → POST /api/banking/import', p && /\/api\/banking\/import$/.test(p.url) && p.opts.method === 'POST', p && p.url);
  let body = p && JSON.parse(p.opts.body);
  A('OFX: format detected "ofx" from extension', body && body.format === 'ofx', JSON.stringify(body && body.format));
  A('OFX: file text sent as content', body && body.content.indexOf('STMTTRN') >= 0);

  // ── .csv file ──
  p = await upload('firstcitizens.csv', 'Date,Description,Amount\n2026-07-18,ATM,-200');
  body = p && JSON.parse(p.opts.body);
  A('CSV: format detected "csv" from extension', body && body.format === 'csv', JSON.stringify(body && body.format));
  A('CSV: file text sent as content', body && body.content.indexOf('Date,Description,Amount') >= 0);

  console.log('\n' + '-'.repeat(78));
  console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (bank import client chain)'
                         : '  ' + fail + ' FAILED, ' + pass + ' passed');
  console.log('-'.repeat(78) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})();
