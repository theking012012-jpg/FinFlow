'use strict';
// FA-L3d (owner decision 2026-10-24): referral pay is BOOKED in-app every month and SENT to each accountant's
// connected Stripe account by a Stripe Connect transfer. Before, booking happened only if something outside the
// app called POST /api/accountants/run-monthly-payouts (nothing did), and paying was an admin marking rows 'paid'.
//
// One writer each:
//   bookReferralMonth  — books at most one $10 month per client link per calendar month, only while the client
//                        is paying (N79: row lock + one-per-month check). Used by link activation and the job.
//   payAccountant      — one payout per accountant per calendar month (UNIQUE accountant_id, period_month), at most
//                        one unfinished payout per accountant (partial unique index). The payout is CLAIMED in the
//                        database before Stripe is called; the transfer carries an idempotency key and a
//                        transfer_group, and a retry first looks the group up in Stripe — so a lost reply, a crash
//                        or a second replica can never send twice (Rule 9: idempotency at the write).
// Accounting dates: period_month is the DB's calendar month (date_trunc('month', NOW())), never the viewer's.

const REFERRAL_MONTHLY_CENTS = 1000;          // $10 a month per active, paying client (tier-config: the months)
const PAYOUT_CURRENCY = 'usd';
const STALE_CLAIM = "interval '10 minutes'";  // a claim older than this died mid-send; the retry looks it up first

async function bookReferralMonth(conn, accountantId, userId) {
  const { rows: [link] } = await conn.query(
    `SELECT ac.referral_month, ac.referral_months_total, ac.status, u.data->>'subscriptionStatus' AS sub
       FROM accountant_clients ac JOIN users u ON u.id = ac.user_id
      WHERE ac.accountant_id = $1 AND ac.user_id = $2
      FOR UPDATE OF ac`, [accountantId, userId]);
  if (!link || link.status !== 'active' || link.sub !== 'active') return false;
  if (!(Number(link.referral_month) < Number(link.referral_months_total))) return false;
  const { rows: [dup] } = await conn.query(
    `SELECT 1 FROM accountant_earnings
      WHERE accountant_id = $1 AND client_id = $2 AND type = 'referral'
        AND period_month = date_trunc('month', NOW()) LIMIT 1`, [accountantId, userId]);
  if (dup) return false;
  const nextMonth = Number(link.referral_month) + 1;
  await conn.query(
    `INSERT INTO accountant_earnings (accountant_id, client_id, type, amount_cents, description, period_month)
     VALUES ($1, $2, 'referral', $4, $3, date_trunc('month', NOW()))`,
    [accountantId, userId, `Referral commission — month ${nextMonth} of ${link.referral_months_total}`, REFERRAL_MONTHLY_CENTS]);
  await conn.query(`UPDATE accountant_clients SET referral_month = $1 WHERE accountant_id = $2 AND user_id = $3`, [nextMonth, accountantId, userId]);
  return true;
}

// Every active link with months left and a paying client, each in its own transaction (one failing row does not
// stop the others; a re-run or an overlapping run books nothing twice).
async function bookAllReferralMonths(pool) {
  const client = await pool.connect();
  let booked = 0;
  try {
    const { rows } = await client.query(`
      SELECT ac.accountant_id, ac.user_id FROM accountant_clients ac JOIN users u ON u.id = ac.user_id
       WHERE ac.status = 'active' AND ac.referral_month < ac.referral_months_total
         AND u.data->>'subscriptionStatus' = 'active'`);
    for (const row of rows) {
      try {
        await client.query('BEGIN');
        if (await bookReferralMonth(client, row.accountant_id, row.user_id)) booked++;
        await client.query('COMMIT');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('[referral] booking link', row.accountant_id, row.user_id, 'failed:', e.message);
      }
    }
    const { rows: [sk] } = await client.query(`
      SELECT COUNT(*)::int AS n FROM accountant_clients ac JOIN users u ON u.id = ac.user_id
       WHERE ac.status = 'active' AND ac.referral_month < ac.referral_months_total
         AND u.data->>'subscriptionStatus' IS DISTINCT FROM 'active'`);
    return { booked, skippedNotPaying: sk.n };
  } finally { client.release(); }
}

