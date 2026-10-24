'use strict';
/**
 * verify-fal3d-referral-payouts.js — FA-L3d (owner decision 2026-10-24: "book referral months in-app every month,
 * and pay accountants automatically by Stripe Connect transfer").
 *
 * Before: referral months were booked only if something OUTSIDE the app called POST /run-monthly-payouts with
 * CRON_SECRET (nothing in the repo did), and nothing ever paid them — an admin marked rows 'paid' by hand; there
 * was no Stripe transfer anywhere. The page promised "paid on the 1st of every month".
 *
 * Real server + real Postgres + the server's own Stripe client with its transfer / account methods replaced by a
 * recorder (no network). Seeds discriminate (Rule 4) — hand-computed expected values:
 *   A  ready (transfers active), 3 paying clients (3 × $10 booked now) + $10 left pending from last month,
 *      plus a $435.20 service bill still awaiting payment and a $90.00 paid one
 *        → ONE transfer of $40.00 to acct_A   (bug: none; a "sum every unpaid row" bug: $475.20)
 *   B  Stripe account whose transfers capability is inactive → nothing sent, earnings stay pending
 *   C  no Stripe account → nothing sent
 *   D  ready, first transfer attempt fails (balance_insufficient) → payout failed, earnings pending; next run → sent
 *      once, $10.00
 *   E  ready, Stripe MAKES the transfer but the reply is lost (timeout) → next run finds that transfer and records it
 *      → exactly ONE transfer (bug without the lookup: two)
 *   F  ready, but Stripe's transfer does not match what is owed ($9.99 for $10.00) → never marked paid; the payout
 *      stays failed with the mismatch named, for a person to look at
 * Then: re-runs and 3 concurrent runs send nothing more; a new booking waits for next month (one payout a month);
 * moving A's payout back a month releases it ($10.00); admin "mark paid" refuses rows a transfer is paying and
 * unpaid bills; A is emailed; the earnings API shows the transfer.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fal3d-referral-payouts.js
 */
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: {
  Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { data: { id: 'mock' } }; } }; } },
} };
process.env.HARNESS_KEEP_STRIPE = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_fal3d';
process.env.CRON_SECRET = 'harness-cron-fal3d';
process.env.ADMIN_PASSWORD = 'harness-admin-fal3d';
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

