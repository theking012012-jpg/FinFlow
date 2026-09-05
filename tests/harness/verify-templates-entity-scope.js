'use strict';
/**
 * verify-templates-entity-scope.js — templates were account-level (shown on every business). Now entity-
 * scoped, null-inclusive: a template created under business A shows only on A; legacy untagged templates
 * (entity_id NULL) still show everywhere so nothing is lost. New templates tag to the active entity.
 *   node -r ./tests/harness/clock.js tests/harness/verify-templates-entity-scope.js
 */
require('./clock.js');
const bcrypt=require('bcryptjs');
const { startScratchPostgres }=require('./pgScratch.js');
const { bootServer }=require('./boot.js');
const { HarnessHttp }=require('./httpClient.js');
const OWNER={ email:'tmpl-owner@finflow.test', password:'harness-password-not-a-secret' };
(async()=>{
  let scratch,server,pass=0,fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  try{
    scratch=await startScratchPostgres({keep:false}); const c=scratch.client; server=await bootServer(scratch.url);
    const uid=(await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{email:OWNER.email,name:'T',plan:'business',role:'owner',password:bcrypt.hashSync(OWNER.password,10)}])).rows[0].id;
    const eidA=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'A Co',currency:'USD',is_active:1}])).rows[0].id;
    const eidB=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'B Co',currency:'USD',is_active:0}])).rows[0].id;
    // seed: one template for A, one for B, one legacy (null entity)
    const mk=async(ent,name)=>c.query(`INSERT INTO templates (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,[uid,ent,{name,type:'invoice'}]);
    await mk(eidA,'A-template'); await mk(eidB,'B-template'); await mk(null,'LEGACY-template');

    const http=new HarnessHttp(server.baseUrl);
    A('login 200',(await http.post('/api/auth/login',OWNER)).status===200);
    const list=await http.get('/api/templates');
    const names=(list.json||[]).map(t=>t.name);
    A('active entity A sees its own template', names.includes('A-template'));
    A('legacy (untagged) template still shows — nothing lost', names.includes('LEGACY-template'));
    A('other business B template does NOT leak in', !names.includes('B-template'), JSON.stringify(names));
    // a NEW template created now tags to the active entity (A)
    const created=await http.post('/api/templates',{name:'NEW-under-A',type:'invoice'});
    const row=(await c.query(`SELECT entity_id FROM templates WHERE data->>'name'=$1`,['NEW-under-A'])).rows[0];
    A('new template tags to the active entity (A)', row && row.entity_id===eidA, JSON.stringify(row));
    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (templates entity-scoped)\n`);
  }catch(e){ console.error('\n  FATAL:',e&&e.stack||e); fail++; }
  finally{ try{if(server)await server.close();}catch{} try{if(scratch)await scratch.stop();}catch{} }
  process.exitCode=fail===0?0:1;
})();
