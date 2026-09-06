'use strict';
/**
 * verify-lock-entity-scope.js — the books-lock was account-wide (lock_settings keyed on user_id only,
 * isLocked ignored entity), so locking one business locked ALL of them, and Personal too by extension.
 * Now per-entity: a lock saved under business A blocks only A's periods; business B stays editable;
 * the lock is date-bounded (a period after the lock date is still open); and Personal (entity_id NULL,
 * never lock-guarded) is unaffected.
 *   node -r ./tests/harness/clock.js tests/harness/verify-lock-entity-scope.js
 */
require('./clock.js');
const bcrypt=require('bcryptjs');
const { startScratchPostgres }=require('./pgScratch.js');
const { bootServer }=require('./boot.js');
const { HarnessHttp }=require('./httpClient.js');
const OWNER={ email:'lock-owner@finflow.test', password:'harness-password-not-a-secret' };
(async()=>{
  let scratch,server,pass=0,fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  try{
    scratch=await startScratchPostgres({keep:false}); const c=scratch.client; server=await bootServer(scratch.url);
    const uid=(await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{email:OWNER.email,name:'L',plan:'business',role:'owner',password:bcrypt.hashSync(OWNER.password,10)}])).rows[0].id;
    const eidA=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'A Co',currency:'USD',is_active:1}])).rows[0].id;
    const eidB=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'B Co',currency:'USD',is_active:0}])).rows[0].id;

    const http=new HarnessHttp(server.baseUrl);
    A('login 200',(await http.post('/api/auth/login',OWNER)).status===200);

    // lock business A's books through 2026-06-30 (entity_id carried in the body -> req.entityId = A)
    const saved=await http.post('/api/lock-settings',{enabled:1,lock_date:'2026-06-30',entity_id:eidA});
    A('lock saved', saved.status===200, JSON.stringify(saved.json));
    const lockRow=(await c.query(`SELECT entity_id FROM lock_settings WHERE user_id=$1`,[uid])).rows[0];
    A('lock row is tagged to business A (per-entity, not account-wide)', lockRow && lockRow.entity_id===eidA, JSON.stringify(lockRow));

    // A, inside the locked period -> blocked
    const aLocked=await http.post('/api/expenses',{entity_id:eidA,description:'A locked-period exp',amount:11,expense_date:'2026-05-15'});
    A('business A: expense in the locked period is BLOCKED (403)', aLocked.status===403, 'status '+aLocked.status);
    // A, after the lock date -> still open (lock is date-bounded, not blanket)
    const aOpen=await http.post('/api/expenses',{entity_id:eidA,description:'A open-period exp',amount:12,expense_date:'2026-07-15'});
    A('business A: expense AFTER the lock date is allowed (date-bounded)', aOpen.status===201, 'status '+aOpen.status);
    // B, same locked-period date -> NOT locked (B has no lock of its own)
    const bOpen=await http.post('/api/expenses',{entity_id:eidB,description:'B same-period exp',amount:13,expense_date:'2026-05-15'});
    A('business B: same-period expense is allowed — the A lock does not leak', bOpen.status===201, 'status '+bOpen.status);
    // Personal (entity_id NULL, never lock-guarded) -> allowed even in the locked period
    const pers=await http.post('/api/personal-transactions',{description:'personal locked-period tx',amount:14,tx_date:'2026-05-15'});
    A('Personal: transaction in the locked period is allowed (Personal stays separate)', pers.status===201, 'status '+pers.status);

    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (books-lock per-entity)\n`);
  }catch(e){ console.error('\n  FATAL:',e&&e.stack||e); fail++; }
  finally{ try{if(server)await server.close();}catch{} try{if(scratch)await scratch.stop();}catch{} }
  process.exitCode=fail===0?0:1;
})();
