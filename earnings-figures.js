'use strict';
// FA-L3g (Rule 2): the ONE writer of the accountant-marketplace money figures. Every surface — the accountant's
// dashboard, the admin overview, the admin earnings page and the admin accountant detail — reads these, instead of
// each summing accountant_earnings its own way (six surfaces, six answers, none right).
//
// accountant_earnings.status: 'awaiting_payment' (a bill the client has not paid) · 'pending' (referral pay booked,
// not yet sent) · 'paid'. amount_cents is the ACCOUNTANT's money; commission_cents is FINFLOW's.
//   earned            = referral pay booked + service fees the client paid      (status 'pending' or 'paid')
//   this month        = earned, booked in the current booking month             (period_month; a service fee gets its
//                                                                                month when the client pays)
//   awaiting client   = bills sent, not paid yet — shown apart, never as earned
//   referral owed     = referral pay booked, not yet sent
//   commission        = FinFlow's commission on bills the client PAID           (Σ commission_cents)

const EARNED = `status IN ('pending', 'paid')`;
// FA-L3i: a refunded part of a bill is not earned and earns no commission — every figure counts the KEPT share.
const KEEP = `COALESCE(1 - COALESCE(refunded_cents, 0)::numeric / NULLIF(billed_cents, 0), 1)`;
const kept = col => `ROUND(${col} * ${KEEP})`;
const THIS_MONTH = `period_month = date_trunc('month', NOW())::date`;

async function accountantFigures(pool, accountantId) {
  const { rows: [r] } = await pool.query(`
    SELECT COALESCE(SUM(${kept('amount_cents')}) FILTER (WHERE ${EARNED}), 0)::bigint                     AS earned,
           COALESCE(SUM(${kept('amount_cents')}) FILTER (WHERE ${EARNED} AND ${THIS_MONTH}), 0)::bigint   AS this_month,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'awaiting_payment'), 0)::bigint   AS awaiting,
           COALESCE(SUM(amount_cents) FILTER (WHERE type = 'referral' AND status = 'pending'), 0)::bigint AS referral_owed,
           date_trunc('month', NOW())::date AS current_period
      FROM accountant_earnings WHERE accountant_id = $1`, [accountantId]);
  return {
    earnedCents: Number(r.earned), thisMonthCents: Number(r.this_month), awaitingClientCents: Number(r.awaiting),
    referralOwedCents: Number(r.referral_owed), currentPeriod: r.current_period,
  };
}

async function platformFigures(pool) {
  const { rows: [r] } = await pool.query(`
    SELECT COALESCE(SUM(${kept('commission_cents')}) FILTER (WHERE type = 'service_commission' AND status = 'paid'), 0)::bigint AS commission,
           COALESCE(SUM(amount_cents) FILTER (WHERE type = 'referral' AND status = 'pending'), 0)::bigint AS referral_owed,
           COALESCE(SUM(${kept('amount_cents')}) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_out,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'awaiting_payment'), 0)::bigint AS awaiting
      FROM accountant_earnings`);
  return { commissionCollectedCents: Number(r.commission), referralOwedCents: Number(r.referral_owed), paidOutCents: Number(r.paid_out), awaitingClientCents: Number(r.awaiting) };
}

// One accountant's earned total, for the admin detail — the same rule as accountantFigures.
const EARNED_SQL = EARNED;

// FA-L3i: Stripe says how much of a bill's charge went back (refund: cumulative amount_refunded; lost dispute: the
// disputed amount). Recorded as the cumulative refunded part — a replay or an older event never lowers it; all of it
// back → 'refunded'. Returns the rows changed (0 = not an accountant bill).
async function recordEarningRefund(pool, paymentIntentId, refundedMinor) {
  if (!paymentIntentId || !(Number(refundedMinor) > 0)) return 0;
  const { rowCount } = await pool.query(`
    UPDATE accountant_earnings
       SET refunded_cents = LEAST(COALESCE(billed_cents, amount_cents), GREATEST(COALESCE(refunded_cents, 0), $2::int)),
           status = CASE WHEN GREATEST(COALESCE(refunded_cents, 0), $2::int) >= COALESCE(billed_cents, amount_cents) THEN 'refunded' ELSE status END
     WHERE payment_intent_id = $1 AND type = 'service_commission' AND status IN ('paid', 'refunded')`, [paymentIntentId, Math.round(Number(refundedMinor))]);
  return rowCount;
}

module.exports = { accountantFigures, platformFigures, EARNED_SQL, recordEarningRefund };
