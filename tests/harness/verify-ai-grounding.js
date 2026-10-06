#!/usr/bin/env node
'use strict';
/**
 * verify-ai-grounding.js — N21 / N21b. Both AI assistants (/api/ai chat and /api/help/ask) are grounded on
 * the canonical figures for the business being viewed, in that business's currency — and a cached answer
 * is never served for a different business or different figures.
 *
 * Defects: each assistant re-derived its own figures — revenue = PAID invoices only (cash basis, every other
 * surface is issue-based accrual), expenses = the expense table only (no bills / payroll / COGS), all
 * businesses and currencies summed under '$'. The 24 h answer cache was keyed on the question alone, so
 * asking the same question while viewing another business returned the first business's answer.
 *
 * Executed: real server + Postgres; ONLY the Anthropic HTTP boundary is replaced, and the exact context the
 * server sends is captured. Seed (today 2026-07-25, January fiscal year):
 *   A (TTD): invoice pending 1000 + invoice paid 200 → revenue 1200; bill 300 + expense 50 + payroll 400 →
 *            opex 750; net 450.      B (USD): invoice paid 9999.
 *   /api/ai viewing A: context shows "TTD 1,200.00" revenue and "TTD 450.00" net   (bug: "$10,199" paid revenue)
 *   the same question viewing B: the model IS called again, with B's "USD 9,999.00" (bug: cache hit → A's answer)
 *   /api/help/ask viewing A: context shows "TTD 1,200.00"                           (bug: "$10,199")
 *   node -r ./tests/harness/clock.js tests/harness/verify-ai-grounding.js
 */
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-harness';
const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

(async () => {
  let scratch, server;
  const realFetch = global.fetch;
  const calls = [];
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-harness';   // boot clears it; the help route requires one
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://api.anthropic.com/')) {
        calls.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'answer #' + calls.length }], usage: { input_tokens: 10, output_tokens: 5 } }), text: async () => '' };
      }
      return realFetch(url, opts);
    };
    const PW = 'ai-ground-pw-1';
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email: 'aig@finflow.test', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const eA = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Alpha Ltd', currency: 'TTD', is_active: 1 }])).rows[0].id;
    const eB = (await c.query(`INSERT INTO entities (user_id,entity_id,data) VALUES ($1,NULL,$2) RETURNING id`, [uid, { name: 'Beta Inc', currency: 'USD', is_active: 0 }])).rows[0].id;
    const J = (t, e, ymd, d) => c.query(`INSERT INTO ${t} (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz)`, [uid, e, d, ymd + 'T16:00:00Z']);
    await J('invoices', eA, '2026-06-01', { client: 'C1', amount: 1000, amount_paid: 0, status: 'pending', issue_date: '2026-06-01', due_date: '2026-07-01' });
    await J('invoices', eA, '2026-05-01', { client: 'C2', amount: 200, amount_paid: 200, status: 'paid', issue_date: '2026-05-01', due_date: '2026-06-01' });
    await J('bills', eA, '2026-06-05', { vendor: 'V', amount: 300, amount_paid: 0, status: 'unpaid', issue_date: '2026-06-05', due_date: '2026-07-05' });
    await J('expenses', eA, '2026-06-10', { description: 'Fuel', category: 'Travel', amount: 50, expense_date: '2026-06-10' });
    const run = (await c.query(`INSERT INTO payroll_runs (user_id, entity_id, period, run_date, status, total_gross, total_deductions, total_net) VALUES ($1,$2,'2026-06','2026-06-28','approved',400,0,400) RETURNING id`, [uid, eA])).rows[0].id;
    await c.query(`INSERT INTO payroll_run_lines (run_id, gross, bonus, overtime, net_pay) VALUES ($1,400,0,0,400)`, [run]);
    await J('invoices', eB, '2026-06-01', { client: 'C3', amount: 9999, amount_paid: 9999, status: 'paid', issue_date: '2026-06-01', due_date: '2026-07-01' });
    const h = new HarnessHttp(server.baseUrl, { xff: '10.21.0.1' });
    A('login', (await h.post('/api/auth/login', { email: 'aig@finflow.test', password: PW })).status === 200);
    const ctxOf = (body) => JSON.stringify(body.messages || []) + JSON.stringify(body.system || '');

    console.log('\n' + '='.repeat(78));
    console.log('  AI ASSISTANTS — canonical figures, per business, per currency');
    console.log('='.repeat(78));
    const r1 = await h.post(`/api/ai?entity_id=${eA}`, { message: 'What is my revenue?' });
    A('/api/ai viewing A → 200, model called', r1.status === 200 && calls.length === 1, `status ${r1.status} calls ${calls.length} ${r1.text.slice(0, 120)}`);
    const c1 = calls[0] ? ctxOf(calls[0]) : '';
    A('  context revenue = TTD 1,200.00 (bug: "$10,199" — paid only, both businesses)', c1.includes('TTD 1,200.00'), c1.slice(0, 400));
    A('  context net profit = TTD 450.00 (1200 − 300 − 50 − 400)', c1.includes('TTD 450.00'), c1.slice(0, 400));
    A('  no "$" money in the context', !/\$\d/.test(c1));
    const r2 = await h.post(`/api/ai?entity_id=${eB}`, { message: 'What is my revenue?' });
    A('same question viewing B → the model is called again (bug: cached A answer)', r2.status === 200 && calls.length === 2 && !(r2.json && r2.json.cached), `calls ${calls.length} cached ${r2.json && r2.json.cached}`);
    const c2 = calls[1] ? ctxOf(calls[1]) : '';
    A('  context revenue = USD 9,999.00', c2.includes('USD 9,999.00'), c2.slice(0, 300));
    const r3 = await h.post(`/api/ai?entity_id=${eA}`, { message: 'What is my revenue?' });
    A('control: the same question viewing A again → cached (figures unchanged)', r3.status === 200 && r3.json && r3.json.cached === true && calls.length === 2, `cached ${r3.json && r3.json.cached} calls ${calls.length}`);
    const n = calls.length;
    const r4 = await h.post(`/api/help/ask?entity_id=${eA}`, { question: 'Why is my profit low?' });
    const c4 = calls[n] ? ctxOf(calls[n]) : '';
    A('/api/help/ask viewing A: context revenue = TTD 1,200.00 (bug: "$10,199")', r4.status === 200 && c4.includes('TTD 1,200.00'), `status ${r4.status} ${r4.text.slice(0, 200)} ${c4.slice(0, 300)}`);
  } catch (e) { fail++; console.error('[harness] fatal:', e && e.stack || e); }
  finally {
    global.fetch = realFetch;
    if (server) { try { await server.close(); } catch (_) {} }
    if (scratch) await scratch.stop();
  }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? `  ${fail} FAILED — ${pass} passed, ${fail} failed  (AI grounding)` : `  ALL GREEN — ${pass} passed, 0 failed  (AI grounding)`);
  console.log('-'.repeat(78));
  process.exit(fail ? 1 : 0);
})();
