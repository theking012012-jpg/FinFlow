'use strict';
/**
 * fix3-enumerate-audited-routes.js — READ-ONLY enumeration aid (FIX-3 / LC3b). Lists every mutating route
 * (app/router .post/.put/.patch/.delete) in the given files and whether its handler body calls an audit writer
 * (recordAudit / auditLog / logAudit / _audit*). A TEXT HEURISTIC — a handler that audits inside a helper it calls
 * reads as "not audited" — so every entry it reports was confirmed by reading before it was classified.
 * Importable (the FIX-3b guard harness uses `enumerate`); run directly it prints a TSV.
 *   node tools/fix-2026-10-19/fix3-enumerate-audited-routes.js server.js accountant-routes.js admin-routes.js
 */
const fs = require('fs');
function enumerate(files) {
  const out = [];
  for (const f of files) {
    const L = fs.readFileSync(f, 'utf8').split('\n');
    const starts = [];
    L.forEach((l, i) => { const m = l.match(/^\s*(app|router)\.(post|put|patch|delete)\(\s*['"`]([^'"`]+)/); if (m) starts.push({ i, method: m[2].toUpperCase(), path: m[3] }); });
    starts.forEach((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1].i : Math.min(L.length, s.i + 400);
      const body = [];
      for (let j = s.i; j < end; j++) { if (j > s.i && /^(app|router)\.(get|use)\(|^(async )?function |^const |^\/\/ ── /.test(L[j])) break; body.push(L[j]); }
      out.push({ audited: /recordAudit|auditLog\(|logAudit\(|_audit\w*\(/.test(body.join('\n')), file: f, line: s.i + 1, method: s.method, path: s.path });
    });
  }
  return out;
}
module.exports = { enumerate };
if (require.main === module) {
  for (const r of enumerate(process.argv.slice(2))) console.log([r.audited ? 'AUDIT' : '-----', r.file + ':' + r.line, r.method, r.path].join('\t'));
}
