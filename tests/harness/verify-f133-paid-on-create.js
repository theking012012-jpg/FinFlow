'use strict';
/**
 * verify-f133-paid-on-create.js — PROVE (Rule 14) that a bare status='paid' on invoice create sets
 * amount_paid = amount, so a paid invoice counts in Collected instead of being stranded in Outstanding.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f133-paid-on-create.js
 *
 * CRITICAL (per owner): the server is booted FIRST — initDB + the F56 boot-backfill (database.js:113-116)
 * run over an EMPTY invoices table, so they can heal nothing — and the invoices are then seeded via the
 * REAL POST /api/invoices route, with NO reboot after. So the create-path bug is visible, not masked by
 * the boot-backfill (which is a band-aid, not the root fix).
 *
 * Seed (owner-supplied oracle, Rule 6):
 *   INV-A {amount 1300, status 'paid'}   — the F133 case
 *   INV-B {amount 500,  status 'pending'}
 *   INV-C {amount 1000, status 'pending'} + a $400 payment via the real POST /api/invoice-payments
 *          (recalcInvoiceStatus -> amount_paid 400, status 'partial') — guards the partial path.
 * Figures (Collected=Σamount_paid, Outstanding=Σmax(0,amount−amount_paid), F56):
 *   FIXED : Collected 1700, Outstanding 1100, INV-A.amount_paid 1300
 *   BUGGY : Collected  400, Outstanding 2400, INV-A.amount_paid absent/0
 * Discriminators: Collected and INV-A.amount_paid — NOT reconciliation (Billed = Coll + Out holds BOTH ways).
 */

const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const LOGIN = { email: 'f133@finflow.test', password: 'harness-password-not-a-secret' };

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    // Boot FIRST — initDB + the F56 boot-backfill run over an EMPTY invoices table (nothing to heal).
    server = await bootServer(scratch.url);

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: LOGIN.email, name: 'F133', plan: 'pro', role: 'owner', password: bcrypt.hashSync(LOGIN.password, 10) }]
    )).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    A('login 200', login.status === 200, `status ${login.status}: ${login.text?.slice(0, 150)}`);

    // Seed via the REAL create route, AFTER boot, with NO reboot — so the boot-backfill cannot mask it.
    const a  = await http.post('/api/invoices', { client: 'INV-A Paid OnCreate', amount: 1300, status: 'paid' });
    const b  = await http.post('/api/invoices', { client: 'INV-B Pending',        amount: 500,  status: 'pending' });
    const cc = await http.post('/api/invoices', { client: 'INV-C Partial',        amount: 1000, status: 'pending' });
    A('creates 201', [a, b, cc].every(r => r.status === 201), `statuses ${a.status}/${b.status}/${cc.status}`);
    const payC = await http.post('/api/invoice-payments', { invoice_id: cc.json?.id, amount: 400 });
    A('INV-C $400 payment 201', payC.status === 201, `status ${payC.status}: ${payC.text?.slice(0, 150)}`);

    // Read back via the REAL GET /api/invoices — the surface the Invoices page reads.
    const list = await http.get('/api/invoices');
    const invs = Array.isArray(list.json) ? list.json : [];
    const num = v => parseFloat(v) || 0;
    const byClient = name => invs.find(i => i.client === name) || {};
    const invA = byClient('INV-A Paid OnCreate');
    const invC = byClient('INV-C Partial');
    const collected   = invs.reduce((s, i) => s + num(i.amount_paid), 0);
    const outstanding = invs.reduce((s, i) => s + Math.max(0, num(i.amount) - num(i.amount_paid)), 0);
    const billed      = invs.reduce((s, i) => s + num(i.amount), 0);

    console.log(`  [figures] Billed=${billed} Collected=${collected} Outstanding=${outstanding}  INV-A.amount_paid=${JSON.stringify(invA.amount_paid)} status=${invA.status}`);

    A('INV-A.amount_paid === 1300 (paid-on-create sets amount_paid = amount)',
      num(invA.amount_paid) === 1300, `amount_paid=${JSON.stringify(invA.amount_paid)}  (buggy: absent/0)`);
    A('Collected === 1700 (INV-A 1300 + INV-C 400)',
      collected === 1700, `Collected=${collected}  (buggy=400 — INV-A stranded out of Collected)`);
    A('Outstanding === 1100 (INV-B 500 + INV-C 600)',
      outstanding === 1100, `Outstanding=${outstanding}  (buggy=2400 — INV-A wrongly full)`);
    A('sanity: Billed === Collected + Outstanding (holds BOTH ways — NOT a discriminator)',
      billed === collected + outstanding, `${billed} vs ${collected + outstanding}`);
    A('partial path intact: INV-C amount_paid 400, status partial (fix does not break payments)',
      num(invC.amount_paid) === 400 && invC.status === 'partial', `INV-C=${JSON.stringify(invC)}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    fail++;
  } finally {
    try { if (server) await server.close(); } catch { /* ignore */ }
    try { if (scratch) await scratch.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
