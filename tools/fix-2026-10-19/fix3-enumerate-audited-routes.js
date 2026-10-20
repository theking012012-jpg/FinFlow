// Enumeration aid (text heuristic — every hit confirmed by reading): mutating routes and whether the handler body calls an audit writer.
const fs=require('fs');
for (const f of process.argv.slice(2)) {
  const L=fs.readFileSync(f,'utf8').split('\n');
  const starts=[]; L.forEach((l,i)=>{const m=l.match(/^\s*(app|router)\.(post|put|patch|delete)\(\s*['"`]([^'"`]+)/); if(m) starts.push({i,method:m[2].toUpperCase(),path:m[3]});});
  starts.forEach((s,k)=>{const end=k+1<starts.length?starts[k+1].i:Math.min(L.length,s.i+400);
    // stop at next top-level route/function
    let body=[]; for(let j=s.i;j<end;j++){ if(j>s.i && /^(app|router)\.(get|use)\(|^(async )?function |^const |^\/\/ ── /.test(L[j])) break; body.push(L[j]); }
    const b=body.join('\n'); const aud=/recordAudit|auditLog\(|logAudit\(|_audit\w*\(/.test(b);
    console.log([aud?'AUDIT':'-----',f+':'+(s.i+1),s.method,s.path].join('\t'));});
}
