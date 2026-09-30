'use strict';
/**
 * verify-accountant-rollup.js — the cross-client "needs your attention" dashboard rollup.
 *
 * GET /api/accountants/rollup aggregates, across the accountant's ACTIVE clients: pending proposals,
 * open + overdue tasks, unread client messages, and upcoming/overdue deadlines. Discriminating
 * (Rule 14): totals reflect seeded rows across TWO clients; a client with nothing to do is NOT in the
 * attention list; an overdue task is counted overdue; another accountant's clients never leak in.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-rollup.js
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

    const mkUser = async (email, name) => (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email, name, role: 'owner', plan: 'business', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const c1 = await mkUser('roll-c1@finflow.test', 'Client One');   // has proposal + overdue task + unread
    const c2 = await mkUser('roll-c2@finflow.test', 'Client Two');   // has one open (not overdue) task
    const c3 = await mkUser('roll-c3@finflow.test', 'Client Three'); // linked but NOTHING to do → excluded from attention
    const accId = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status,created_at,updated_at)
                    VALUES ($1,$2,'Ada','Ledger','Ledger & Co','REF-ROLL','verified',NOW(),NOW()) RETURNING id`,
      ['roll-acct@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    // a DIFFERENT accountant with their own client (must never leak into the rollup)
    const acc2 = (await c.query(`INSERT INTO accountants (email,password_hash,first_name,last_name,firm,referral_code,status,created_at,updated_at)
                    VALUES ($1,$2,'Bo','Other','Other Co','REF-ROLL2','verified',NOW(),NOW()) RETURNING id`,
      ['roll-acct2@finflow.test', bcrypt.hashSync(PW, 10)])).rows[0].id;
    const foreign = await mkUser('roll-foreign@finflow.test', 'Foreign');
    for (const [a, u] of [[accId, c1], [accId, c2], [accId, c3], [acc2, foreign]])
      await c.query(`INSERT INTO accountant_clients (accountant_id,user_id,status,access_level) VALUES ($1,$2,'active','filing')`, [a, u]);

    // seed attention items for OUR accountant
    await c.query(`INSERT INTO accountant_proposals (accountant_id,user_id,title,fee_cents,status) VALUES ($1,$2,'Monthly',30000,'pending')`, [accId, c1]);
    await c.query(`INSERT INTO accountant_tasks (accountant_id,user_id,title,status,due_date) VALUES ($1,$2,'Overdue thing','open','2020-01-01')`, [accId, c1]); // overdue
    await c.query(`INSERT INTO accountant_tasks (accountant_id,user_id,title,status,due_date) VALUES ($1,$2,'Future thing','open','2099-01-01')`, [accId, c2]); // open, not overdue
    await c.query(`INSERT INTO accountant_messages (accountant_id,user_id,message,sender,created_at) VALUES ($1,$2,'hi from client','client',NOW())`, [accId, c1]); // unread (accountant_last_read NULL)
    await c.query(`INSERT INTO accountant_deadlines (accountant_id,client_name,filing_type,due_date) VALUES ($1,'Client One','VAT','2020-06-01')`, [accId]); // overdue deadline
    // noise on the OTHER accountant — must not appear
    await c.query(`INSERT INTO accountant_proposals (accountant_id,user_id,title,fee_cents,status) VALUES ($1,$2,'Foreign',1,'pending')`, [acc2, foreign]);

    const acct = new HarnessHttp(server.baseUrl, { xff: '203.0.113.60' });
    A('accountant login', (await acct.post('/api/accountants/login', { email: 'roll-acct@finflow.test', password: PW })).status === 200);
    A('[GATE] rollup requires an accountant session (401 anon)', (await new HarnessHttp(server.baseUrl, { xff: '203.0.113.61' }).get('/api/accountants/rollup')).status === 401);

    const roll = (await acct.get('/api/accountants/rollup')).json;
    const t = roll.totals || {};
    A('activeClients == 3 (only this accountant’s)', t.activeClients === 3, JSON.stringify(t));
    A('pendingProposals == 1 (foreign accountant’s excluded)', t.pendingProposals === 1, 'got=' + t.pendingProposals);
    A('openTasks == 2', t.openTasks === 2, 'got=' + t.openTasks);
    A('overdueTasks == 1 (the 2020 one)', t.overdueTasks === 1, 'got=' + t.overdueTasks);
    A('unreadMessages == 1', t.unreadMessages === 1, 'got=' + t.unreadMessages);
    A('upcomingDeadlines includes the overdue one (== 1)', t.upcomingDeadlines === 1, 'got=' + t.upcomingDeadlines);

    const names = (roll.clients || []).map(x => x.name);
    A('attention list has the 2 clients with work, not the idle one', roll.clients.length === 2 && !names.includes('Client Three'), JSON.stringify(names));
    const c1row = roll.clients.find(x => x.user_id === c1);
    A('Client One row carries proposal + overdue + unread counts', c1row && c1row.pendingProposals === 1 && c1row.overdueTasks === 1 && c1row.unread === 1, JSON.stringify(c1row));
    A('attention sorted by severity (Client One first)', roll.clients[0].user_id === c1, JSON.stringify(names));
    A('deadline flagged overdue', (roll.deadlines || [])[0] && roll.deadlines[0].overdue === true, JSON.stringify(roll.deadlines));
    A('no foreign client leaked into attention', !roll.clients.some(x => x.user_id === foreign));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (accountant dashboard rollup)`);
    console.log('');
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
