'use strict';
/**
 * verify-stripe-import.js — DISPLAY→BOOKS reconcile for the Stripe live feed. The feed used to be
 * VISIBLE ONLY: charges showed on the dashboard but changed no money surface. This verifies the
 * owner-approved bridge that records ONE connected-Stripe charge into the books as revenue:
 *   - GET  /api/stripe/feed annotates each charge with inBooks (already recorded?) so the UI offers
 *     "Add to books" only for the rest and never invites a double-post.
 *   - POST /api/stripe/import-charge re-fetches the charge from Stripe (authoritative amount), creates
 *     ONE sales_receipt (→ revenue on /api/reports), and is IDEMPOTENT on the charge id.
 *
 * MONEY-INTEGRITY (the point of this harness): importing the same charge twice must NEVER double-count.
 * We assert /api/reports revenue rises by exactly the charge amount on first import and does NOT
 * move on re-import. Discriminating: before the fix the endpoint 404s and inBooks is undefined.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-stripe-import.js
 */
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_harness';
process.env.STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || 'ca_harness';
require('./clock.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const OWNER = { email: 'stripeimport-owner@finflow.test', password: 'harness-password-not-a-secret' };

// 2026 charges (inside the clock-pinned reports year 2026-07-25 America/Port_of_Spain) so an imported
// receipt lands in the current /api/reports window. ch_1 = $50, ch_2 = $25 (both succeeded), ch_3 failed.
const CH = {
  ch_1: { id: 'ch_1', amount: 5000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Order #1001', billing_details: { email: 'a@b.com' }, payment_intent: 'pi_1', balance_transaction: { fee: 175, currency: 'usd', net: 4825 }, created: 1784548800, livemode: false },
  ch_2: { id: 'ch_2', amount: 2500, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Order #1002', created: 1784376000, livemode: false },
  ch_3: { id: 'ch_3', amount: 9900, currency: 'usd', status: 'failed', paid: false, refunded: false, description: 'Order #1003', created: 1784376000, livemode: false },
  ch_4: { id: 'ch_4', amount: 7700, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Invoice payment', created: 1784548800, livemode: false },
  ch_5: { id: 'ch_5', amount: 4000, currency: 'usd', status: 'succeeded', paid: true, refunded: false, description: 'Order #1005', balance_transaction: { fee: 146, currency: 'usd', net: 3854 }, created: 1784548800, livemode: false },
};

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  const AS = (n, ok, d) => A('[STRUCTURAL] ' + n, ok, d);
  const realFetch = global.fetch;
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    server = await bootServer(scratch.url);

    // Mock ONLY the Stripe HTTP boundary: list (feed) + single-charge GET (import re-fetch).
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith('https://api.stripe.com/v1/charges/')) {
        const id = decodeURIComponent(u.split('/v1/charges/')[1].split('?')[0]);
        if (CH[id]) return { ok: true, status: 200, json: async () => CH[id] };
        return { ok: false, status: 404, json: async () => ({ error: { message: 'No such charge: ' + id } }) };
      }
      if (u.startsWith('https://api.stripe.com/v1/charges')) {
        return { ok: true, status: 200, json: async () => ({ object: 'list', data: [CH.ch_1, CH.ch_2, CH.ch_3] }) };
      }
      return realFetch(url, opts);
    };

    const uid = (await c.query(`INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: OWNER.email, name: 'SI Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync(OWNER.password, 10) }])).rows[0].id;
    await c.query(`INSERT INTO user_settings (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
      [uid, { key: 'stripe_conn', value: JSON.stringify({ stripe_user_id: 'acct_test123', linked_at: '2026-07-01T00:00:00Z' }) }]);
    // sales_receipts is entity-required; the middleware auto-selects the is_active entity on first /api call.
    const eid = (await c.query(`INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, { name: 'SI Co', currency: 'USD', is_active: 1 }])).rows[0].id;

    const http = new HarnessHttp(server.baseUrl);
    A('owner login 200', (await http.post('/api/auth/login', OWNER)).status === 200);

    const recCount = async () => (await c.query(`SELECT COUNT(*)::int n FROM sales_receipts WHERE user_id=$1`, [uid])).rows[0].n;
    const revenue = async () => { const r = await http.get('/api/reports'); return (r.json && r.json.revenue) || 0; };
    const expenses = async () => { const r = await http.get('/api/reports'); return (r.json && r.json.expenses) || 0; };

    // ── Baseline: feed annotates inBooks=false for everything; no receipts; capture revenue. ──
    const rev0 = await revenue();
    const f0 = await http.get('/api/stripe/feed');
    A('feed 200', f0.status === 200, `status=${f0.status}`);
    const ch = (d, id) => (d.json.charges || []).find(x => x.id === id);
    A('feed annotates inBooks (=== false pre-import; undefined ⇒ annotation missing)',
      (f0.json.charges || []).length === 3 && (f0.json.charges || []).every(x => x.inBooks === false),
      JSON.stringify((f0.json.charges || []).map(x => [x.id, x.inBooks])));
    A('no sales_receipts yet', (await recCount()) === 0);

    // ── First import of ch_1 ($50): creates ONE receipt, revenue rises by exactly 50. ──
    const imp1 = await http.post('/api/stripe/import-charge', { charge_id: 'ch_1' });
    A('POST /api/stripe/import-charge exists (not 404 — was display-only)', imp1.status === 200, `status=${imp1.status}`);
    A('import ok + imported:true', imp1.json && imp1.json.ok === true && imp1.json.imported === true, JSON.stringify(imp1.json).slice(0,160));
    A('exactly ONE sales_receipt created', (await recCount()) === 1);
    const row1 = (await c.query(`SELECT data FROM sales_receipts WHERE user_id=$1`, [uid])).rows[0].data;
    A('receipt amount re-fetched from Stripe (50.00, from cents)', Number(row1.amount) === 50, `amount=${row1.amount}`);
    A('receipt method = Card (Stripe)', row1.method === 'Card (Stripe)', `method=${row1.method}`);
    A('receipt idempotency_key = stripe-charge:ch_1', row1.idempotency_key === 'stripe-charge:ch_1', `idem=${row1.idempotency_key}`);
    A('receipt date from the charge (2026-07-20, inside the reports year)', row1.date === '2026-07-20', `date=${row1.date}`);
    const rev1 = await revenue();
    A('revenue rose by exactly 50 (charge now counts on /api/reports)', Math.abs((rev1 - rev0) - 50) < 1e-6, `rev0=${rev0} rev1=${rev1}`);
    A('MONEY-OUT: import booked the Stripe fee (imp response carries fee $1.75)', imp1.json && imp1.json.fee && Math.abs(Number(imp1.json.fee.amount) - 1.75) < 1e-6, JSON.stringify(imp1.json && imp1.json.fee));
    const _feeRow = (await c.query(`SELECT data FROM expenses WHERE user_id=$1 AND data->>'idempotency_key'=$2`, [uid, 'stripe-fee:ch_1'])).rows[0];
    A('fee is a separate expense (amount 1.75, category Payment processing)', _feeRow && Number(_feeRow.data.amount) === 1.75 && _feeRow.data.category === 'Payment processing', JSON.stringify(_feeRow && _feeRow.data));
    A('gross revenue unchanged by the fee (revenue still +50, fee sits in expenses)', Math.abs((rev1 - rev0) - 50) < 1e-6);

    // ── Feed now flags ch_1 inBooks=true, others still false. ──
    const f1 = await http.get('/api/stripe/feed');
    A('feed: ch_1 now inBooks=true', ch(f1, 'ch_1').inBooks === true);
    A('feed: ch_2 still inBooks=false', ch(f1, 'ch_2').inBooks === false);

    // ── Re-import ch_1: idempotent — duplicate, NO second receipt, revenue UNCHANGED (no double-count). ──
    const imp1b = await http.post('/api/stripe/import-charge', { charge_id: 'ch_1' });
    A('re-import returns duplicate:true (not a second post)', imp1b.status === 200 && imp1b.json && imp1b.json.duplicate === true, JSON.stringify(imp1b.json).slice(0,160));
    A('STILL exactly one sales_receipt (no dupe row)', (await recCount()) === 1);
    const rev1b = await revenue();
    A('revenue UNCHANGED on re-import (no double-count)', Math.abs(rev1b - rev1) < 1e-6, `rev1=${rev1} rev1b=${rev1b}`);

    // ── A failed charge cannot be booked. ──
    const impFail = await http.post('/api/stripe/import-charge', { charge_id: 'ch_3' });
    A('failed charge rejected (400)', impFail.status === 400, `status=${impFail.status}`);
    A('failed charge created no receipt (still 1)', (await recCount()) === 1);

    // ── A bad charge_id is rejected before any Stripe call. ──
    const impBad = await http.post('/api/stripe/import-charge', { charge_id: 'not-a-charge' });
    A('malformed charge_id rejected (400)', impBad.status === 400, `status=${impBad.status}`);

    // ── Second valid import (ch_2 $25) stacks correctly: 2 receipts, revenue +25 more. ──
    const imp2 = await http.post('/api/stripe/import-charge', { charge_id: 'ch_2' });
    A('import ch_2 ok', imp2.status === 200 && imp2.json.imported === true);
    A('now two receipts', (await recCount()) === 2);
    const rev2 = await revenue();
    A('revenue rose by exactly 25 more (independent charges sum, no interference)', Math.abs((rev2 - rev1) - 25) < 1e-6, `rev1=${rev1} rev2=${rev2}`);

    // ── Invoice-match guard (stopgap before match-to-invoice): a charge whose amount == an OPEN invoice's
    //    total must WARN (needsConfirm) rather than silently create a 2nd revenue line; owner confirm overrides. ──
    await c.query(`INSERT INTO invoices (user_id,entity_id,data,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [uid, eid, { client: 'Acme Co', num: 'INV-777', amount: 77, amount_paid: 0, status: 'pending', issue_date: '2026-07-20' }]);
    const recBeforeGuard = await recCount();
    const revBeforeGuard = await revenue();
    const g1 = await http.post('/api/stripe/import-charge', { charge_id: 'ch_4' });
    A('charge matching an OPEN invoice → needsConfirm (not booked blindly)', g1.status === 200 && g1.json && g1.json.needsConfirm === true && g1.json.ok === false, JSON.stringify(g1.json).slice(0,160));
    A('guard names the matched invoice (INV-777)', g1.json && g1.json.match && g1.json.match.num === 'INV-777', JSON.stringify(g1.json && g1.json.match));
    A('guard did NOT create a receipt', (await recCount()) === recBeforeGuard);
    A('guard did NOT move revenue', Math.abs((await revenue()) - revBeforeGuard) < 1e-6);
    const g2 = await http.post('/api/stripe/import-charge', { charge_id: 'ch_4', confirm: true });
    A('owner confirm:true → imported anyway', g2.status === 200 && g2.json && g2.json.imported === true, JSON.stringify(g2.json).slice(0,160));
    A('confirm created exactly one receipt', (await recCount()) === recBeforeGuard + 1);
    A('confirm booked the $77 (revenue +77 on the owner\'s explicit call)', Math.abs((await revenue()) - (revBeforeGuard + 77)) < 1e-6, `before=${revBeforeGuard}`);
    // (A non-matching charge never triggers the guard: ch_1/ch_2 imported earlier with no confirm, proven above.)

    // ── MONEY-OUT: a refund of a booked charge is a contra receipt (revenue nets down); the fee is NOT reversed. ──
    const impFee = await http.post('/api/stripe/import-charge', { charge_id: 'ch_5' });
    A('ch_5 imported with its fee', impFee.status === 200 && impFee.json.imported === true && impFee.json.fee && Math.abs(Number(impFee.json.fee.amount) - 1.46) < 1e-6, JSON.stringify(impFee.json && impFee.json.fee));
    const revAfterCh5 = await revenue();
    const expAfterCh5 = await expenses();
    // Stripe now reports ch_5 as refunded in full.
    CH.ch_5.refunded = true; CH.ch_5.amount_refunded = 4000; CH.ch_5.refunds = { data: [{ id: 're_5', created: 1784548800 }] };
    const rf = await http.post('/api/stripe/import-refund', { charge_id: 'ch_5' });
    A('refund recorded as a contra receipt', rf.status === 200 && rf.json && rf.json.refunded === true, JSON.stringify(rf.json).slice(0,140));
    A('contra receipt is NEGATIVE (-40)', rf.json && rf.json.receipt && Number(rf.json.receipt.amount) === -40, JSON.stringify(rf.json && rf.json.receipt && rf.json.receipt.amount));
    A('revenue nets down by 40 after the refund', Math.abs((await revenue()) - (revAfterCh5 - 40)) < 1e-6, `before=${revAfterCh5}`);
    A('the Stripe fee is NOT reversed (expenses unchanged by the refund)', Math.abs((await expenses()) - expAfterCh5) < 1e-6);
    const rfDup = await http.post('/api/stripe/import-refund', { charge_id: 'ch_5' });
    A('re-refund is idempotent (duplicate, no second contra)', rfDup.status === 200 && rfDup.json.duplicate === true, JSON.stringify(rfDup.json).slice(0,120));
    const rfNever = await http.post('/api/stripe/import-refund', { charge_id: 'ch_3' });
    A('refund of a charge never booked → 400 (nothing to reverse)', rfNever.status === 400 && /NOT_BOOKED|never added/.test(JSON.stringify(rfNever.json||{})), `status=${rfNever.status}`);

    // ── STRUCTURAL — server + client wiring is actually present. ──
    const srv = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
    AS('server: import-charge idempotency guard SELECTs by idempotency_key BEFORE inserting',
      /import-charge[\s\S]*?SELECT \* FROM sales_receipts WHERE user_id=\$1 AND data->>'idempotency_key'=\$2[\s\S]*?db\.insert\('sales_receipts'/.test(srv));
    AS('server: import re-fetches the charge from Stripe (never trusts client amount)',
      /import-charge[\s\S]*?fetch\('https:\/\/api\.stripe\.com\/v1\/charges\/'/.test(srv));
    AS('server: feed annotates inBooks from sales_receipts idempotency keys',
      /idempotency_key' = ANY\(\$2\)[\s\S]*?c\.inBooks = _booked\.has/.test(srv));
    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    AS('client: startStripeFeed renders an "Add to books" control for un-booked succeeded charges',
      /c\.inBooks/.test(html) && /Add to books/.test(html) && /ffImportStripeCharge/.test(html));
    AS('client: ffImportStripeCharge POSTs import-charge then refreshes money surfaces',
      /ffImportStripeCharge[\s\S]*?\/api\/stripe\/import-charge[\s\S]*?(refreshFinancials|updateDashboard)/.test(html));
    // Regression guard for the "booked but the dashboard didn't move" bug: the dashboard revenue card
    // reads window.receipts, and refreshFinancials reloads ONLY invoices/expenses — so the import handler
    // MUST reload receipts (window.loadReceipts) or the new revenue never repaints until a full reload.
    AS('client: import handler reloads sales_receipts (loadReceipts) so revenue repaints without a reload',
      /ffImportStripeCharge[\s\S]*?loadReceipts/.test(html));
    const bundle = fs.readFileSync(path.join(process.cwd(), 'public', 'finflow-bundle.js'), 'utf8');
    AS('bundle: window.loadReceipts is exposed (the handler above depends on it)',
      /window\.loadReceipts\s*=\s*loadReceipts/.test(bundle));
    AS('server: warns (needsConfirm/invoice_match) on an open-invoice amount match unless confirm:true',
      /needsConfirm: true[\s\S]*?reason: 'invoice_match'/.test(srv) && /req\.body && req\.body\.confirm === true/.test(srv));
    AS('client: handler surfaces the confirm and re-POSTs with confirm on approval',
      /needsConfirm[\s\S]*?window\.confirm[\s\S]*?_post\(true\)/.test(html));
    AS('server: books the Stripe fee as a separate expense, idempotent on the charge',
      /stripe-fee:/.test(srv) && /db\.insert\('expenses'/.test(srv) && /balance_transaction/.test(srv));
    AS('server: import-refund books a NEGATIVE contra, requires the original booked, keeps the fee',
      /app\.post\('\/api\/stripe\/import-refund'/.test(srv) && /amount: -refundAmt/.test(srv) && /NOT_BOOKED/.test(srv));
    AS('client: Record-refund control + handler are wired',
      /Record refund/.test(html) && /ffImportStripeRefund/.test(html) && /import-refund/.test(html));

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (Stripe reconcile → books)`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { global.fetch = realFetch; try { if (server) await server.close(); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
