'use strict';
/**
 * verify-gl-journal-bs-legs.js — L6b (FIX_PLAN_OPEN_DIVERGENCES.md). A posted manual journal's BALANCE-SHEET legs
 * (AR / AP / Inventory) post to J-namespaced ledger accounts (postJournalToLedger: 'J'+code — J1100 / J2000 / J1200),
 * but the balance sheet's AR / AP / Inventory LINES read only the system codes (bal['1100'] / ['2000'] / ['1200']),
 * and computeBooks' AR / AP are invoices / bills only. The reconcile gate eq(glAR, ar) stayed green VACUOUSLY — both
 * sides dropped the journal leg — while the GL totals (which DO include the J accounts) no longer equalled the sum of
 * the lines. Twin of L6 (journal cash legs).
 *
 * Seed (UTC entity, pinned 2026-07-25), real routes:
 *   invoice 1,000 pending (06-01) ⇒ AR subledger 1,000      bill 400 unpaid (06-02) ⇒ AP 400
 *   JE1 07-10  Dr 1100 Accounts Receivable 130 / Cr 4000 Service Revenue 130
 *   JE2 07-11  Dr 5200 Utilities 60 / Cr 2000 Accounts Payable 60
 *   JE3 07-12  Dr 1200 Inventory 75 / Cr 1010 Checking 75
 * HAND-COMPUTED balance sheet (as of 07-25):  AR 1,130 · AP 460 · Inventory 75 · Cash −75
 *   (the invoice-subledger "Outstanding" — dashboard / overdue — stays 1,000: decision D16, control vs subledger)
 * BUGGY (pre-fix): AR 1,000 · AP 400 · Inventory 0 (Δ0 for every journal leg), and cash + AR + inventory ≠ total assets.
 * Then JE1 reversed (Posted → Draft) ⇒ AR back to 1,000, still served from the reconciled GL.
 * Template codes 2100 ("Credit Card") / 2200 ("Tax Payable") are the OWNER's mapping decision — asserted only to NOT
 * move AR / AP / Inventory.
 *
 * Runs in PowerShell on the owner's machine:  node -r ./tests/harness/clock.js tests/harness/verify-gl-journal-bs-legs.js
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
const PW = 'harness-password-not-a-secret';
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client; let server;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L6b — journal AR / AP / Inventory legs reach the balance sheet (two-sided)\n' + '='.repeat(78) + '\n');
    const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data,created_at,updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'l6b@finflow.test', name: 'L6b', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }])).rows[0].id;
    const http = new HarnessHttp(server.baseUrl);
    if ((await http.post('/api/auth/login', { email: 'l6b@finflow.test', password: PW })).status !== 200) throw new Error('login');
    const J = async (p, b, m) => { const r = await (m === 'PUT' ? http.put(p, b) : http.post(p, b)); if (r.status >= 300) throw new Error(p + ' ' + r.status + ' ' + String(r.text).slice(0, 160)); return JSON.parse(r.text); };
    const ent = await J('/api/entities', { name: 'L6b Co', currency: 'USD', timezone: 'UTC', country: 'US' });
    await J('/api/entities/' + ent.id + '/activate', {});
    await J('/api/invoices', { client: 'Acme', amount: 1000, status: 'pending', issue_date: '2026-06-01', due_date: '2026-08-01' });
    await J('/api/bills', { vendor: 'Supplier', amount: 400, status: 'unpaid', issue_date: '2026-06-02', due_date: '2026-08-02' });
    const bs = async () => (await http.post('/api/reports/balance-sheet', {})).json || {};
    const b0 = await bs();
    A('baseline: AR 1,000 · AP 400 served from the reconciled GL', b0.source === 'gl' && near(b0.accountsReceivable, 1000) && near(b0.accountsPayable, 400), JSON.stringify(b0));

    const je = (date, desc, lines) => J('/api/journals', { date, description: desc, status: 'Posted', lines });
    const je1 = await je('2026-07-10', 'AR adjustment', [{ code: '1100', name: 'Accounts Receivable', debit: 130, credit: 0 }, { code: '4000', name: 'Service Revenue', debit: 0, credit: 130 }]);
    await je('2026-07-11', 'Utilities accrual', [{ code: '5200', name: 'Utilities', debit: 60, credit: 0 }, { code: '2000', name: 'Accounts Payable', debit: 0, credit: 60 }]);
    await je('2026-07-12', 'Stock purchase', [{ code: '1200', name: 'Inventory', debit: 75, credit: 0 }, { code: '1010', name: 'Checking', debit: 0, credit: 75 }]);
    const b1 = await bs();
    A('JE Dr AR 130 ⇒ balance-sheet AR 1,130 (bug: 1,000 — Δ0)', near(b1.accountsReceivable, 1130), JSON.stringify(b1));
    A('JE Cr AP 60 ⇒ balance-sheet AP 460 (bug: 400 — Δ0)', near(b1.accountsPayable, 460), JSON.stringify(b1));
    A('JE Dr Inventory 75 ⇒ balance-sheet Inventory 75 (bug: 0)', near(b1.inventory, 75), JSON.stringify(b1));
    A('served from the reconciled GL (gate holds WITH the legs on both sides)', b1.source === 'gl', 'source=' + b1.source);
    A('asset lines sum to total assets: cash + AR + inventory (bug: total includes J1100/J1200, lines do not)',
      near(Number(b1.cash) + Number(b1.accountsReceivable) + Number(b1.inventory), b1.totalAssets), JSON.stringify({ cash: b1.cash, ar: b1.accountsReceivable, inv: b1.inventory, total: b1.totalAssets }));
    const rep = (await http.get('/api/reports?period=year&fyStart=0')).json || {};
    A('D16: invoice-subledger Outstanding (dashboard / overdue) stays 1,000', near(rep.outstanding, 1000), 'outstanding=' + rep.outstanding);
    const rc = (await http.get('/api/gl/reconcile-check')).json || {};
    A('/api/gl/reconcile-check ok, booksBalanced', rc.ok === true && (rc.entities || []).every(e => e.booksBalanced !== false), JSON.stringify(rc).slice(0, 240));

    // accountant portal balance sheet carries the same legs
    const accId = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('l6b-acc@finflow.test',$1,'Acc','L6b','Firm','CODEL6B','verified') RETURNING id`, [bcrypt.hashSync(PW, 10)])).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1,$2,'active','filing')`, [accId, uid]);
    const acc = new HarnessHttp(server.baseUrl, { xff: '203.0.113.61' });
    if ((await acc.post('/api/accountants/login', { email: 'l6b-acc@finflow.test', password: PW })).status !== 200) throw new Error('accountant login');
    const bk = (await acc.get('/api/accountants/clients/' + uid + '/books?period=year&entity_id=' + ent.id)).json || {};
    const pbs = bk.balanceSheet || {};
    A('accountant portal balance sheet: AR 1,130 · AP 460 (bug: 1,000 · 400)', near(pbs.accountsReceivable, 1130) && near(pbs.accountsPayable, 460), JSON.stringify(pbs).slice(0, 200));

    // owner-decision codes must not leak into AR / AP / Inventory
    await je('2026-07-13', 'Template 2200', [{ code: '5300', name: 'Fees', debit: 20, credit: 0 }, { code: '2200', name: 'Tax Payable', debit: 0, credit: 20 }]);
    await je('2026-07-14', 'Template 2100', [{ code: '5400', name: 'Supplies', debit: 15, credit: 0 }, { code: '2100', name: 'Credit Card', debit: 0, credit: 15 }]);
    const b2 = await bs();
    A('template 2100 / 2200 journals do not move AR / AP / Inventory (owner decision pending)', near(b2.accountsReceivable, 1130) && near(b2.accountsPayable, 460) && near(b2.inventory, 75), JSON.stringify(b2));

    // reversal ⇒ back to baseline, still reconciled
    await J('/api/journals/' + je1.id, { status: 'Draft' }, 'PUT');
    const b3 = await bs();
    A('JE1 reversed (Posted → Draft) ⇒ AR back to 1,000, still served from the reconciled GL', near(b3.accountsReceivable, 1000) && b3.source === 'gl', JSON.stringify({ ar: b3.accountsReceivable, source: b3.source }));
  } catch (e) { fail++; console.log('  FATAL: ' + (e && e.stack || e)); }
  finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (journal BS legs)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
