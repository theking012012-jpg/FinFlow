'use strict';
/**
 * scripts/gen-handlers.js — FA-P1 (2026-10-27): builds public/_gen/ff-handlers.js, the registry of every event handler
 * FinFlow's own markup names (data-on-<event>="<code>"), read from the source: page markup, the strings and templates
 * scripts build HTML from, and setAttribute('data-on-…', '…'). public/ff-csp.js runs a handler only if its code is here.
 *
 * Each entry is the code wrapped exactly as the browser wrapped an inline handler: a function of `event`, called with
 * `this` = the element, inside the element / form / document scope. The file is sloppy-mode script on purpose (`with`).
 * A handler whose code is built from a runtime value cannot be registered and fails the build (FA-P1 made every one
 * constant: values travel in data-arg-* attributes). So does code that does not compile, and an event ff-csp.js does
 * not dispatch.
 *
 *   node scripts/gen-handlers.js           write the registry
 *   node scripts/gen-handlers.js --check   exit 1 if the committed registry is not what the source produces
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { files } = require('./csp-scan.js');

const PUB = path.join(__dirname, '..', 'public');
const OUT = path.join(PUB, '_gen', 'ff-handlers.js');
const ENT = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' };
const decode = v => v.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m));

function collect() {
  const found = new Map(), problems = [];
  const add = (code, event, where) => { if (!found.has(code)) found.set(code, { events: new Set(), where }); found.get(code).events.add(event); };
  const ATTR = /data-on-([a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const rel of files()) {
    const s = fs.readFileSync(path.join(PUB, rel), 'utf8');
    if (rel.endsWith('.html')) {
      for (const m of s.matchAll(ATTR)) add(decode(m[2] != null ? m[2] : m[3]), m[1], rel);
      continue;
    }
    const ast = acorn.parse(s, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true, locations: true });
    const seen = new Set();
    // The text a chain of + / a template produces, with \u0000 for each runtime value; every literal / template joined in
    // is marked seen so it is not read again on its own.
    const parts = n => {
      if (n.type === 'BinaryExpression' && n.operator === '+') return parts(n.left).concat(parts(n.right));
      if (n.type === 'Literal' && typeof n.value === 'string') { seen.add(n); return [n.value]; }
      if (n.type === 'TemplateLiteral') { seen.add(n); return n.quasis.flatMap((q, i) => i < n.expressions.length ? [q.value.cooked, parts(n.expressions[i]).join('')] : [q.value.cooked]); }
      return ['\u0000'];
    };
    (function walk(n, p) {
      if (!n || typeof n.type !== 'string') return;
      const isRoot = (n.type === 'BinaryExpression' && n.operator === '+' && !(p && p.type === 'BinaryExpression' && p.operator === '+')) || n.type === 'TemplateLiteral' || (n.type === 'Literal' && typeof n.value === 'string');
      if (isRoot && !seen.has(n)) {
        const joined = parts(n).join('');
        for (const m of joined.matchAll(ATTR)) {
          if (joined[m.index - 1] === '[') continue;   // a CSS selector naming a handler, not markup
          const v = m[2] != null ? m[2] : m[3];
          if (v.includes('\u0000')) problems.push(`${rel}:${n.loc.start.line} data-on-${m[1]} is built from a runtime value — put the value in a data-arg-* attribute: ${v.replace(/\u0000/g, '${…}').slice(0, 100)}`);
          else add(decode(v), m[1], rel + ':' + n.loc.start.line);
        }
      }
      if (n.type === 'CallExpression' && n.callee && n.callee.property && n.callee.property.name === 'setAttribute' && n.arguments[0] && n.arguments[0].type === 'Literal' && /^data-on-[a-z]+$/.test(String(n.arguments[0].value))) {
        const a1 = n.arguments[1];
        if (a1 && a1.type === 'Literal' && typeof a1.value === 'string') add(a1.value, String(n.arguments[0].value).slice(8), rel + ':' + n.loc.start.line);
        else problems.push(`${rel}:${n.loc.start.line} setAttribute('${n.arguments[0].value}', …) with a value that is not written out`);
      }
      for (const k in n) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(c => walk(c, n)); else if (v && typeof v.type === 'string') walk(v, n); }
    })(ast, null);
  }
  return { found, problems };
}

function build() {
  const { found, problems } = collect();
  const runtime = fs.readFileSync(path.join(PUB, 'ff-csp.js'), 'utf8');
  const events = new Set(JSON.parse(runtime.match(/var EVENTS = (\[[^\]]*\])/)[1].replace(/'/g, '"').replace(/\s+/g, ' ')));
  const keys = [...found.keys()].sort();
  for (const code of keys) {
    for (const ev of found.get(code).events) if (!events.has(ev)) problems.push(`${found.get(code).where}: data-on-${ev} — ff-csp.js does not dispatch "${ev}"`);
    try { new Function('event', 'with(document){with({}){with({}){' + code + '\n}}}'); }   // eslint-disable-line no-new-func
    catch (e) { problems.push(`${found.get(code).where}: handler does not compile (${e.message}): ${code.slice(0, 100)}`); }
  }
  return { text: registryText(keys), problems, count: keys.length };
}

// The registry file for a list of handler codes — each wrapped as the browser wrapped an inline handler.
function registryText(keys) {
  const body = keys.map(k => `  ${JSON.stringify(k)}: function (event) { with (this.ownerDocument || document) { with (this.form || {}) { with (this) {\n${k}\n  } } } },`).join('\n');
  return `/* GENERATED by scripts/gen-handlers.js — do not edit. FA-P1: every event handler FinFlow's own markup names
 * (data-on-<event>="<code>"), keyed by its code. public/ff-csp.js runs a handler only if it is here. ${keys.length} handlers. */
(function (H) {
  var R = {
${body}
  };
  for (var k in R) H[k] = R[k];
})(window.__ffHandlers || (window.__ffHandlers = Object.create(null)));
`;
}

module.exports = { build, collect, registryText };

if (require.main === module) {
  const { text, problems, count } = build();
  if (problems.length) { console.error('[gen-handlers] ' + problems.length + ' problem(s):\n  ' + problems.join('\n  ')); process.exit(1); }
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('[gen-handlers] public/_gen/ff-handlers.js is out of date — run: node scripts/gen-handlers.js'); process.exit(1); }
    console.log('[gen-handlers] OK — ' + count + ' handlers, registry up to date.');
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log('[gen-handlers] wrote ' + count + ' handlers to public/_gen/ff-handlers.js');
  }
}
