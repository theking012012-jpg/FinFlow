'use strict';
/**
 * verify-help-endpoints.js — the Help data plane: GET /api/help/progress and POST /api/help/ask.
 *
 * progress: the getting-started checklist reads REAL, TENANT-SCOPED data. A step is done only when
 *   the account actually has that thing. Discriminating (Rule 14): user A (with an entity + invoice)
 *   sees those steps done; user B (empty) sees them not-done — the endpoint is reading each account's
 *   own rows, not a constant.
 * ask: the AI help assistant DEGRADES GRACEFULLY. The harness env has no ANTHROPIC_API_KEY (boot.js
 *   scrubs it), so /api/help/ask must return 200 with unavailable:true and deterministic deep links
 *   (never a 500 dead end), reject an empty question (400), and require auth (401).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-help-endpoints.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    // User A: has an entity + one invoice (two checklist steps should be DONE).
    const aId = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'help-a@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const aE = (await c.query(`INSERT INTO entities (user_id,entity_id,data,created_at,updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [aId, { name: 'A Co', currency: 'USD', is_active: 1, sort_order: 0 }])).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [aId, aE, { client: 'Cust', amount: 1000, status: 'pending', issue_date: '2026-07-05', due_date: '2026-08-05' }]);

    // User B: brand new, nothing seeded (every step should be NOT done).
    await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: 'help-b@finflow.test', role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }]);

    const a = new HarnessHttp(server.baseUrl, { xff: '203.0.113.10' });
    A('user A login 200', (await a.post('/api/auth/login', { email: 'help-a@finflow.test', password: PW })).status === 200);

    const pa = (await a.get('/api/help/progress')).json;
    const stepA = k => (pa.steps || []).find(s => s.key === k) || {};
    A('progress returns the 6 setup steps', Array.isArray(pa.steps) && pa.steps.length === 6, JSON.stringify(pa.steps && pa.steps.map(s => s.key)));
    A('A: entity step DONE (A has an entity)', stepA('entity').done === true, JSON.stringify(stepA('entity')));
    A('A: invoice step DONE (A has an invoice)', stepA('invoice').done === true, JSON.stringify(stepA('invoice')));
    A('A: payroll step NOT done (no runs)', stepA('payroll').done === false, JSON.stringify(stepA('payroll')));
    A('A: bank step NOT done (no feed/import)', stepA('bank').done === false, JSON.stringify(stepA('bank')));
    A('A: steps carry a tour or page for the UI', stepA('invoice').tour === 'create-invoice' && stepA('invoice').page === 'invoices', JSON.stringify(stepA('invoice')));
    A('A: completed count reflects done steps', typeof pa.completed === 'number' && pa.completed >= 2, 'completed=' + pa.completed);

    const b = new HarnessHttp(server.baseUrl, { xff: '203.0.113.11' });
    A('user B login 200', (await b.post('/api/auth/login', { email: 'help-b@finflow.test', password: PW })).status === 200);
    const pb = (await b.get('/api/help/progress')).json;
    const stepB = k => (pb.steps || []).find(s => s.key === k) || {};
    // THE tenant-scoping invariant — B must NOT inherit A's milestones.
    A('B: entity step NOT done (tenant-scoped — B is empty)', stepB('entity').done === false, JSON.stringify(stepB('entity')));
    A('B: invoice step NOT done (does not see A’s invoice)', stepB('invoice').done === false, JSON.stringify(stepB('invoice')));
    A('B: completed is 0 (nothing set up)', pb.completed === 0, 'completed=' + pb.completed);

    // ── ask: graceful with no API key ──────────────────────────────────────────
    const ask1 = await a.post('/api/help/ask', { question: 'how do I create an invoice?' });
    A('ask → 200 even with no API key (never a dead end)', ask1.status === 200, 'status=' + ask1.status + ' body=' + (ask1.text || '').slice(0, 120));
    A('ask → unavailable:true with no key (does not fabricate)', ask1.json && ask1.json.unavailable === true, JSON.stringify(ask1.json));
    A('ask → deterministic links point to Invoices', ask1.json && Array.isArray(ask1.json.links) && ask1.json.links.some(l => l.page === 'invoices'), JSON.stringify(ask1.json && ask1.json.links));
    A('ask → no reply text when AI is off', ask1.json && (ask1.json.reply === null || ask1.json.reply === undefined), JSON.stringify(ask1.json && ask1.json.reply));

    const ask2 = await a.post('/api/help/ask', { question: 'reconcile my bank statement' });
    A('ask → links map "bank/reconcile" to Banking', ask2.json && ask2.json.links.some(l => l.page === 'banking'), JSON.stringify(ask2.json && ask2.json.links));

    A('ask empty question → 400', (await a.post('/api/help/ask', { question: '   ' })).status === 400);

    const anon = new HarnessHttp(server.baseUrl, { xff: '203.0.113.12' });
    A('progress requires auth (401)', (await anon.get('/api/help/progress')).status === 401);
    A('ask requires auth (401)', (await anon.post('/api/help/ask', { question: 'hi' })).status === 401);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (help progress + ask endpoints)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
