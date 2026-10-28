'use strict';
/**
 * scripts/csp-scan.js — FA-P1 (2026-10-27): finds everything the strict Content-Security-Policy (no 'unsafe-inline')
 * would block in FinFlow's own pages and scripts:
 *   inline-script   a <script> without src in a page
 *   handler         an on<event>="…" attribute — in page markup, or in a string / template a script builds HTML from
 *   style-attr      a style="…" attribute (page markup or script-built HTML)
 *   style-block     a <style> block in a page, or a <style> element a script creates
 *   set-attr        setAttribute('on…' | 'style', …)
 *   js-url          a javascript: URL
 * Each finding: { kind, file, line, code, dynamic } — dynamic = the attribute's value is built from runtime values
 * (${…} or + concatenation) rather than written out in full.
 *
 *   node scripts/csp-scan.js            summary
 *   node scripts/csp-scan.js --list K   every finding of kind K
 *   node scripts/csp-scan.js --json     all findings as JSON
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const PUB = path.join(__dirname, '..', 'public');
const SKIP = /(^|\/)(_gen|vendor|\.min)(\/|$)|finflow-bundle\.js$|\.min\.js$/;

function files() {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f), rel = path.relative(PUB, p).split(path.sep).join('/');
      if (SKIP.test(rel)) continue;
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(html|js)$/.test(f)) out.push(rel);
    }
  })(PUB);
  // The slim /app document (SLIM_APP) is generated from index.html — it is served, so it is held to the same rule.
  if (fs.existsSync(path.join(PUB, '_gen', 'index.html'))) out.push('_gen/index.html');
  return out.sort();
}
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
const ATTR = /(?:^|[\s"'])(on[a-z]+|style)\s*=\s*(["'])/g;

// HTML markup: attributes outside <script>/<style> contents.
function scanHtml(rel, s, out) {
  const masked = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, m => {
    const open = m.match(/^<[^>]*>/)[0];
    if (/^<script/i.test(m) && !/\bsrc\s*=/.test(open) && !/type\s*=\s*["']application\/ld\+json/i.test(open)) out.push({ kind: 'inline-script', file: rel, line: lineOf(s, s.indexOf(m)), code: m.slice(0, 80) });
    if (/^<style/i.test(m)) out.push({ kind: 'style-block', file: rel, line: lineOf(s, s.indexOf(m)), code: m.slice(0, 80) });
    return m.replace(/[^\n]/g, ' ');
  });
  // Only inside tags: walk each tag.
  for (const t of masked.matchAll(/<[a-zA-Z][^<>]*>/g)) {
    for (const a of t[0].matchAll(/\s(on[a-z]+|style)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      out.push({ kind: a[1] === 'style' ? 'style-attr' : 'handler', file: rel, line: lineOf(s, t.index), event: a[1] === 'style' ? null : a[1].slice(2), code: a[3] != null ? a[3] : a[4], dynamic: false, where: 'markup' });
    }
    if (/\shref\s*=\s*["']\s*javascript:/i.test(t[0])) out.push({ kind: 'js-url', file: rel, line: lineOf(s, t.index), code: t[0].slice(0, 80) });
  }
}

// Script-built HTML: string literals, templates and + chains. A template's attribute is dynamic when its value spans a ${}.
function scanJs(rel, s, out) {
  let ast;
  try { ast = acorn.parse(s, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true, locations: true }); }
  catch (e) { out.push({ kind: 'parse-error', file: rel, line: e.loc && e.loc.line, code: e.message }); return; }
  const seen = new Set();
  // Flatten a + chain into parts: { str } for literals / template quasis, { expr } otherwise.
  function parts(node) {
    if (node.type === 'BinaryExpression' && node.operator === '+') return parts(node.left).concat(parts(node.right));
    if (node.type === 'Literal' && typeof node.value === 'string') return [{ str: node.value, node }];
    if (node.type === 'TemplateLiteral') {
      const r = [];
      node.quasis.forEach((q, i) => { r.push({ str: q.value.cooked == null ? q.value.raw : q.value.cooked, node: q }); if (i < node.expressions.length) r.push({ expr: node.expressions[i] }); });
      return r;
    }
    return [{ expr: node }];
  }
  function examine(node) {
    if (seen.has(node)) return;
    const ps = parts(node);
    ps.forEach(p => { if (p.node) seen.add(p.node); });
    // Join the parts into one string with \u0000 marking a runtime value.
    const joined = ps.map(p => p.str != null ? p.str : '\u0000').join('');
    // A <style> or inline <script> inside script-built HTML is blocked as well (innerHTML / srcdoc).
    for (const t of joined.matchAll(/<(style|script)\b([^>]*)>/gi)) {
      if (t[1].toLowerCase() === 'style') out.push({ kind: 'style-block', file: rel, line: node.loc.start.line, code: joined.slice(t.index, t.index + 70).replace(/\u0000/g, '${…}') });
      else if (!/\bsrc\s*=/.test(t[2]) && !/type\s*=\s*["']?(application\/ld\+json|text\/plain|text\/css)/i.test(t[2])) out.push({ kind: 'inline-script', file: rel, line: node.loc.start.line, code: joined.slice(t.index, t.index + 70).replace(/\u0000/g, '${…}') });
    }
    if (!/(on[a-z]+|style)\s*=/.test(joined)) return;
    for (const a of joined.matchAll(/(?:^|[\s"'\\])(on[a-z]+|style)\s*=\s*(["'])/g)) {
      const start = a.index + a[0].length, q = a[2];
      let end = joined.indexOf(q, start);
      const tagBefore = joined.lastIndexOf('<', a.index), closeBefore = joined.lastIndexOf('>', a.index);
      if (tagBefore < closeBefore && closeBefore !== -1 && !/^[\s\S]*<[a-zA-Z][^>]*$/.test(joined.slice(0, a.index))) continue;   // not inside a tag
      if (end === -1) end = joined.length;
      const code = joined.slice(start, end);
      out.push({ kind: a[1] === 'style' ? 'style-attr' : 'handler', file: rel, line: node.loc.start.line, event: a[1] === 'style' ? null : a[1].slice(2), code: code.replace(/\u0000/g, '${…}'), dynamic: code.includes('\u0000'), where: 'script' });
    }
  }
  (function walk(n, parent) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee && n.callee.property && n.callee.property.name === 'setAttribute' && n.arguments[0] && n.arguments[0].type === 'Literal' && /^(on[a-z]+|style)$/i.test(String(n.arguments[0].value)))
      out.push({ kind: 'set-attr', file: rel, line: n.loc.start.line, code: s.slice(n.start, Math.min(n.end, n.start + 100)) });
    if (n.type === 'CallExpression' && n.callee && n.callee.property && n.callee.property.name === 'createElement' && n.arguments[0] && n.arguments[0].value === 'style')
      out.push({ kind: 'style-block', file: rel, line: n.loc.start.line, code: s.slice(n.start, n.end) });
    if ((n.type === 'BinaryExpression' && n.operator === '+' && !(parent && parent.type === 'BinaryExpression' && parent.operator === '+')) || n.type === 'TemplateLiteral' || (n.type === 'Literal' && typeof n.value === 'string'))
      examine(n);
    if (n.type === 'Literal' && typeof n.value === 'string' && /^\s*javascript:/i.test(n.value)) out.push({ kind: 'js-url', file: rel, line: n.loc.start.line, code: n.value.slice(0, 60) });
    for (const k in n) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(c => walk(c, n)); else if (v && typeof v.type === 'string') walk(v, n); }
  })(ast, null);
}

function scan() {
  const out = [];
  for (const rel of files()) {
    const s = fs.readFileSync(path.join(PUB, rel), 'utf8');
    if (rel.endsWith('.html')) scanHtml(rel, s, out); else scanJs(rel, s, out);
  }
  return out;
}

module.exports = { scan, files };

if (require.main === module) {
  const all = scan();
  const a = process.argv.slice(2);
  if (a[0] === '--json') { console.log(JSON.stringify(all, null, 1)); return; }
  if (a[0] === '--list') { all.filter(f => f.kind === a[1] && (a[2] !== 'dynamic' || f.dynamic)).forEach(f => console.log(`${f.file}:${f.line}  ${f.event ? 'on' + f.event + ' ' : ''}${f.dynamic ? '[dyn] ' : ''}${f.code}`)); return; }
  const by = {};
  all.forEach(f => { const k = f.kind + (f.dynamic ? ' (dynamic)' : ''); by[k] = (by[k] || 0) + 1; });
  console.log(by);
}
