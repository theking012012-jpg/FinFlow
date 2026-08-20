'use strict';
/**
 * verify-f140-accountant-fyear.js — PROVE (Rule 14) the accountant /books windows on the CLIENT's
 * fiscal-year start, not the January default, so its 'year' figures match the client's own dashboard.
 * DISCRIMINATE (Rule 4) with a client whose FY starts in APRIL and an invoice dated in FEBRUARY:
 * that invoice is inside a JANUARY fiscal year (the bug) but OUTSIDE the client's APRIL fiscal year.
 *
 * Seed (client FY = April; pinned today 2026-07-25 → current FY = [2026-04-01, 2027-04-01)):
 *   INV-Feb  issue 2026-02-15  amount 1000  pending   → OUTSIDE April-FY (in the prior FY)
 *   INV-May  issue 2026-05-15  amount  500  pending   → INSIDE  April-FY (current)
 *
 * Expected WITH fix: accountant /books revenue = 500, and it EQUALS the client's /api/reports?fyStart=3.
 * Pre-fix (January default): accountant = 1500 (Feb wrongly included) ≠ client 500 — the F140 divergence.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f140-accountant-fyear.js
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const CLIENT = { email: 'f140-client@finflow.test', password: 'harness-password-not-a-secret' };
const ACC = { email: 'f140-acc@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`); } };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    // client user with fiscal_year = April
    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: CLIENT.email, name: 'C', plan: 'trial', role: 'owner', fiscal_year: 'April', password: bcrypt.hashSync(CLIENT.password, 10) }]
    )).rows[0].id;
    await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { client: 'X', amount: 1000, status: 'pending', issue_date: '2026-02-15' }]);
    await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { client: 'Y', amount: 500, status: 'pending', issue_date: '2026-05-15' }]);

    // verified accountant with an ACTIVE relationship to the client
    const accId = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, referral_code, status)
       VALUES ($1,$2,'A','B','F140REF','verified') RETURNING id`,
      [ACC.email, bcrypt.hashSync(ACC.password, 10)]
    )).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','view')`, [accId, uid]);

    // ── client session: /api/reports on the April fiscal year (fyStart=3) ──
    const clientHttp = new HarnessHttp(server.baseUrl);
    A('client login 200', (await clientHttp.post('/api/auth/login', CLIENT)).status === 200);
    const rep = await clientHttp.get('/api/reports?fyStart=3');
    const clientRev = Math.round((parseFloat(rep.json && rep.json.revenue) || 0) * 100) / 100;
    A('client /api/reports?fyStart=3 revenue = 500 (April FY excludes the Feb invoice)', clientRev === 500, `clientRev=${clientRev}`);

    // ── accountant session: /books for the client ──
    const accHttp = new HarnessHttp(server.baseUrl);
    A('accountant login 200', (await accHttp.post('/api/accountants/login', ACC)).status === 200);
    const books = await accHttp.get(`/api/accountants/clients/${uid}/books`);
    const accRev = Math.round((parseFloat(books.json && books.json.summary && books.json.summary.revenue) || 0) * 100) / 100;
    A('accountant /books revenue = 500 (uses client April FY, not Jan) [pre-fix: 1500]', accRev === 500, `accRev=${accRev} (status ${books.status})`);
    A('accountant /books revenue EQUALS the client dashboard (F140: no divergence)', accRev === clientRev, `acc=${accRev} client=${clientRev}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    try { if (server) await server.close(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
