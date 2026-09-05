'use strict';
/**
 * verify-projects-entity-scope.js — Projects (the other Time Tracking page) was NOT entity-scoped at all
 * (GET passed null, POST never tagged entity_id) — so every project showed on every business. Now scoped
 * null-inclusive like the rest, POST tags the active entity, and a one-time idempotent DB backfill homes
 * pre-existing orphan (NULL entity_id) projects/timesheet rows to the user's FIRST entity so they stop
 * appearing on every business and nothing is lost.
 *   node -r ./tests/harness/clock.js tests/harness/verify-projects-entity-scope.js
 */
require('./clock.js');
const fs=require('fs'); const path=require('path');
const bcrypt=require('bcryptjs');
const { startScratchPostgres }=require('./pgScratch.js');
const { bootServer }=require('./boot.js');
const { HarnessHttp }=require('./httpClient.js');
const OWNER={ email:'proj-owner@finflow.test', password:'harness-password-not-a-secret' };
(async()=>{
  let scratch,server,pass=0,fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  try{
    scratch=await startScratchPostgres({keep:false}); const c=scratch.client; server=await bootServer(scratch.url);
    const uid=(await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{email:OWNER.email,name:'P',plan:'business',role:'owner',password:bcrypt.hashSync(OWNER.password,10)}])).rows[0].id;
    const eidA=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'A Co',currency:'USD',is_active:1}])).rows[0].id;
    const eidB=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'B Co',currency:'USD',is_active:0}])).rows[0].id;
    const mk=async(ent,name)=>c.query(`INSERT INTO projects (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,[uid,ent,{name,client:'X',budget:100,status:'In Progress'}]);
    await mk(eidA,'A-proj'); await mk(eidB,'B-proj');

    const http=new HarnessHttp(server.baseUrl);
    A('login 200',(await http.post('/api/auth/login',OWNER)).status===200);
    const list=await http.get('/api/projects');
    const names=(list.json||[]).map(t=>t.name);
    A('active entity A sees its own project', names.includes('A-proj'), JSON.stringify(names));
    A('other business B project does NOT leak in', !names.includes('B-proj'), JSON.stringify(names));
    const created=await http.post('/api/projects',{name:'NEW-under-A',client:'X',budget:50});
    A('POST created (201)', created.status===201, 'status='+created.status);
    const row=(await c.query(`SELECT entity_id FROM projects WHERE data->>'name'=$1`,['NEW-under-A'])).rows[0];
    A('new project tags to the active entity (A)', row && row.entity_id===eidA, JSON.stringify(row));

    // BACKFILL: an orphan NULL-entity project must be homed to the user's FIRST (min id) entity, not leak
    await c.query(`INSERT INTO projects (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,[uid,{name:'ORPHAN',client:'X',budget:10,status:'In Progress'}]);
    await c.query(`UPDATE projects p SET entity_id = (SELECT MIN(e.id) FROM entities e WHERE e.user_id = p.user_id)
                    WHERE p.entity_id IS NULL AND EXISTS (SELECT 1 FROM entities e2 WHERE e2.user_id = p.user_id)`);
    const orphan=(await c.query(`SELECT entity_id FROM projects WHERE data->>'name'=$1`,['ORPHAN'])).rows[0];
    A('orphan NULL project homed to FIRST entity (A), not left leaking', orphan && orphan.entity_id===eidA, JSON.stringify(orphan));

    // STRUCTURAL: the DB init carries the idempotent backfill for BOTH projects and timesheet
    const dbjs=fs.readFileSync(path.join(__dirname,'..','..','database.js'),'utf8');
    A('[STRUCTURAL] database.js backfills orphan projects to MIN entity', /UPDATE projects p SET entity_id[\s\S]*?MIN\(e\.id\)[\s\S]*?IS NULL/.test(dbjs));
    A('[STRUCTURAL] database.js backfills orphan timesheet to MIN entity', /UPDATE timesheet t SET entity_id[\s\S]*?MIN\(e\.id\)[\s\S]*?IS NULL/.test(dbjs));
    // STRUCTURAL: switchEntity refetches projects on switch
    const ix=fs.readFileSync(path.join(__dirname,'..','..','public','index.html'),'utf8');
    const seBody=ix.slice(ix.indexOf('window.switchEntity=async function'), ix.indexOf('window.switchEntity=async function')+6000);
    A('[STRUCTURAL] switchEntity refetches projects (_loadProjectsFromDB)', /_loadProjectsFromDB/.test(seBody));

    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (projects entity-scoped + backfill)\n`);
  }catch(e){ console.error('\n  FATAL:',e&&e.stack||e); fail++; }
  finally{ try{if(server)await server.close();}catch{} try{if(scratch)await scratch.stop();}catch{} }
  process.exitCode=fail===0?0:1;
})();
