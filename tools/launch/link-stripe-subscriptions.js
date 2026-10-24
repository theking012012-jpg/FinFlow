'use strict';
/**
 * link-stripe-subscriptions.js — FA-S1 (2026-10-23) data step, PREPARED, OWNER-RUN (Rule 8). DRY RUN BY DEFAULT.
 *
 * Accounts that subscribed BEFORE the FA-S1 fix have no Stripe subscription / customer id stored, because their
 * subscription events carried no user id. For them, deleting the account cannot cancel billing, and a cancellation or
 * failed payment in Stripe never reaches FinFlow. This tool finds each FinFlow subscription in Stripe and links it to
 * its account by the Checkout metadata (userId) or, failing that, by the customer's e-mail.
 *
 *   PowerShell (a NEW window; never paste keys or URLs into chat):
 *     $env:DATABASE_URL="<prod url>"; $env:STRIPE_SECRET_KEY="<live secret key>"
 *     node tools/launch/link-stripe-subscriptions.js                   # dry run: lists, changes NOTHING
 *     node tools/launch/link-stripe-subscriptions.js --apply --expect N  # N = "to link" from the dry run
 *     Remove-Item Env:DATABASE_URL; Remove-Item Env:STRIPE_SECRET_KEY
 *
 * Only accounts with NO stripe_subscription_id are touched; an account already linked is never changed. An e-mail
 * that matches more than one account, or a subscription matching no account, is LISTED and never linked (owner
 * decides). --apply refuses unless --expect equals the number to link now; one transaction, all or nothing; each link
 * writes one audit_trail row (users · UPDATE · actor system). It also tags the Stripe subscription's metadata with the
 * user id (so future events carry it) — only on --apply. Imports only `pg` and `stripe` — no database.js (Rule 7).
 */
const { Client } = require('pg');

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ei = args.indexOf('--expect');
  const expect = ei >= 0 ? parseInt(args[ei + 1], 10) : null;
  if (!process.env.DATABASE_URL || !process.env.STRIPE_SECRET_KEY) {
    console.error('usage: DATABASE_URL=... STRIPE_SECRET_KEY=... node tools/launch/link-stripe-subscriptions.js [--apply --expect N]'); process.exit(2);
  }
  // LINK_TOOL_STRIPE_STUB: the harness (verify-fas1-link-tool) points this at a stand-in for the Stripe API.
  const stripe = require(process.env.LINK_TOOL_STRIPE_STUB || 'stripe')(process.env.STRIPE_SECRET_KEY);
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    await c.connect();
    const subs = [];
    for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] })) subs.push(s);
    const { rows: users } = await c.query(`SELECT id, lower(data->>'email') AS email, data->>'stripe_subscription_id' AS sub FROM users`);
    const byId = new Map(users.map(u => [String(u.id), u]));
    const byEmail = new Map();
    for (const u of users) { if (!u.email) continue; byEmail.set(u.email, (byEmail.get(u.email) || []).concat(u)); }
    const linkedSubs = new Set(users.map(u => u.sub).filter(Boolean));
    const plan = [], unmatched = [], ambiguous = [];
    for (const s of subs) {
      if (linkedSubs.has(s.id)) continue;
      const cus = s.customer && typeof s.customer === 'object' ? s.customer : { id: s.customer };
      let u = s.metadata && s.metadata.userId ? byId.get(String(s.metadata.userId)) : null;
      if (!u) {
        const hits = byEmail.get(String(cus.email || '').toLowerCase()) || [];
        if (hits.length > 1) { ambiguous.push({ sub: s.id, email: cus.email, accounts: hits.map(h => h.id) }); continue; }
        u = hits[0] || null;
      }
      if (!u) { unmatched.push({ sub: s.id, status: s.status, email: cus.email || null }); continue; }
      if (u.sub) continue;   // that account already has a subscription linked — never overwritten
      plan.push({ user: u.id, email: u.email, sub: s.id, customer: cus.id, status: s.status });
    }
    console.log(`Stripe subscriptions: ${subs.length} · already linked: ${subs.filter(s => linkedSubs.has(s.id)).length}`);
    console.log(`to link: ${plan.length}`); plan.forEach(p => console.log(`  user ${p.user} <${p.email}>  ←  ${p.sub} (${p.status}, ${p.customer})`));
    console.log(`not linked — e-mail matches several accounts (owner decides): ${ambiguous.length}`); ambiguous.forEach(a => console.log('  ' + JSON.stringify(a)));
    console.log(`not linked — no matching account: ${unmatched.length}`); unmatched.forEach(a => console.log('  ' + JSON.stringify(a)));
    if (!apply) { console.log('\nDRY RUN — nothing changed. To link: --apply --expect ' + plan.length); return; }
    if (expect !== plan.length) { console.error(`REFUSED: --expect ${expect} but ${plan.length} to link now. Re-run the dry run.`); process.exit(3); }
    await c.query('BEGIN');
    for (const p of plan) {
      await c.query(`UPDATE users SET data = data || jsonb_build_object('stripe_subscription_id', $2::text, 'stripe_customer_id', $3::text, 'subscriptionStatus', $4::text) WHERE id = $1 AND data->>'stripe_subscription_id' IS NULL`, [p.user, p.sub, p.customer, p.status]);
      await c.query(`INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, field_name, old_value, new_value, actor_type, actor_id, new_data)
                     VALUES ($1, NULL, 'users', $1, 'UPDATE', 'stripe_subscription_id', NULL, $2, 'system', NULL, $3)`,
        [p.user, p.sub, JSON.stringify({ stripe_subscription_id: p.sub, stripe_customer_id: p.customer, reason: 'FA-S1 link' })]);
    }
    await c.query('COMMIT');
    for (const p of plan) { try { await stripe.subscriptions.update(p.sub, { metadata: { userId: String(p.user) } }); } catch (e) { console.error(`  tag ${p.sub} failed (link kept): ${e.message}`); } }
    console.log(`\nAPPLIED — linked ${plan.length}.`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    console.error('FAILED, nothing applied:', e.message, e.code || '', e.stack); process.exit(1);
  } finally { await c.end(); }
})();
