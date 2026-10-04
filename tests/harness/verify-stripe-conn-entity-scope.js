'use strict';
/**
 * verify-stripe-conn-entity-scope.js — per-scope Stripe connections. Each business links its OWN Stripe
 * account: business A's connection shows only on A, B's only on B (no cross-entity bleed). FULL
 * INDEPENDENCE: a business with no connection of its own is NOT connected — it never falls back to the
 * personal/account-level (entity_id NULL) connection. The personal (NULL) scope keeps its own connection,
 * reachable via ?entity_id=all, independent of every business.
 *   node -r ./tests/harness/clock.js tests/harness/verify-stripe-conn-entity-scope.js
 */
require('./clock.js');
const bcrypt=require('bcryptjs');
const { startScratchPostgres }=require('./pgScratch.js');
const { bootServer }=require('./boot.js');
const { HarnessHttp }=require('./httpClient.js');
const OWNER={ email:'sconn-owner@finflow.test', password:'harness-password-not-a-secret' };
(async()=>{
  let scratch,server,pass=0,fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  const seedConn=(c,uid,eid,acct)=>c.query(
    `INSERT INTO user_settings (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
    [uid,eid,{key:'stripe_conn',value:JSON.stringify({stripe_user_id:acct,linked_at:new Date().toISOString(),books:{scope:'business',entity_id:eid}})}]);
  try{
    scratch=await startScratchPostgres({keep:false}); const c=scratch.client; server=await bootServer(scratch.url);
    const uid=(await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{email:OWNER.email,name:'S',plan:'business',role:'owner',password:bcrypt.hashSync(OWNER.password,10)}])).rows[0].id;
    const eidA=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'A Co',currency:'USD',is_active:1}])).rows[0].id;
    const eidB=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'B Co',currency:'USD',is_active:0}])).rows[0].id;
    const eidC=(await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,[uid,{name:'C Co',currency:'USD',is_active:0}])).rows[0].id;
    await seedConn(c,uid,eidA,'acct_A');
    await seedConn(c,uid,eidB,'acct_B');
    await c.query(`INSERT INTO user_settings (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid,{key:'stripe_conn',value:JSON.stringify({stripe_user_id:'acct_LEGACY',linked_at:new Date().toISOString()})}]);

    const http=new HarnessHttp(server.baseUrl);
    A('login 200',(await http.post('/api/auth/login',OWNER)).status===200);
    const status=async eid=>(await http.get('/api/stripe/status?entity_id='+eid)).json||{};
    const sA=await status(eidA), sB=await status(eidB), sC=await status(eidC), sP=await status('all');
    A('business A sees its OWN Stripe account', sA.account==='acct_A', JSON.stringify(sA));
    A('business B sees its OWN Stripe account', sB.account==='acct_B', JSON.stringify(sB));
    A('A does NOT see B\'s Stripe account (no cross-entity bleed)', sA.account!=='acct_B');
    A('[DISCRIMINATING] business C (no own link) is NOT connected — no fallback to personal/legacy', sC.connected===false && !sC.account, JSON.stringify(sC));
    A('personal (entity_id NULL, via ?entity_id=all) keeps its OWN connection, independent', sP.account==='acct_LEGACY', JSON.stringify(sP));
    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (Stripe connection per-entity)\n`);
  }catch(e){ console.error('\n  FATAL:',e&&e.stack||e); fail++; }
  finally{ try{if(server)await server.close();}catch{} try{if(scratch)await scratch.stop();}catch{} }
  process.exitCode=fail===0?0:1;
})();
