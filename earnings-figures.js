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

// FA-L3e: bills can be in the client's currency, so EVERY figure is per currency — amounts in different currencies are
// never added together. The top-level *Cents fields are the USD figures (back-compat for callers that only know USD);
// byCurrency has every currency; formatted is the display string ("$120.00 + JMD 12,000.00"), the ONE formatter.
const units = require('./stripe-units');
function fmtMinor(minor, cur) {
  const c = String(cur || 'usd').toUpperCase();
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(units.minorToMajor(minor, c)); }
  catch (_) { return c + ' ' + units.minorToMajor(minor, c).toFixed(units.currencyExponent(c)); }
}
function fmtList(rows, key) {
  const parts = rows.filter(r => Number(r[key])).sort((x, y) => (x.currency === 'usd' ? -1 : y.currency === 'usd' ? 1 : x.currency.localeCompare(y.currency))).map(r => fmtMinor(Number(r[key]), r.currency));
  return parts.length ? parts.join(' + ') : fmtMinor(0, 'usd');
}
const usdOf = (rows, key) => Number((rows.find(r => r.currency === 'usd') || {})[key] || 0);

async function accountantFigures(pool, accountantId) {
  const { rows } = await pool.query(`
    SELECT lower(currency) AS currency,
           COALESCE(SUM(${kept('amount_cents')}) FILTER (WHERE ${EARNED}), 0)::bigint                     AS earned,
           COALESCE(SUM(${kept('amount_cents')}) FILTER (WHERE ${EARNED} AND ${THIS_MONTH}), 0)::bigint   AS this_month,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'awaiting_payment'), 0)::bigint   AS awaiting,
           COALESCE(SUM(amount_cents) FILTER (WHERE type = 'referral' AND status = 'pending'), 0)::bigint AS referral_owed
      FROM accountant_earnings WHERE accountant_id = $1 GROUP BY lower(currency)`, [accountantId]);
  const { rows: [p] } = await pool.query(`SELECT date_trunc('month', NOW())::date AS current_period`);
  return {
    earnedCents: usdOf(rows, 'earned'), thisMonthCents: usdOf(rows, 'this_month'), awaitingClientCents: usdOf(rows, 'awaiting'),
    referralOwedCents: usdOf(rows, 'referral_owed'), currentPeriod: p.current_period,
    byCurrency: rows.map(r => ({ currency: r.currency, earnedCents: Number(r.earned), thisMonthCents: Number(r.this_month), awaitingClientCents: Number(r.awaiting), referralOwedCents: Number(r.referral_owed) })),
    formatted: { earned: fmtList(rows, 'earned'), thisMonth: fmtList(rows, 'this_month'), awaiting: rows.some(r => Number(r.awaiting)) ? fmtList(rows, 'awaiting') : null, referralOwed: fmtList(rows, 'referral_owed') },
  };
}

async function platformFigures(pool) {
  const { rows } = await pool.query(`
    SELECT lower(currency) AS currency,
           COALESCE(SUM(${kept('commission_cents')}) FILTER (WHERE type = 'service_commission' AND status = 'paid'), 0)::bigint AS commission,
           COALESCE(SUM(amount_cents) FILTER (WHERE type = 'referral' AND status = 'pending'), 0)::bigint AS referral_owed,
           COALESCE(SUM(${kept('amount_cents')}) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_out,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'awaiting_payment'), 0)::bigint AS awaiting
      FROM accountant_earnings GROUP BY lower(currency)`);
  return {
    commissionCollectedCents: usdOf(rows, 'commission'), referralOwedCents: usdOf(rows, 'referral_owed'), paidOutCents: usdOf(rows, 'paid_out'), awaitingClientCents: usdOf(rows, 'awaiting'),
    byCurrency: rows.map(r => ({ currency: r.currency, commissionCollectedCents: Number(r.commission), referralOwedCents: Number(r.referral_owed), paidOutCents: Number(r.paid_out), awaitingClientCents: Number(r.awaiting) })),
    formatted: { commission: fmtList(rows, 'commission'), referralOwed: fmtList(rows, 'referral_owed'), paidOut: fmtList(rows, 'paid_out'), awaiting: fmtList(rows, 'awaiting') },
  };
}

// FA-L3e: an accountant's earned / paid totals per currency, formatted — for the admin list and detail (the same
// EARNED rule as accountantFigures). Returns Map(accountantId → { earned, paid }) of display strings.
async function accountantTotalsFormatted(pool, accountantIds) {
  const ids = (accountantIds || []).map(Number).filter(Number.isInteger);
  const out = new Map(ids.map(id => [id, { earned: fmtMinor(0, 'usd'), paid: fmtMinor(0, 'usd') }]));
  if (!ids.length) return out;
  const { rows } = await pool.query(`
    SELECT accountant_id, lower(currency) AS currency,
           COALESCE(SUM(${kept('amount_cents')}) FILTER (WHERE ${EARNED}), 0)::bigint AS earned,
           COALESCE(SUM(${kept('amount_cents')}) FILTER (WHERE status = 'paid'), 0)::bigint AS paid
      FROM accountant_earnings WHERE accountant_id = ANY($1::int[]) GROUP BY accountant_id, lower(currency)`, [ids]);
  for (const id of ids) { const mine = rows.filter(r => Number(r.accountant_id) === id); out.set(id, { earned: fmtList(mine, 'earned'), paid: fmtList(mine, 'paid') }); }
  return out;
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

module.exports = { accountantFigures, platformFigures, accountantTotalsFormatted, EARNED_SQL, recordEarningRefund, fmtMinor, fmtList };
