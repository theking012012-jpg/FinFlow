'use strict';
/**
 * verify-timesheet-entity-scope.js — Time Tracking (timesheet) was account-level (shown on every
 * business). Now entity-scoped, null-inclusive: an entry created under business A shows only on A;
 * legacy untagged entries (entity_id NULL) still show everywhere so nothing is lost. New entries tag
 * to the active entity. Plus a structural check that switchEntity REFETCHES timesheet on switch —
 * renderTimesheet paints from an in-memory cache, so without the refetch the server scoping would
 * still leave the previous entity's rows on screen.
 *   node -r ./tests/harness/clock.js tests/harness/verify-timesheet-entity-scope.js
 */
require('./clock.js');
const fs=require('fs'); const path=require('path');
const bcrypt=require('bcryptjs');
const { startScratchPostgres }=require('./pgScratch.js');
const { bootServer }=require('./boot.js');
const { HarnessHttp }=require('./httpClient.js');
const OWNER={ email:'ts-owner@finflow.test', password:'harness-password-not-a-secret' };
(async()=>{
  let scratch,server,pass=0,fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  try{
    scratch=await startScratchPostgres({keep:false}); const c=scratch.client; server=await bootServer(scratch.url);
    const uid=(await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{email:OWNER.email,name:'T',plan:'business',role:'owner',password:bcrypt.hashSync(OWNER.password,10)}])).rows[0].id;
    const eidA=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'A Co',currency:'USD',is_active:1}])).rows[0].id;
    const eidB=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'B Co',currency:'USD',is_active:0}])).rows[0].id;
    const mk=async(ent,employee)=>c.query(`INSERT INTO timesheet (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,[uid,ent,{employee,project:'P',date:'2026-07-20',hours:5,billable:'Yes',rate:50}]);
    await mk(eidA,'A-emp'); await mk(eidB,'B-emp'); await mk(null,'LEGACY-emp');

    const http=new HarnessHttp(server.baseUrl);
    A('login 200',(await http.post('/api/auth/login',OWNER)).status===200);
    const list=await http.get('/api/timesheet');
    const names=(list.json||[]).map(t=>t.employee);
    A('active entity A sees its own entry', names.includes('A-emp'), JSON.stringify(names));
    A('legacy (untagged) entry still shows — nothing lost', names.includes('LEGACY-emp'));
    A('other business B entry does NOT leak in', !names.includes('B-emp'), JSON.stringify(names));
    // a NEW entry created now tags to the active entity (A)
    const created=await http.post('/api/timesheet',{employee:'NEW-under-A',project:'P',hours:3,billable:'Yes',rate:40});
    A('POST created (201)', created.status===201, 'status='+created.status);
    const row=(await c.query(`SELECT entity_id FROM timesheet WHERE data->>'employee'=$1`,['NEW-under-A'])).rows[0];
    A('new entry tags to the active entity (A)', row && row.entity_id===eidA, JSON.stringify(row));

    // STRUCTURAL: switchEntity must refetch timesheet on switch (cache would otherwise stay stale)
    const ix=fs.readFileSync(path.join(__dirname,'..','..','public','index.html'),'utf8');
    const seBody=ix.slice(ix.indexOf('window.switchEntity=async function'), ix.indexOf('window.switchEntity=async function')+6000);
    A('[STRUCTURAL] switchEntity reload set refetches timesheet (_loadTimesheetFromDB)', /_loadTimesheetFromDB/.test(seBody), 'not found in switchEntity body');

    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (timesheet entity-scoped)\n`);
  }catch(e){ console.error('\n  FATAL:',e&&e.stack||e); fail++; }
  finally{ try{if(server)await server.close();}catch{} try{if(scratch)await scratch.stop();}catch{} }
  process.exitCode=fail===0?0:1;
})();
