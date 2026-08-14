#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-portal-access.js — the MARKETPLACE/portal access model, executed. This is a
 * SEPARATE system from the team-member RBAC matrix (rbac.js): a hired accountant logs in through
 * their own auth (requireAccountant / session.accountantId) and their power over a client is a
 * per-link `access_level` on accountant_clients — **view** (read-only) or **filing** (may post
 * adjusting journals + lock periods). Enforced by hand-written checks per route, NOT rbac.js.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-portal-access.js
 *
 * PROVES "view means view" for the CLIENT's books — the only two portal routes that mutate a
 * client's financial state are journal + lock, and both must block a view accountant:
 *   · view    → can READ the books; CANNOT post a journal or lock a period (403 "View-only access")
 *   · filing  → can post a journal (201) and lock a period (200)
 *   · no link → 403 "No access" (can't even read a client they weren't hired by)
 * (Notes / flags / messages are the accountant's OWN annotations, deliberately not view-gated — not
 * the client's books — so they are out of scope here.)
 *
 * Rule 14: the view→403s ARE the executed enforcement; a broken gate turns them into 2xx.
 * Scratch Postgres only — enforced by guard.js, not by intention.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    // ── the CLIENT: a normal FinFlow user with an active entity + the full seed (books to read) ──
    const clientId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{ email: 'portal-client@finflow.test', name: 'Client Co', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
    )).rows[0].id;
    await seed(c, clientId);   // gives the client an active entity + real books (payroll roster incl.)

    // ── three accountants (verified), and their links to the client ──
    const mkAcc = async (email, code) => (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ($1, $2, 'Acc', $3, 'Firm', $4, 'verified') RETURNING id`,
      [email, bcrypt.hashSync(PW, 10), code, code]
    )).rows[0].id;
    const accView = await mkAcc('acc-view@finflow.test', 'VIEWCODE');
    const accFile = await mkAcc('acc-file@finflow.test', 'FILECODE');
    const accNone = await mkAcc('acc-none@finflow.test', 'NONECODE');
    const link = async (accId, level) => c.query(
      `INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1, $2, 'active', $3)`,
      [accId, clientId, level]
    );
    await link(accView, 'view');
    await link(accFile, 'filing');
    // accNone: intentionally NO link.

    const http = new HarnessHttp(server.baseUrl);
    const login = async (email) => { const r = await http.post('/api/accountants/login', { email, password: PW }); if (r.status !== 200) throw new Error(`acc login ${email}: ${r.status} ${r.text.slice(0,140)}`); };
    const BOOKS   = `/api/accountants/clients/${clientId}/books`;
    const JOURNAL = `/api/accountants/clients/${clientId}/journal`;
    const LOCK    = `/api/accountants/clients/${clientId}/lock`;
    const journalBody = { date: '2026-07-10', description: 'Adjusting entry', lines: [{ debit: 100 }, { credit: 100 }] };

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT PORTAL ACCESS — view vs filing, executed (separate from team RBAC)');
    console.log('='.repeat(78));

    // ── VIEW accountant: read yes, mutate no ──
    console.log('\n-- access_level = view --');
    await login('acc-view@finflow.test');
    const vBooks = await http.get(BOOKS);
    A('view: GET books → 200 (can read)', vBooks.status === 200, `status ${vBooks.status}`);
    A('view: books.accessLevel === "view"', vBooks.json && vBooks.json.accessLevel === 'view', `accessLevel ${vBooks.json && vBooks.json.accessLevel}`);
    A('view: payroll detail REDACTED (allPayroll empty)', Array.isArray(vBooks.json && vBooks.json.allPayroll) && vBooks.json.allPayroll.length === 0, `allPayroll ${JSON.stringify(vBooks.json && vBooks.json.allPayroll)}`);
    const vJ = await http.post(JOURNAL, journalBody);
    A('view: POST journal → 403 (cannot mutate client books)', vJ.status === 403, `status ${vJ.status}: ${vJ.text.slice(0,120)}`);
    const vL = await http.post(LOCK, { period: '2026-07', locked: 1 });
    A('view: POST lock → 403 (cannot lock client period)', vL.status === 403, `status ${vL.status}: ${vL.text.slice(0,120)}`);

    // ── FILING accountant: read + the two client-book mutations ──
    console.log('\n-- access_level = filing --');
    await login('acc-file@finflow.test');
    const fBooks = await http.get(BOOKS);
    A('filing: GET books → 200', fBooks.status === 200, `status ${fBooks.status}`);
    A('filing: payroll detail VISIBLE (allPayroll non-empty)', Array.isArray(fBooks.json && fBooks.json.allPayroll) && fBooks.json.allPayroll.length > 0, `allPayroll len ${fBooks.json && fBooks.json.allPayroll && fBooks.json.allPayroll.length}`);
    const fJ = await http.post(JOURNAL, journalBody);
    A('filing: POST journal → 201 (may post adjusting entry)', fJ.status === 201, `status ${fJ.status}: ${fJ.text.slice(0,140)}`);
    const fL = await http.post(LOCK, { period: '2026-07', locked: 1 });
    A('filing: POST lock → 200 (may lock a period)', fL.status === 200, `status ${fL.status}: ${fL.text.slice(0,140)}`);

    // ── NO-LINK accountant: nothing, not even read ──
    console.log('\n-- no link to this client --');
    await login('acc-none@finflow.test');
    const nBooks = await http.get(BOOKS);
    A('no-link: GET books → 403 (cannot read a client they were not hired by)', nBooks.status === 403, `status ${nBooks.status}: ${nBooks.text.slice(0,120)}`);
    const nJ = await http.post(JOURNAL, journalBody);
    A('no-link: POST journal → 403', nJ.status === 403, `status ${nJ.status}: ${nJ.text.slice(0,120)}`);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (accountant-portal access)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[acc-portal] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
