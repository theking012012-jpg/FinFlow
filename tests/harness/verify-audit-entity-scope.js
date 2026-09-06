'use strict';
/**
 * verify-audit-entity-scope.js — the Audit trail page fetches /api/audit-log, which read the DEAD
 * audit_log table (zero writers since the F90 unification); the real, append-only trail is audit_trail.
 * This proves (1) /api/audit-log now reads audit_trail (the repoint — events actually show), and (2) it
 * is entity-scoped null-inclusive: an event under business A shows only on A; an account-level event
 * with no entity (entity_id NULL) shows everywhere; business B's events don't leak; and a row in the
 * dead audit_log never resurfaces.
 *   node -r ./tests/harness/clock.js tests/harness/verify-audit-entity-scope.js
 */
require('./clock.js');
const bcrypt=require('bcryptjs');
const { startScratchPostgres }=require('./pgScratch.js');
const { bootServer }=require('./boot.js');
const { HarnessHttp }=require('./httpClient.js');
const OWNER={ email:'audit-owner@finflow.test', password:'harness-password-not-a-secret' };
(async()=>{
  let scratch,server,pass=0,fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  try{
    scratch=await startScratchPostgres({keep:false}); const c=scratch.client; server=await bootServer(scratch.url);
    const uid=(await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{email:OWNER.email,name:'A',plan:'business',role:'owner',password:bcrypt.hashSync(OWNER.password,10)}])).rows[0].id;
    const eidA=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'A Co',currency:'USD',is_active:1}])).rows[0].id;
    const eidB=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'B Co',currency:'USD',is_active:0}])).rows[0].id;
    // seed the REAL trail (audit_trail): A event, B event, account-level event (no entity)
    const mkT=(ent,tbl,marker)=>c.query(
      `INSERT INTO audit_trail (user_id,entity_id,table_name,record_id,action,actor_type,actor_id,new_data) VALUES ($1,$2,$3,1,'CREATE','user',$1,$4)`,
      [uid,ent,tbl,{marker}]);
    await mkT(eidA,'invoices','A-evt');
    await mkT(eidB,'invoices','B-evt');
    await mkT(null,'lock_settings','ACCT-evt');
    // account-level allowlist: an `entities` event tagged to business B must still show while A is active
    await mkT(eidB,'entities','ENT-B-evt');
    // seed the DEAD table (audit_log) — must never resurface
    await c.query(`INSERT INTO audit_log (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid,eidA,{table_name:'expenses',action:'CREATE',new_data:{marker:'DEAD-evt'}}]);

    const http=new HarnessHttp(server.baseUrl);
    A('login 200',(await http.post('/api/auth/login',OWNER)).status===200);
    const resp=await http.get('/api/audit-log?limit=500');
    const rows=(resp.json&&resp.json.rows)||(Array.isArray(resp.json)?resp.json:[]);
    const has=m=>rows.some(r=>{ const nd=typeof r.new_data==='string'?JSON.parse(r.new_data||'{}'):(r.new_data||{}); return nd&&nd.marker===m; });
    A('endpoint returns audit_trail data (repoint off the dead table)', rows.length>0, 'rows='+rows.length);
    A('active entity A event shows', has('A-evt'), JSON.stringify(rows.map(r=>r.table_name)));
    A('account-level event (no entity) shows everywhere', has('ACCT-evt'));
    A('other business B money event does NOT leak in', !has('B-evt'));
    A('account-level event (entities) shows on every business — allowlist', has('ENT-B-evt'), JSON.stringify(rows.map(r=>r.table_name)));
    A('dead audit_log row never resurfaces', !has('DEAD-evt'));
    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (audit trail repointed + entity-scoped)\n`);
  }catch(e){ console.error('\n  FATAL:',e&&e.stack||e); fail++; }
  finally{ try{if(server)await server.close();}catch{} try{if(scratch)await scratch.stop();}catch{} }
  process.exitCode=fail===0?0:1;
})();