// Can this connected account receive a transfer right now?
async function transfersReady(stripe, accountId) {
  try {
    const a = await stripe.accounts.retrieve(accountId);
    const cap = a && a.capabilities && a.capabilities.transfers;
    return cap === 'active' ? { ok: true } : { ok: false, why: 'Stripe has not enabled transfers to this account yet (' + (cap || 'not requested') + ')' };
  } catch (e) { return { ok: false, why: 'Could not check the Stripe account: ' + e.message }; }
}

// Claim (or re-claim) this accountant's payout in the database. Returns the payout row, or null when there is
// nothing to send (no pending referral pay, already paid this month, or another run is sending it now).
async function claimPayout(pool, accountantId) {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: [open] } = await conn.query(
      `SELECT id, status, (status = 'claimed' AND updated_at > NOW() - ${STALE_CLAIM}) AS in_flight
         FROM referral_payouts WHERE accountant_id = $1 AND status IN ('claimed', 'failed') FOR UPDATE`, [accountantId]);
    let payout = null;
    if (open) {
      if (!open.in_flight) {
        payout = (await conn.query(`UPDATE referral_payouts SET status = 'claimed', attempts = attempts + 1, updated_at = NOW() WHERE id = $1 RETURNING *`, [open.id])).rows[0];
      }
    } else {
      const { rows: due } = await conn.query(
        `SELECT id, amount_cents FROM accountant_earnings
          WHERE accountant_id = $1 AND type = 'referral' AND status = 'pending' AND payout_id IS NULL
          ORDER BY id FOR UPDATE`, [accountantId]);
      const total = due.reduce((s, r) => s + Number(r.amount_cents || 0), 0);
      if (due.length && total > 0) {
        const ins = await conn.query(
          `INSERT INTO referral_payouts (accountant_id, period_month, amount_cents, currency)
           VALUES ($1, date_trunc('month', NOW()), $2, $3)
           ON CONFLICT DO NOTHING RETURNING *`, [accountantId, total, PAYOUT_CURRENCY]);
        payout = ins.rows[0] || null;      // a conflict = this month's payout already exists → next month
        if (payout) await conn.query(`UPDATE accountant_earnings SET payout_id = $1 WHERE id = ANY($2::int[])`, [payout.id, due.map(r => r.id)]);
      }
    }
    await conn.query('COMMIT');
    return payout;
  } catch (e) {
    try { await conn.query('ROLLBACK'); } catch (_) {}
    if (e.code === '23505') return null;  // another run claimed it first (one open payout per accountant)
    throw e;
  } finally { conn.release(); }
}

