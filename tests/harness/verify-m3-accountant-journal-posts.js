'use strict';
/**
 * M3 (money audit 2026-10-09): a journal posted by the client's accountant through the portal must reach the
 * books. BUG: the route stored the journal with no status, never called postJournalToLedger, and the portal
 * form sent free-text account names (untypeable by the ledger) — the toast said "posted", revenue moved 0.
 * Seed: Dr 1100 AR 900 / Cr 4000 Service Revenue 900. Correct revenue 900; the bug gives 0.
 * Also: a line without an account code is refused (400), and nothing is stored.
 */
const bcrypt = require('bcryptjs');
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

run('M3 — accountant-portal journals reach the books', async ({ newOwner, c, eq, A, server }) => {
  const { uid, J } = await newOwner('M3');
  const PW = 'm3-acc-pw-not-a-secret';
  const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
    VALUES ('m3-acc@finflow.test', $1, 'M', 'Three', 'Firm', 'M3REF1', 'verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active','filing','client')`, [accId, uid]);
  const ACC = new HarnessHttp(server.baseUrl, { xff: '203.0.113.200' });
  A('accountant login', (await ACC.post('/api/accountants/login', { email: 'm3-acc@finflow.test', password: PW })).status === 200);
  const before = await J('GET', '/api/reports');
  eq('revenue before the journal', before.revenue, 0);

  const bad = await ACC.post(`/api/accountants/clients/${uid}/journal`, { date: '2026-07-10', description: 'Names only', lines: [{ account: 'Receivables', debit: 900 }, { account: 'Sales', credit: 900 }] });
  eq('a journal whose lines carry no account code is refused', bad.status, 400, 201);
  const { rows: [{ n: afterBad }] } = await c.query(`SELECT count(*)::int AS n FROM journals WHERE user_id = $1`, [uid]);
  eq('nothing stored for the refused journal', afterBad, 0, 1);

  const ok = await ACC.post(`/api/accountants/clients/${uid}/journal`, { date: '2026-07-10', description: 'Accrue July service', lines: [{ code: '1100', name: 'Accounts Receivable', debit: 900, credit: 0 }, { code: '4000', name: 'Service Revenue', debit: 0, credit: 900 }] });
  eq('a coded journal is accepted', ok.status, 201);
  eq('stored status is Posted', ok.json && ok.json.status, 'Posted', null);
  const { rows: [{ n: gl }] } = await c.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1 AND source_type = 'journal' AND source_id = $2`, [uid, ok.json && ok.json.id]);
  eq('the journal has a ledger entry', gl, 1, 0);
  const after = await J('GET', '/api/reports');
  eq('owner revenue includes the accountant journal', after.revenue, 900, 0);
  // The legacy shape "4000 Service Revenue" in `account` (code first) is also accepted.
  const legacy = await ACC.post(`/api/accountants/clients/${uid}/journal`, { date: '2026-07-11', description: 'Code in account text', lines: [{ account: '1100 Accounts Receivable', debit: 100 }, { account: '4000 Service Revenue', credit: 100 }] });
  eq('code-first account text is accepted', legacy.status, 201);
  eq('owner revenue now 1,000', (await J('GET', '/api/reports')).revenue, 1000, 900);
});
