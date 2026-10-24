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
const THIS_MONTH = `period_month = date_trunc('month', NOW())::date`;

async function accountantFigures(pool, accountantId) {
  const { rows: [r] } = await pool.query(`
    SELECT COALESCE(SUM(amount_cents) FILTER (WHERE ${EARNED}), 0)::bigint                     AS earned,
           COALESCE(SUM(amount_cents) FILTER (WHERE ${EARNED} AND ${THIS_MONTH}), 0)::bigint   AS this_month,
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
    SELECT COALESCE(SUM(commission_cents) FILTER (WHERE type = 'service_commission' AND status = 'paid'), 0)::bigint AS commission,
           COALESCE(SUM(amount_cents) FILTER (WHERE type = 'referral' AND status = 'pending'), 0)::bigint AS referral_owed,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_out,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'awaiting_payment'), 0)::bigint AS awaiting
      FROM accountant_earnings`);
  return { commissionCollectedCents: Number(r.commission), referralOwedCents: Number(r.referral_owed), paidOutCents: Number(r.paid_out), awaitingClientCents: Number(r.awaiting) };
}

// One accountant's earned total, for the admin detail — the same rule as accountantFigures.
const EARNED_SQL = EARNED;

module.exports = { accountantFigures, platformFigures, EARNED_SQL };
