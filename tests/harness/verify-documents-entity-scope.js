'use strict';
/**
 * verify-documents-entity-scope.js — documents were account-level (every business saw every file).
 * Now entity-scoped, null-inclusive: a document uploaded under business A shows only on A; legacy
 * untagged documents (entity_id NULL) still show everywhere so nothing is lost. A new upload tags to
 * the active entity.
 *   node -r ./tests/harness/clock.js tests/harness/verify-documents-entity-scope.js
 */
require('./clock.js');
const bcrypt=require('bcryptjs');
const { startScratchPostgres }=require('./pgScratch.js');
const { bootServer }=require('./boot.js');
const { HarnessHttp }=require('./httpClient.js');
const OWNER={ email:'docs-owner@finflow.test', password:'harness-password-not-a-secret' };
(async()=>{
  let scratch,server,pass=0,fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  try{
    scratch=await startScratchPostgres({keep:false}); const c=scratch.client; server=await bootServer(scratch.url);
    const uid=(await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{email:OWNER.email,name:'D',plan:'business',role:'owner',password:bcrypt.hashSync(OWNER.password,10)}])).rows[0].id;
    const eidA=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'A Co',currency:'USD',is_active:1}])).rows[0].id;
    const eidB=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'B Co',currency:'USD',is_active:0}])).rows[0].id;
    // seed: one doc for A, one for B, one legacy (null entity)
    const mk=async(ent,name)=>c.query(`INSERT INTO documents (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid,ent,{name,type:'invoice',size:'1 KB',media_type:'application/pdf',uploaded_at:new Date().toISOString()}]);
    await mk(eidA,'A-doc.pdf'); await mk(eidB,'B-doc.pdf'); await mk(null,'LEGACY-doc.pdf');

    const http=new HarnessHttp(server.baseUrl);
    A('login 200',(await http.post('/api/auth/login',OWNER)).status===200);
    const list=await http.get('/api/documents');
    const names=(list.json||[]).map(t=>t.name);
    A('active entity A sees its own document', names.includes('A-doc.pdf'), JSON.stringify(names));
    A('legacy (untagged) document still shows — nothing lost', names.includes('LEGACY-doc.pdf'), JSON.stringify(names));
    A('other business B document does NOT leak in', !names.includes('B-doc.pdf'), JSON.stringify(names));
    // list responses must never carry the base64 blob
    A('list strips file_data', (list.json||[]).every(d=>d.file_data===undefined));
    // a NEW upload created now tags to the active entity (A)
    const created=await http.post('/api/documents',{name:'NEW-under-A.pdf',type:'report',file_data:'QUJDRA==',media_type:'application/pdf'});
    A('upload 201', created.status===201, JSON.stringify(created.json));
    const row=(await c.query(`SELECT entity_id FROM documents WHERE data->>'name'=$1`,['NEW-under-A.pdf'])).rows[0];
    A('new document tags to the active entity (A)', row && row.entity_id===eidA, JSON.stringify(row));
    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (documents entity-scoped)\n`);
  }catch(e){ console.error('\n  FATAL:',e&&e.stack||e); fail++; }
  finally{ try{if(server)await server.close();}catch{} try{if(scratch)await scratch.stop();}catch{} }
  process.exitCode=fail===0?0:1;
})();