(async () => {
  let scratch, server, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;
    installEnv(scratch.url);
    process.env.RESEND_API_KEY = 're_mock';
    process.env.EMAIL_FROM = 'FinFlow <noreply@test.example>';
    process.env.APP_URL = 'https://finflow-test.example';
    const database = require('../../database.js');
    await database.initDB();
    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const base = `http://127.0.0.1:${server.address().port}`;

    // ── Stripe recorder: Connect accounts + transfers (what Stripe would hold) ──
    const stripe = app._stripe();
    const caps = { acct_A: 'active', acct_B: 'inactive', acct_D: 'active', acct_E: 'active', acct_F: 'active' };
    const transfers = [];          // every transfer Stripe actually made
    const createCalls = [];        // every create call (with its idempotency key)
    const failOnce = { acct_D: 'balance_insufficient' };
    const loseReplyOnce = { acct_E: true };
    const shortBy = { acct_F: 1 };   // Stripe returns a transfer 1 cent short
    stripe.accounts.retrieve = async (id) => ({ id, capabilities: { transfers: caps[id] || 'inactive' } });
    stripe.transfers.list = async (p) => ({ data: transfers.filter(t => !p || !p.transfer_group || t.transfer_group === p.transfer_group) });
    stripe.transfers.create = async (p, opts) => {
      createCalls.push({ p, key: opts && opts.idempotencyKey });
      if (failOnce[p.destination]) { const code = failOnce[p.destination]; delete failOnce[p.destination]; const e = new Error('Insufficient funds in Stripe account.'); e.code = code; throw e; }
      const prior = transfers.find(t => t._key && t._key === (opts && opts.idempotencyKey));
      if (prior) return prior;     // Stripe's idempotency: same key → same transfer
      const t = { id: 'tr_' + (transfers.length + 1), object: 'transfer', amount: p.amount - (shortBy[p.destination] || 0), currency: p.currency, destination: p.destination, transfer_group: p.transfer_group, metadata: p.metadata, _key: opts && opts.idempotencyKey };
      transfers.push(t);
      if (loseReplyOnce[p.destination]) { delete loseReplyOnce[p.destination]; const e = new Error('Request timed out'); e.type = 'StripeConnectionError'; throw e; }
      return t;
    };

    // ── seed ──
    const PW = 'fal3d-pw-1';
    const mkAcc = async (tag, acct) => (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status, stripe_account_id, stripe_onboarded)
      VALUES ($1, $2, $3, 'Payee', $7, $4, 'verified', $5, $6) RETURNING id`, [`fal3d-${tag.toLowerCase()}@finflow.test`, bcrypt.hashSync(PW, 10), 'Acc' + tag, 'FAL3D' + tag, acct, !!acct, 'Firm ' + tag])).rows[0].id;
    const mkClient = async (accId, email) => {
      const uid = (await c.query(`INSERT INTO users (user_id,entity_id,data) VALUES (NULL,NULL,$1) RETURNING id`, [{ email, plan: 'business', role: 'owner', subscriptionStatus: 'active' }])).rows[0].id;
      await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, referral_month, referral_months_total, requested_by) VALUES ($1,$2,'active',0,3,'client')`, [accId, uid]);
      return uid;
    };
    const accA = await mkAcc('A', 'acct_A'), accB = await mkAcc('B', 'acct_B'), accC = await mkAcc('C', null), accD = await mkAcc('D', 'acct_D'), accE = await mkAcc('E', 'acct_E'), accF = await mkAcc('F', 'acct_F');
    for (const n of [1, 2, 3]) await mkClient(accA, `fal3d-a${n}@finflow.test`);
    await mkClient(accB, 'fal3d-b1@finflow.test');
    await mkClient(accC, 'fal3d-c1@finflow.test');
    await mkClient(accD, 'fal3d-d1@finflow.test');
    await mkClient(accE, 'fal3d-e1@finflow.test');
    await mkClient(accF, 'fal3d-f1@finflow.test');
    // A: $10 still pending from last month; a $435.20 bill awaiting payment; a $90.00 paid service fee
    await c.query(`INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, description, status, period_month)
                   VALUES ($1, NULL, 'referral', 1000, 'Referral commission — last month', 'pending', date_trunc('month', NOW()) - interval '1 month')`, [accA]);
    await c.query(`INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, billed_cents, commission_cents, description, status) VALUES ($1, NULL, 'service_commission', 43520, 50000, 5000, 'Bill awaiting payment', 'awaiting_payment')`, [accA]);
    await c.query(`INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, billed_cents, commission_cents, description, status) VALUES ($1, NULL, 'service_commission', 9000, 10000, 1000, 'Bill paid', 'paid')`, [accA]);

    const q = async (sql, p) => (await c.query(sql, p)).rows;
    const toDest = (acct) => transfers.filter(t => t.destination === acct);
    const refPending = async (accId) => Number((await q(`SELECT COUNT(*) n FROM accountant_earnings WHERE accountant_id=$1 AND type='referral' AND status='pending'`, [accId]))[0].n);

    console.log('\n' + '='.repeat(78) + '\n  FA-L3d — referral pay booked in-app every month and sent by Stripe Connect transfer\n' + '='.repeat(78) + '\n');

    // 1 — the hourly job (the replica-exclusive wrapper the server schedules) books AND pays
    A('the server schedules a referral job (bug: none — only an outside cron could book)', !!(app._jobs && typeof app._jobs.referrals === 'function'), Object.keys(app._jobs || {}).join(','));
    if (app._jobs && app._jobs.referrals) await app._jobs.referrals();
    const booked = Number((await q(`SELECT COUNT(*) n FROM accountant_earnings WHERE type='referral' AND period_month = date_trunc('month', NOW())`))[0].n);
    A('1  this month booked once per paying client: 3 (A) + 1 each B, C, D, E, F = 8', booked === 8, 'booked=' + booked);
    const tA = toDest('acct_A');
    A('2  A: ONE transfer of $40.00 = 3 × $10 now + $10 left from last month (bug: none; "every unpaid row": $475.20)', tA.length === 1 && tA[0].amount === 4000 && tA[0].currency === 'usd', JSON.stringify(tA.map(t => [t.amount, t.currency])));
    A('2b A: those 4 referral rows are paid and carry the payout; the service rows are untouched', (await refPending(accA)) === 0
      && (await q(`SELECT status FROM accountant_earnings WHERE accountant_id=$1 AND type='service_commission' ORDER BY amount_cents`, [accA])).map(r => r.status).join() === 'paid,awaiting_payment', '');
    const pA = (await q(`SELECT * FROM referral_payouts WHERE accountant_id=$1`, [accA]).catch(e => [{ err: e.message }]));
    A('2c A: the payout row says sent, $40.00, with the Stripe transfer id', pA.length === 1 && pA[0].status === 'sent' && pA[0].amount_cents === 4000 && pA[0].stripe_transfer_id === (tA[0] || {}).id, JSON.stringify(pA));
    A('3  B (transfers capability inactive): nothing sent, its $10 stays pending', toDest('acct_B').length === 0 && (await refPending(accB)) === 1, `transfers=${toDest('acct_B').length} pending=${await refPending(accB)}`);
    A('4  C (no Stripe account): nothing sent, its $10 stays pending', (await refPending(accC)) === 1, 'pending=' + await refPending(accC));
    const pD1 = (await q(`SELECT status, last_error FROM referral_payouts WHERE accountant_id=$1`, [accD]).catch(() => []));
    A('5  D: the transfer failed → payout "failed" with Stripe\'s reason, the $10 stays pending', toDest('acct_D').length === 0 && pD1.length === 1 && pD1[0].status === 'failed' && /insufficient/i.test(pD1[0].last_error || '') && (await refPending(accD)) === 1, JSON.stringify(pD1));
    const pE1 = (await q(`SELECT status FROM referral_payouts WHERE accountant_id=$1`, [accE]).catch(() => []));
    A('6  E: Stripe made the transfer but the reply was lost → recorded as failed for now (nothing marked paid blind)', toDest('acct_E').length === 1 && pE1.length === 1 && pE1[0].status === 'failed' && (await refPending(accE)) === 1, JSON.stringify(pE1));
    const pF = (await q(`SELECT status, last_error FROM referral_payouts WHERE accountant_id=$1`, [accF]).catch(() => []));
    A('6b F: Stripe\'s transfer is $9.99 for $10.00 owed → NOT marked paid; payout failed, naming the mismatch', pF.length === 1 && pF[0].status === 'failed' && /does not match/.test(pF[0].last_error || '') && (await refPending(accF)) === 1, JSON.stringify(pF));
    const mA = sent.find(m => m.to === 'fal3d-a@finflow.test');
    A('7  A is emailed: "$40.00" sent to their Stripe account', !!mA && /\$40\.00/.test(mA.html || mA.text || '') && /Stripe/.test(mA.html || mA.text || ''), JSON.stringify(sent.map(m => [m.to, m.subject])));

    // 2 — the next run retries D and E; nothing else moves. Stripe keeps an idempotency key for 24 hours only, and a
    // failed payout may be retried later than that — so E's retry happens after Stripe forgot the key: only the
    // transfer_group lookup can stop a second transfer.
    for (const t of transfers) if (t.destination === 'acct_E') t._key = null;
    await app._jobs.referrals();
    A('8  D retried → sent once, $10.00', toDest('acct_D').length === 1 && toDest('acct_D')[0].amount === 1000 && (await refPending(accD)) === 0, JSON.stringify(toDest('acct_D').map(t => t.amount)));
    A('9  E retried → the existing transfer is found and recorded; still ONE transfer (bug without the lookup: 2)', toDest('acct_E').length === 1 && (await refPending(accE)) === 0 && (await q(`SELECT stripe_transfer_id t FROM referral_payouts WHERE accountant_id=$1`, [accE]))[0].t === toDest('acct_E')[0].id, `transfers=${toDest('acct_E').length}`);
    A('9a F is still not marked paid after a retry (the mismatch needs a person), and no second transfer is made', (await refPending(accF)) === 1 && toDest('acct_F').length === 1, `pending=${await refPending(accF)} transfers=${toDest('acct_F').length}`);
    A('9b every transfer call carried an idempotency key', createCalls.length > 0 && createCalls.every(x => typeof x.key === 'string' && x.key.length > 0), JSON.stringify(createCalls.map(x => x.key)));
    const before = transfers.length;
    await app._jobs.referrals();
    await Promise.all([app.runReferralJob(), app.runReferralJob(), app.runReferralJob()]);
    A('10 a third run and 3 concurrent runs (no lock) send nothing more and book nothing more', transfers.length === before && Number((await q(`SELECT COUNT(*) n FROM accountant_earnings WHERE type='referral' AND period_month = date_trunc('month', NOW())`))[0].n) === 8, `transfers ${before} → ${transfers.length}`);

    // 3 — one payout a month: a new booking waits; next month it goes
    const extra = (await q(`INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, description, status, period_month) VALUES ($1, NULL, 'referral', 1000, 'Referral commission — later booking', 'pending', date_trunc('month', NOW())) RETURNING id`, [accA]))[0].id;
    await app.runReferralJob();
    A('11 A was paid this month already → the new $10 waits for next month (one payout a month)', toDest('acct_A').length === 1 && (await refPending(accA)) === 1, `transfers=${toDest('acct_A').length}`);
    await c.query(`UPDATE referral_payouts SET period_month = period_month - interval '1 month' WHERE accountant_id = $1`, [accA]);
    await app.runReferralJob();
    A('12 next month → A gets ONE more transfer of $10.00', toDest('acct_A').length === 2 && toDest('acct_A')[1].amount === 1000 && (await refPending(accA)) === 0, JSON.stringify(toDest('acct_A').map(t => t.amount)));
    A('12b the two transfers have different idempotency keys (a second payout, not a replay)', new Set(createCalls.filter(x => x.p.destination === 'acct_A').map(x => x.key)).size === 2, '');

    // 4 — B becomes ready → paid on the next run
    caps.acct_B = 'active';
    await app.runReferralJob();
    A('13 B finishes Stripe onboarding → paid $10.00 on the next run', toDest('acct_B').length === 1 && toDest('acct_B')[0].amount === 1000 && (await refPending(accB)) === 0, '');

    // 5 — admin "mark paid" cannot pay twice or pay an unpaid bill
    const adm = new HarnessHttp(base, { xff: '10.93.0.1' });
    A('admin login', (await adm.post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status === 200);
    const inPayout = (await q(`SELECT id FROM accountant_earnings WHERE id=$1`, [extra]))[0].id;
    const awaiting = (await q(`SELECT id FROM accountant_earnings WHERE status='awaiting_payment' LIMIT 1`))[0].id;
    const cOnly = (await q(`SELECT id FROM accountant_earnings WHERE accountant_id=$1 AND type='referral' AND status='pending'`, [accC]))[0].id;
    const mp = await adm.post('/api/admin/earnings/mark-paid', { ids: [inPayout, awaiting, cOnly] });
    const st = async (id) => (await q(`SELECT status FROM accountant_earnings WHERE id=$1`, [id]))[0].status;
    A('14 mark-paid: only C\'s $10 (no Stripe — paid by hand) is marked; a transferred row and an unpaid bill are refused (bug: all 3)', mp.status === 200 && (mp.json || {}).updated === 1 && (await st(cOnly)) === 'paid' && (await st(awaiting)) === 'awaiting_payment', `status ${mp.status} ${mp.text.slice(0, 160)}`);

    // 6 — the accountant sees the transfer
    const acc = new HarnessHttp(base, { xff: '10.93.0.2' });
    A('A login', (await acc.post('/api/accountants/login', { email: 'fal3d-a@finflow.test', password: PW })).status === 200);
    const er = (await acc.get('/api/accountants/earnings')).json || {};
    const paidRef = (er.earnings || []).filter(e => e.type === 'referral' && e.status === 'paid');
    A('15 the earnings API shows each paid referral row\'s transfer and when it was sent', paidRef.length === 5 && paidRef.every(e => /^tr_/.test(e.payout_transfer_id || '') && !!e.payout_sent_at), JSON.stringify(paidRef.map(e => [e.amount_cents, e.payout_transfer_id, !!e.payout_sent_at])));

    // 7 — the CRON_SECRET route still works and goes through the same job
    const r = await fetch(base + '/api/accountants/run-monthly-payouts', { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET, 'Content-Type': 'application/json', 'X-Forwarded-For': '10.93.0.3' }, body: '{}' });
    A('16 the manual trigger (CRON_SECRET) runs the same job and sends nothing new', r.status === 200 && transfers.length === toDest('acct_A').length + 4, `status ${r.status} transfers=${transfers.length}`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (server) await new Promise(r => server.close(r)); } catch {} try { if (scratch) await scratch.stop(); } catch {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-L3d referral payouts)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
