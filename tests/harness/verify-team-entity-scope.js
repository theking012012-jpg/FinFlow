'use strict';
/**
 * verify-team-entity-scope.js — per-entity team access. A member granted only business A can see/act on
 * A, is refused B (403), and the entity switcher (GET /api/entities) shows only A. A member with NO
 * entity_access grant (legacy/backward-compat) sees ALL businesses. The owner always sees all.
 *   node -r ./tests/harness/clock.js tests/harness/verify-team-entity-scope.js
 */
require('./clock.js');
const bcrypt=require('bcryptjs');
const { startScratchPostgres }=require('./pgScratch.js');
const { bootServer }=require('./boot.js');
const { HarnessHttp }=require('./httpClient.js');
const OWNER ={ email:'team-owner@finflow.test',  password:'harness-password-not-a-secret' };
const MEMBER={ email:'team-member@finflow.test', password:'harness-password-not-a-secret' };
const MEMBALL={ email:'team-allaccess@finflow.test', password:'harness-password-not-a-secret' };
(async()=>{
  let scratch,server,pass=0,fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  const mkUser=async(c,cr)=>(await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
    [{email:cr.email,name:'U',plan:'business',role:'owner',password:bcrypt.hashSync(cr.password,10)}])).rows[0].id;
  try{
    scratch=await startScratchPostgres({keep:false}); const c=scratch.client; server=await bootServer(scratch.url);
    const ownerId=await mkUser(c,OWNER);
    const eidA=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[ownerId,{name:'A Co',currency:'USD',is_active:1}])).rows[0].id;
    const eidB=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[ownerId,{name:'B Co',currency:'USD',is_active:0}])).rows[0].id;
    const memberId=await mkUser(c,MEMBER);
    const memberAllId=await mkUser(c,MEMBALL);
    // membership: member granted ONLY business A
    await c.query(`INSERT INTO team_members (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerId,{member_user_id:String(memberId),email:MEMBER.email,name:'Member A',role:'admin',status:'active',entity_access:[eidA]}]);
    // membership: all-access member — NO entity_access field (legacy/backward-compat = ALL)
    await c.query(`INSERT INTO team_members (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [ownerId,{member_user_id:String(memberAllId),email:MEMBALL.email,name:'Member All',role:'admin',status:'active'}]);

    const hM=new HarnessHttp(server.baseUrl);
    A('member login 200',(await hM.post('/api/auth/login',MEMBER)).status===200);
    const ents=await hM.get('/api/entities');
    const names=(ents.json||[]).map(e=>e.name);
    A('member sees business A in the switcher', names.includes('A Co'), JSON.stringify(names));
    A('member does NOT see business B', !names.includes('B Co'), JSON.stringify(names));
    A('member reading GRANTED entity A is allowed (200)', (await hM.get('/api/invoices?entity_id='+eidA)).status===200);
    const denied=await hM.get('/api/invoices?entity_id='+eidB);
    A('member reading NON-granted entity B is refused (403)', denied.status===403, 'status '+denied.status);

    const hA=new HarnessHttp(server.baseUrl);
    A('all-access member login 200',(await hA.post('/api/auth/login',MEMBALL)).status===200);
    const entsAll=(await hA.get('/api/entities')).json||[];
    A('member with no entity_access sees ALL businesses (backward-compat)', entsAll.some(e=>e.name==='A Co')&&entsAll.some(e=>e.name==='B Co'), JSON.stringify(entsAll.map(e=>e.name)));

    const hO=new HarnessHttp(server.baseUrl);
    A('owner login 200',(await hO.post('/api/auth/login',OWNER)).status===200);
    const entsO=(await hO.get('/api/entities')).json||[];
    A('owner sees all businesses', entsO.some(e=>e.name==='A Co')&&entsO.some(e=>e.name==='B Co'), JSON.stringify(entsO.map(e=>e.name)));
    A('owner reading business B is allowed (not gated)', (await hO.get('/api/invoices?entity_id='+eidB)).status===200);

    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (team per-entity access)\n`);
  }catch(e){ console.error('\n  FATAL:',e&&e.stack||e); fail++; }
  finally{ try{if(server)await server.close();}catch{} try{if(scratch)await scratch.stop();}catch{} }
  process.exitCode=fail===0?0:1;
})();
