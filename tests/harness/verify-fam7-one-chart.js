'use strict';
/**
 * FA-M7 (2026-10-27) — ONE chart of accounts per business; a journal line lands in the account picked.
 *
 * BUG (executed 2026-10-27 before the fix): the journal picker was a fixed 16-account template whose codes collide with
 * the ledger's chart (template 5000 "Salaries & Wages" vs ledger 5000 "Cost of Goods Sold"); every line posted to a
 * separate J-namespaced account named "Journal <code>"; a journal to the business's OWN account 6950 left 6950 at 0
 * while "J6950 Journal 6950" held the money; the Chart of Accounts page listed both.
 *
 * Seed (business "M7 Co", USD, nothing else), all hand-computed:
 *   own account 6950 Website costs (Expenses)
 *   OLD-style journal (codes, no acct)      Dr 5000 15 / Cr 1010 15   → J5000 "Salaries & Wages" 15, J1010 "Checking Account" −15
 *   picked journal J1                        Dr own:6950 40 / Cr sys:1000 40
 *   picked journal J2                        Dr sys:1100 25 / Cr sys:4000 25
 * Expected chart: 1000 Cash −40 · 1100 AR 25 · 4000 Revenue 25 · 6950 Website costs 40 (one row) · J5000 15 · J1010 −15.
 * Books: revenue 25 (J2), AR on the balance sheet 25. The OLD code cannot type a line that carries only `acct`, so it
 * posts neither J1 nor J2: 6950 = 0, Cash = 0, revenue = 0, AR = 0 — every check below names that value.
 */
const bcrypt = require('bcryptjs');
const { run } = require('./moneyFixKit.js');
const { HarnessHttp } = require('./httpClient.js');