async function payAccountant(pool, stripe, acc, hooks) {
  hooks = hooks || {};
  if (!acc.stripe_account_id) return { accountantId: acc.id, status: 'waiting', why: 'No Stripe account connected' };
  const ready = await transfersReady(stripe, acc.stripe_account_id);
  if (!ready.ok) return { accountantId: acc.id, status: 'waiting', why: ready.why };
  const payout = await claimPayout(pool, acc.id);
  if (!payout) return { accountantId: acc.id, status: 'nothing' };
  const group = 'referral-payout-' + payout.id;
  try {
    // A previous attempt may have made the transfer and lost the reply: look before sending.
    const listed = await stripe.transfers.list({ transfer_group: group, limit: 1 });
    let tr = (listed && listed.data && listed.data[0]) || null;
    if (!tr) {
      tr = await stripe.transfers.create({
        amount: payout.amount_cents, currency: payout.currency, destination: acc.stripe_account_id, transfer_group: group,
        description: 'FinFlow referral pay',
        metadata: { kind: 'referral_payout', payout_id: String(payout.id), accountant_id: String(acc.id) },
      }, { idempotencyKey: group });
    }
    if (Number(tr.amount) !== Number(payout.amount_cents) || tr.destination !== acc.stripe_account_id) {
      // Never mark paid on a transfer that does not match what we owe — that is a finding, not a payment.
      throw new Error('Stripe transfer ' + tr.id + ' does not match payout ' + payout.id + ' (' + tr.amount + ' to ' + tr.destination + ')');
    }
    await pool.query(`UPDATE referral_payouts SET status = 'sent', stripe_transfer_id = $2, sent_at = NOW(), updated_at = NOW(), last_error = NULL WHERE id = $1`, [payout.id, tr.id]);
    await pool.query(`UPDATE accountant_earnings SET status = 'paid' WHERE payout_id = $1`, [payout.id]);
    const result = { accountantId: acc.id, status: 'sent', payoutId: payout.id, amountCents: payout.amount_cents, transferId: tr.id };
    if (hooks.audit) { try { await hooks.audit(result); } catch (e) { console.error('[referral] audit failed:', e.message); } }
    if (hooks.notify) { try { await hooks.notify(acc, result); } catch (e) { console.error('[referral] payout email failed:', e.message); } }
    return result;
  } catch (e) {
    const why = String((e && e.message) || e).slice(0, 300);
    await pool.query(`UPDATE referral_payouts SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1`, [payout.id, why]);
    console.error('[referral] payout', payout.id, 'to accountant', acc.id, 'failed:', why);
    return { accountantId: acc.id, status: 'failed', payoutId: payout.id, why };
  }
}

async function payAllAccountants(pool, stripe, hooks) {
  const { rows } = await pool.query(`
    SELECT a.id, a.email, a.first_name, a.stripe_account_id FROM accountants a
     WHERE EXISTS (SELECT 1 FROM accountant_earnings e WHERE e.accountant_id = a.id AND e.type = 'referral' AND e.status = 'pending')
     ORDER BY a.id`);
  const out = [];
  for (const acc of rows) {
    try { out.push(await payAccountant(pool, stripe, acc, hooks)); }
    catch (e) { console.error('[referral] payout for accountant', acc.id, 'failed:', e.message); out.push({ accountantId: acc.id, status: 'failed', why: e.message }); }
  }
  return out;
}

async function runReferralJob(pool, stripe, hooks) {
  const booking = await bookAllReferralMonths(pool);
  const payouts = stripe ? await payAllAccountants(pool, stripe, hooks) : [];
  const count = s => payouts.filter(p => p.status === s).length;
  return { booked: booking.booked, skippedNotPaying: booking.skippedNotPaying, sent: count('sent'), waiting: count('waiting'), failed: count('failed'), payouts, stripeConfigured: !!stripe };
}

// The audit row and the accountant's e-mail for a sent payout — one writer each, shared by the hourly job and the
// CRON_SECRET route.
function hooksFor({ pool, recordAudit, resendClient }) {
  return {
    audit: async (r) => {
      if (typeof recordAudit !== 'function') return;
      await recordAudit(pool, { userId: null, table: 'referral_payouts', recordId: r.payoutId, action: 'REFERRAL_PAYOUT_SENT',
        newData: { accountant_id: r.accountantId, amount_cents: r.amountCents, stripe_transfer_id: r.transferId } });
    },
    notify: async (acc, r) => {
      if (!resendClient || !acc.email) return;
      const { emailHtml } = require('./email-html');
      const amount = '$' + (r.amountCents / 100).toFixed(2);
      await resendClient.emails.send({
        from: process.env.EMAIL_FROM || 'FinFlow <noreply@finflow.app>',
        to: acc.email,
        subject: `FinFlow sent you ${amount} in referral pay`,
        html: String(emailHtml`<p>Hi ${acc.first_name || 'there'},</p>
<p>We have sent <strong>${amount}</strong> of referral pay to your Stripe account (transfer ${r.transferId}).</p>
<p>Stripe pays it into your bank on your usual Stripe payout schedule. Every payout is listed under Earnings in your FinFlow dashboard.</p>`),
      });
    },
  };
}

module.exports = { REFERRAL_MONTHLY_CENTS, bookReferralMonth, bookAllReferralMonths, payAccountant, payAllAccountants, runReferralJob, hooksFor };
