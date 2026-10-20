'use strict';
/**
 * fix3-enumerate-audited-routes.js — READ-ONLY enumeration aid (FIX-3 / LC3b). Lists every mutating route
 * (app/router .post/.put/.patch/.delete) in the given files and whether its handler body calls an audit writer
 * (recordAudit / auditLog / logAudit / _audit* / adminAudit — or, LC3e, the connection write path `_saveProviderBlobE` /
 * `_mutatePlaidItemsE` / `_mutateSettingsBlob` called WITH `req` as its last argument, which records any change of connection
 * state; called without `req` it records only with no actor, so it does not count). A TEXT HEURISTIC — a handler that audits inside a helper it calls
 * reads as "not audited" — so every entry it reports was confirmed by reading before it was classified.
 * Importable (the FIX-3b guard harness uses `enumerate`); run directly it prints a TSV.
 *   node tools/fix-2026-10-19/fix3-enumerate-audited-routes.js server.js accountant-routes.js admin-routes.js
 */
const fs = require('fs');
// LC3e: does `src` call the connection write path with `req` as the final argument? Finds each call's closing paren by
// counting parens, skipping strings, template literals and comments (a `)` inside a comment once broke a counter here).
function callsWritePathWithReq(src) {
  const re = /\b(_saveProviderBlobE|_mutatePlaidItemsE|_mutateSettingsBlob)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1, q = null;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i], nx = src[i + 1];
      if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
      if (ch === '/' && nx === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
      if (ch === '/' && nx === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '(') depth++; else if (ch === ')') depth--;
    }
    if (depth === 0 && /,\s*req\s*$/.test(src.slice(start, i - 1))) return true;
  }
  return false;
}
function enumerate(files) {
  const out = [];
  for (const f of files) {
    const L = fs.readFileSync(f, 'utf8').split('\n');
    const starts = [];
    L.forEach((l, i) => { const m = l.match(/^\s*(app|router)\.(post|put|patch|delete)\(\s*['"`]([^'"`]+)/); if (m) starts.push({ i, method: m[2].toUpperCase(), path: m[3] }); });
    starts.forEach((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1].i : Math.min(L.length, s.i + 400);
      const body = [];
      for (let j = s.i; j < end; j++) { if (j > s.i && /^\s*(app|router)\.(get|use)\(|^(async )?function |^const |^\/\/ ── /.test(L[j])) break; body.push(L[j]); }
      const src = body.join('\n');
      out.push({ audited: /recordAudit|auditLog\(|logAudit\(|_audit\w*\(|adminAudit\(/.test(src) || callsWritePathWithReq(src), file: f, line: s.i + 1, method: s.method, path: s.path });
    });
  }
  return out;
}
// LC3e-b: a GET that WRITES (an OAuth callback stores the connection) is invisible to `enumerate`, which lists only
// post/put/patch/delete. Same body rule; a handler counts as writing when it calls a db write helper, raw INSERT /
// UPDATE / DELETE SQL, or the connection write path.
const _WRITES = /_saveProviderBlobE\(|_mutateSettingsBlob\(|_mutatePlaidItemsE\(|db\.(insert|updateById|deleteById)\(|INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM/;
function getWriters(files) {
  const out = [];
  for (const f of files) {
    const L = fs.readFileSync(f, 'utf8').split('\n');
    const starts = [];
    L.forEach((l, i) => { const m = l.match(/^\s*(app|router)\.(get|post|put|patch|delete|use)\(\s*['"`]([^'"`]+)/); if (m) starts.push({ i, method: m[2].toUpperCase(), path: m[3] }); });
    starts.forEach((s, k) => {
      if (s.method !== 'GET') return;
      const end = k + 1 < starts.length ? starts[k + 1].i : Math.min(L.length, s.i + 400);
      const body = [];
      for (let j = s.i; j < end; j++) { if (j > s.i && /^(async )?function |^const |^\/\/ ── /.test(L[j])) break; body.push(L[j]); }
      const src = body.join('\n');
      if (!_WRITES.test(src)) return;
      out.push({ audited: /recordAudit|auditLog\(|logAudit\(|_audit\w*\(|adminAudit\(/.test(src) || callsWritePathWithReq(src), file: f, line: s.i + 1, method: 'GET', path: s.path });
    });
  }
  return out;
}
module.exports = { enumerate, callsWritePathWithReq, getWriters };
if (require.main === module) {
  for (const r of enumerate(process.argv.slice(2))) console.log([r.audited ? 'AUDIT' : '-----', r.file + ':' + r.line, r.method, r.path].join('\t'));
}
