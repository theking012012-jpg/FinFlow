#!/usr/bin/env node
'use strict';
// D-A: writes the landing page's plan cards, prices and plan comparison FROM plans.js (the one plan definition the
// server enforces). Runs as part of `npm run gen` / `npm run build`. Idempotent: it only rewrites what sits between
// the <!-- gen:… --> markers and the price spans, so running it twice changes nothing.
// verify-plans-one-source fails if public/landing.html is not what this script produces.
const fs = require('fs');
const path = require('path');
const Plans = require('../plans');

const FILE = path.join(__dirname, '..', 'public', 'landing.html');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PRICE_ID = { pro: 'land-price-pro', business: 'land-price-biz', scale: 'land-price-scale' };

function between(s, name, body) {
  const open = '<!-- gen:' + name + ' -->', close = '<!-- /gen:' + name + ' -->';
  const i = s.indexOf(open), j = s.indexOf(close);
  if (i < 0 || j < i) throw new Error('landing.html: missing markers for ' + name);
  return s.slice(0, i + open.length) + '\n' + body + s.slice(j);
}

function render(src) {
  let s = src;
  for (const id of Plans.PAID) {
    const lines = Plans.cardLines(id).map(t => '          <div class="p-feat"><span class="p-check">✓</span>' + esc(t) + '</div>').join('\n');
    s = between(s, 'plan:' + id, lines + '\n');
    const re = new RegExp('(<span id="' + PRICE_ID[id] + '">)[^<]*(</span>)');
    if (!re.test(s)) throw new Error('landing.html: missing price span ' + PRICE_ID[id]);
    s = s.replace(re, '$1' + Plans.PLANS[id].monthly + '$2');
  }
  const head = '<tr><th></th>' + Plans.PAID.map(id => '<th scope="col"' + (id === 'business' ? ' class="hot"' : '') + '>' + esc(Plans.PLANS[id].name) + '</th>').join('') + '</tr>';
  const rows = Plans.comparisonRows().map(([label, vals]) =>
    '        <tr><td>' + esc(label) + '</td>' + vals.map((v, k) => '<td' + (Plans.PAID[k] === 'business' ? ' class="hot"' : '') + '>' + esc(v) + '</td>').join('') + '</tr>').join('\n');
  const table =
    '    <div class="plan-compare-wrap reveal">\n' +
    '      <h3 class="plan-compare-h">Compare plans</h3>\n' +
    '      <table class="plan-compare" id="plan-compare">\n' +
    '        <thead>' + head + '</thead>\n' +
    '        <tbody>\n' + rows + '\n        </tbody>\n' +
    '      </table>\n' +
    '    </div>\n';
  s = between(s, 'plan-compare', table);
  return s;
}

if (require.main === module) {
  const before = fs.readFileSync(FILE, 'utf8');
  const after = render(before);
  if (after !== before) { fs.writeFileSync(FILE, after); console.log('[gen-plan-cards] landing.html plan cards + comparison written from plans.js'); }
  else console.log('[gen-plan-cards] landing.html already matches plans.js');
}
module.exports = { render };