run('FA-M7 — one chart of accounts; a journal line lands in the account picked', async ({ newOwner, c, eq, A, server }) => {
  const { uid, J, http, ids: [eid] } = await newOwner('M7');
  // On the OLD code there is no /api/chart: read what the old Chart of Accounts page merged (GL accounts, then the manual
  // list on top for codes the GL lacks) so the RED run reports values, not a crash. The old picker = the 16-code template.
  const OLD_PICKER = ['1010', '1020', '1100', '1200', '1500', '2000', '2100', '2200', '3000', '3100', '4000', '4100', '5000', '5100', '5200', '5300'];
  const chart = async () => {
    const r = await http.request('GET', '/api/chart');
    if (r.status === 200) return r.json.accounts;
    const gl = (await J('GET', '/api/gl/accounts')).accounts, man = await J('GET', '/api/chart-of-accounts');
    const rows = gl.map(a => ({ acct: undefined, code: a.code, name: a.name, balance: a.balance, kind: /^J/.test(a.code) ? 'older' : 'builtin', journal: OLD_PICKER.includes(a.code) }));
    for (const m of man) if (!rows.some(x => x.code === m.code)) rows.push({ acct: undefined, code: m.code, name: m.name, balance: Number(m.balance) || 0, kind: 'own', journal: false, nature: m.nature });
    for (const code of OLD_PICKER) if (!rows.some(x => x.code === code)) rows.push({ code, name: '(template)', balance: 0, journal: true });
    return rows;
  };
  const row = (ch, code) => ch.filter(a => a.code === code);
  const bal = (ch, code) => { const r = row(ch, code); return r.length === 1 ? r[0].balance : (r.length ? 'x' + r.length : null); };

  const own = await J('POST', '/api/chart-of-accounts', { code: '6950', name: 'Website costs', category: 'Expenses', idempotency_key: 'm7-own' });
  await J('POST', '/api/journals', { date: '2026-07-05', description: 'Old-style wages', status: 'Posted', lines: [{ code: '5000', debit: 15, credit: 0 }, { code: '1010', debit: 0, credit: 15 }], idempotency_key: 'm7-old' });

  let ch = await chart();
  const pick = ch.filter(a => a.journal).map(a => a.code);
  eq('1  the picker list includes the business\'s own account and the built-in Cash / AR / Revenue / Operating Expenses / equity',
    ['6950', '1000', '1100', '4000', '6000', '3000', '3100'].every(x => pick.includes(x)), true, false);
  eq('1  …and never the accounts whose figures come from their own documents (COGS, payroll, FX)',
    ['5000', '1250', '2200', '6100', '7000'].filter(x => pick.includes(x)), [], ['5000']);
  eq('1  built-in 3000 / 3100 carry the LEDGER\'s names (the template had them swapped)', [row(ch, '3000')[0].name, row(ch, '3100')[0].name], ['Retained Earnings', "Owner's Equity"], ["Owner's Equity", 'Retained Earnings']);
  eq('1  an older journal account shows its real name, not "Journal 5000"', row(ch, 'J5000').map(a => [a.name, a.kind, a.balance]), [['Salaries & Wages', 'older', 15]], [['Journal 5000', 'older', 15]]);

  const j1 = await J('POST', '/api/journals', { date: '2026-07-10', description: 'Website', status: 'Posted', idempotency_key: 'm7-j1',
    lines: [{ acct: 'own:' + own.id, debit: 40, credit: 0 }, { acct: 'sys:1000', debit: 0, credit: 40 }] });
  await J('POST', '/api/journals', { date: '2026-07-12', description: 'Accrue fee', status: 'Posted', idempotency_key: 'm7-j2',
    lines: [{ acct: 'sys:1100', debit: 25, credit: 0 }, { acct: 'sys:4000', debit: 0, credit: 25 }] });
  ch = await chart();
  eq('2  6950 Website costs holds the 40 — ONE row for 6950', bal(ch, '6950'), 40, 0);
  eq('2  no J-namespaced twin for a picked account (J6950 / J1000 / J1100 / J4000)', ch.filter(a => ['J6950', 'J1000', 'J1100', 'J4000'].includes(a.code)).map(a => a.code), [], ['J6950']);
  eq('2  built-in Cash −40 · AR 25 · Revenue 25 (hand-computed)', [bal(ch, '1000'), bal(ch, '1100'), bal(ch, '4000')], [-40, 25, 25], [0, 0, 0]);
  eq('2  the older journal accounts are untouched (J5000 15, J1010 −15)', [bal(ch, 'J5000'), bal(ch, 'J1010')], [15, -15]);
  const stored = JSON.parse((await c.query(`SELECT data->>'lines' AS l FROM journals WHERE id = $1`, [j1.id])).rows[0].l);
  eq('2  the stored line names its account (server-resolved)', stored.map(l => [l.code, l.name, l.ledger]), [['6950', 'Website costs', '6950'], ['1000', 'Cash', '1000']], null);

  const rep = await J('GET', '/api/reports');
  eq('3  the P&L: revenue 25 (the AR journal)', rep.revenue, 25, 0);
  const bs = await J('POST', '/api/reports/balance-sheet', {});
  eq('3  the balance sheet: AR 25 (subledger 0 + the journal to built-in AR)', bs.accountsReceivable, 25, 0);
  A('3  the books still tie: the balance sheet is served from the ledger (gate passed)  [source ' + bs.source + ']', bs.source !== 'computeBooks');

  const nJ = async () => (await c.query(`SELECT count(*)::int n FROM journals WHERE user_id = $1`, [uid])).rows[0].n;
  const n0 = await nJ();
  const cogs = await http.request('POST', '/api/journals', { date: '2026-07-13', description: 'x', status: 'Posted', lines: [{ acct: 'sys:5000', debit: 5 }, { acct: 'sys:1000', credit: 5 }] });
  eq('4  a journal to Cost of Goods Sold is refused, with the reason', [cogs.status, /inventory/i.test(cogs.json && cogs.json.error)], [400, true], [201, false]);
  const unknown = await http.request('POST', '/api/journals', { date: '2026-07-13', description: 'y', status: 'Posted', lines: [{ acct: 'own:999999', debit: 5 }, { acct: 'sys:1000', credit: 5 }] });
  eq('4  an account not in this business\'s chart is refused', unknown.status, 400, 201);
  eq('4  …and nothing was stored', await nJ(), n0, n0 + 2);
  const forged = await J('POST', '/api/journals', { date: '2026-07-14', description: 'Forged ledger field', status: 'Posted', idempotency_key: 'm7-forge',
    lines: [{ code: '5100', ledger: '4000', type: 'income', debit: 10, credit: 0 }, { code: '1010', debit: 0, credit: 10 }] });
  eq('4  a client-sent `ledger` field is ignored (revenue stays 25; the old-style line goes to J5100)', [(await J('GET', '/api/reports')).revenue, bal(await chart(), 'J5100')], [25, 10], [35, null]);
  eq('4  (the forged journal itself was stored the old way, no ledger field)', JSON.parse(forged.lines).some(l => 'ledger' in l), false, true);

  const dupBuilt = await http.request('POST', '/api/chart-of-accounts', { code: '5000', name: 'Salaries', category: 'Expenses' });
  eq('5  an own account cannot take a built-in code (5000) — 409', dupBuilt.status, 409, 201);
  const dupOwn = await http.request('POST', '/api/chart-of-accounts', { code: '6950', name: 'Other web', category: 'Expenses' });
  eq('5  …nor a code the business already uses (6950) — 409', dupOwn.status, 409, 201);
  eq('5  …nor a J code (reserved for older journal accounts) — 400', (await http.request('POST', '/api/chart-of-accounts', { code: 'J7000', name: 'x', category: 'Expenses' })).status, 400, 201);
  const veh = await J('POST', '/api/chart-of-accounts', { code: '1600', name: 'Vehicles', category: 'Assets', balance: 999, nature: 'Credit', idempotency_key: 'm7-veh' });
  eq('5  a typed "opening balance" is not a balance: 1600 Vehicles reads 0 on the chart, side Debit', [bal(await chart(), '1600'), veh.nature], [0, 'Debit'], [999, 'Credit']);
  eq('5  the same save retried (same key) returns the account, not a 409', (await http.request('POST', '/api/chart-of-accounts', { code: '1600', name: 'Vehicles', category: 'Assets', idempotency_key: 'm7-veh' })).status, 200, 409);
  // The owner's read-only lister (tools/launch/list-chart-accounts.js) names the rows this change shows differently. A row
  // written by the OLD code (typed balance 999 on a built-in code) is listed; 1600 Vehicles, saved by the new code, is not.
  const legacyId = (await c.query(`INSERT INTO chart_of_accounts (user_id, entity_id, data) VALUES ($1, $2, $3) RETURNING id`,
    [uid, eid, { code: '4000', name: 'Old sales', category: 'Revenue', nature: 'Credit', balance: 999 }])).rows[0].id;
  const listed = (await require('../../tools/launch/list-chart-accounts.js').listChartAccounts(c)).filter(r => r.account.startsWith(uid + ' '));
  eq('5  the owner lister names the old-style row (typed 999 on built-in 4000) and not 1600 Vehicles', listed.map(r => [r.id, r.code, /TYPED BALANCE 999/.test(r.why), /SAME CODE/.test(r.why)]), [[legacyId, '4000', true, true]], [[legacyId, '4000', true, true], [veh.id, '1600', true, false]]);
  eq('5  STRUCTURAL: the lister\'s built-in codes are the ledger\'s DEFAULT_COA (it cannot import database.js — no drift)', require('../../tools/launch/list-chart-accounts.js').BUILT_IN.slice().sort(), require('../../database.js').DEFAULT_COA.map(d => d.code).sort());
  eq('5  …and the chart still shows built-in 4000 Revenue once, at 25 (the old row never shadows it)', row(await chart(), '4000').map(a => [a.name, a.balance]), [['Revenue', 25]]);
  eq('6  6950 has entries, so its category cannot change — 409', (await http.request('PUT', '/api/chart-of-accounts/' + own.id, { category: 'Revenue' })).status, 409, 200);
  await J('PUT', '/api/chart-of-accounts/' + own.id, { name: 'Web hosting' });
  eq('6  a rename shows on the chart and in the ledger', [row(await chart(), '6950')[0].name, (await c.query(`SELECT name FROM ledger_accounts WHERE user_id = $1 AND entity_id = $2 AND code = '6950'`, [uid, eid])).rows[0].name], ['Web hosting', 'Web hosting'], ['Web hosting', 'Website costs']);

  // ── 7 · the accountant portal: the same chart, the same landing; another business's account never resolves ──
  const PW = 'm7-acc-pw-not-a-secret';
  const mkAcc = async (tag, level) => {
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status) VALUES ($1, $2, 'M', 'Seven', 'Firm', $3, 'verified') RETURNING id`,
      [`m7-${tag}@finflow.test`, bcrypt.hashSync(PW, 10), 'M7' + tag.toUpperCase()])).rows[0].id;
    if (level) await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level, requested_by) VALUES ($1,$2,'active',$3,'client')`, [accId, uid, level]);
    const h = new HarnessHttp(server.baseUrl, { xff: '203.0.113.2' + tag.length });
    if ((await h.post('/api/accountants/login', { email: `m7-${tag}@finflow.test`, password: PW })).status !== 200) throw new Error('acc login ' + tag);
    return h;
  };
  const ACC = await mkAcc('filing', 'filing');
  const ac = await ACC.get(`/api/accountants/clients/${uid}/chart?entity_id=${eid}`);
  eq('7  the accountant sees the client\'s chart — the same accounts as the owner', ac.status === 200 ? ac.json.accounts.map(a => a.acct).join() : ac.status, (await chart()).map(a => a.acct).join());
  const aj = await ACC.post(`/api/accountants/clients/${uid}/journal`, { date: '2026-07-15', description: 'Accountant: hosting', entity_id: eid, lines: [{ acct: 'own:' + own.id, debit: 5 }, { acct: 'sys:1000', credit: 5 }] });
  eq('7  an accountant journal picked from that chart lands in 6950 (40 → 45)', [aj.status, bal(await chart(), '6950')], [201, 45], [500, 40]);
  const OUT = await mkAcc('nolink', null);
  eq('7  an accountant with no link to the client cannot read its chart — 403', (await OUT.get(`/api/accountants/clients/${uid}/chart`)).status, 403, 200);
  const B = await newOwner('M7B');
  const crossOwn = await B.http.request('POST', '/api/journals', { date: '2026-07-15', description: 'cross', status: 'Posted', lines: [{ acct: 'own:' + own.id, debit: 5 }, { acct: 'sys:1000', credit: 5 }] });
  eq('7  another owner cannot post to this business\'s account by its id — 400', crossOwn.status, 400, 201);

  // ── 8 · the guarded unique-code index on a database that already holds a duplicate (the old code allowed one) ──
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'scripts', 'migrations', '2026-10-27-chart-account-codes.sql'), 'utf8');
  const hasIdx = async () => (await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_chart_of_accounts_code'`)).rows.length === 1;
  eq('8  the index exists after boot (no duplicates)', await hasIdx(), true, false);
  await c.query(`DROP INDEX idx_chart_of_accounts_code`);
  const dupIds = (await c.query(`INSERT INTO chart_of_accounts (user_id, entity_id, data) VALUES ($1,$2,$3), ($1,$2,$3) RETURNING id`, [uid, eid, { code: '8800', name: 'Twin', category: 'Expenses' }])).rows.map(r => r.id);
  let migErr = null; try { await c.query(sql); } catch (e) { migErr = e.message; }
  eq('8  with a duplicate present the migration does NOT fail (boot keeps going) and builds no index', [migErr, await hasIdx()], [null, false], ['could not create unique index', false]);
  const lst = (await require('../../tools/launch/list-chart-accounts.js').listChartAccounts(c)).filter(r => dupIds.includes(r.id));
  eq('8  the owner lister names both duplicates', lst.map(r => /DUPLICATE CODE \(2/.test(r.why)), [true, true], []);
  await c.query(`DELETE FROM chart_of_accounts WHERE id = $1`, [dupIds[1]]);
  await c.query(sql);
  eq('8  once the duplicate is resolved the same migration builds the index', await hasIdx(), true, false);
});
