'use strict';
/**
 * verify-stripe-feed-entity-gate.js — the Stripe live feed books to ONE entity; it must NOT render its
 * charges/in-books status on OTHER entities' dashboards (cross-entity display leak). Boots the SPA in
 * jsdom, mocks the feed with books.entity_id != active entity, and asserts the feed shows the "books to
 * <X>" note instead of the charges. Discriminating: without the gate the charge + "in books" render on
 * every entity. Also structurally verifies switchEntity clears the money-flow river (stale-currency fix).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-stripe-feed-entity-gate.js
 */
const fs=require('fs'), path=require('path');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

(async () => {
  let boot, pass=0, fail=0;
  const A=(n,ok,d)=>{ ok?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'\n          '+d:''))); };
  const AS=(n,ok,d)=>A('[STRUCTURAL] '+n,ok,d);
  try {
    boot = await bootSpaInJsdom({});
    const { window, settle } = boot;
    for (let i=0;i<250 && typeof window.startStripeFeed!=='function';i++) await settle(1,100);
    await settle(6,100);
    A('startStripeFeed present', typeof window.startStripeFeed==='function');

    // Two entities: active = 1, the Stripe account is bound to 99.
    window.ENTITIES = [{ _dbId:1, name:'Active Co', currency:'USD', active:true }, { _dbId:99, name:'Bound Co', currency:'USD', active:false }];
    const feedResp = (boundEntity) => ({ configured:true, connected:true, account:'acct_x', total:2000, livemode:false,
      books:{ scope:'business', entity_id:boundEntity },
      charges:[{ id:'ch_gate1', amount:2000, currency:'USD', status:'succeeded', paid:true, refunded:false, description:'gated charge', inBooks:true }] });

    // CASE 1 — bound to 99, active is 1 → feed must NOT show the charge, shows the "books to" note.
    window.fetch = async (u)=> /\/api\/stripe\/feed/.test(String(u)) ? { ok:true, status:200, json:async()=>feedResp(99) } : { ok:true, status:200, json:async()=>({}) };
    await window.startStripeFeed(); await settle(4,60);
    const feedHtml1 = (window.document.getElementById('stripe-feed')||{}).innerHTML || '';
    A('on a non-bound entity: charge + in-books are NOT shown', !/2,000/.test(feedHtml1) && !/in books/.test(feedHtml1), feedHtml1.slice(0,160));
    A('on a non-bound entity: shows "books to Bound Co" note', /books to/i.test(feedHtml1) && /Bound Co/.test(feedHtml1), feedHtml1.slice(0,160));

    // CASE 2 — bound to 1, active is 1 → feed DOES show the charge.
    window.fetch = async (u)=> /\/api\/stripe\/feed/.test(String(u)) ? { ok:true, status:200, json:async()=>feedResp(1) } : { ok:true, status:200, json:async()=>({}) };
    await window.startStripeFeed(); await settle(4,60);
    const feedHtml2 = (window.document.getElementById('stripe-feed')||{}).innerHTML || '';
    A('on the bound entity: the charge renders normally', /2,000/.test(feedHtml2) && /in books/.test(feedHtml2), feedHtml2.slice(0,160));

    // STRUCTURAL — switchEntity clears the money-flow river so stale currency/data can't linger.
    const html = fs.readFileSync(path.join(process.cwd(),'public','index.html'),'utf8');
    AS('switchEntity clears the money-flow river (river-wrap) on switch', /switchEntity=async function[\s\S]*?river-wrap[\s\S]*?Loading/.test(html));
    AS('feed gate keys off books.entity_id vs the active entity', /_stripeBooksEntity/.test(html) && /d\.books\.entity_id!==_actId/.test(html));

    console.log(`\n  ${fail===0?'ALL GREEN':fail+' FAILED'} — ${pass} passed, ${fail} failed  (stripe feed entity gating + river clear)\n`);
  } catch(e){ console.error('\n  FATAL:', e&&e.stack?e.stack:String(e)); fail++; }
  finally { try{ if(boot) await boot.stop(); }catch{} }
  process.exitCode = fail===0?0:1;
})();
