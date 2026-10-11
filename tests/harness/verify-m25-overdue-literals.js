'use strict';
/**
 * M25 (money audit 2026-10-09): no surface may count "overdue" by the literal status 'overdue' — nothing sets it.
 * BUG: the owner AI grounding and the accountant AI insights both counted status==='overdue' (always 0).
 * Seed (today pinned 2026-07-25): pending 200 due 2026-07-01 (past due) · pending 100 due 2026-08-15 (not due)
 *   correct: 1 overdue invoice in both prompts · bug: 0
 * The Anthropic call is mocked at the fetch boundary and the prompt the server builds is captured.
 */
const bcrypt = require('bcryptjs');
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

run('M25 — overdue counts in AI prompts are date-based', async ({ newOwner, c, eq, A, server }) => {
  const realFetch = global.fetch;
  const bodies = [];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-harness';
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      bodies.push(opts.body);
      return { ok: true, status: 200, json: async () => ({ content: [{ text: 'ok\nok\nok\nok\nok' }], usage: {} }), text: async () => '' };
    }
    return realFetch(url, opts);
  };
  try {
    const { uid, J, http } = await newOwner('M25');
    await J('POST', '/api/invoices', { client: 'Late', amount: 200, status: 'pending', issue_date: '2026-06-05', due_date: '2026-07-01', idempotency_key: 'm25-a' });
    await J('POST', '/api/invoices', { client: 'Fine', amount: 100, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-15', idempotency_key: 'm25-b' });
    const ai = await http.post('/api/ai', { message: 'How many invoices are overdue?' });
    A('owner /api/ai answered', ai.status === 200, 'status ' + ai.status + ' ' + String(ai.text).slice(0, 160));
    const ownerPrompt = bodies.join('\n');
    eq('owner AI grounding: overdue invoice count', (ownerPrompt.match(/Overdue invoices: (\d+)/) || [])[1], '1', '0');

    const PW = 'm25-acc-pw-not-a-secret';
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
      VALUES ('m25-acc@finflow.test', $1, 'M', 'TwentyFive', 'Firm', 'M25REF', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','view','client')`, [accId, uid]);
    const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.225' });
    A('accountant login', (await ACC.post('/api/accountants/login', { email: 'm25-acc@finflow.test', password: PW })).status === 200);
    bodies.length = 0;
    const ins = await ACC.post(`/api/accountants/clients/${uid}/ai-insights`, {});
    A('accountant ai-insights answered', ins.status === 200, 'status ' + ins.status);
    eq('accountant AI insights: overdue invoice count', ((bodies.join('\n')).match(/\((\d+) overdue invoices\)/) || [])[1], '1', '0');
  } finally { global.fetch = realFetch; }
});
