'use strict';
/**
 * seed.js — reset-and-reseed the scratch cluster with VERIFICATION.md's dataset.
 *
 * PRINCIPLES
 *   · Real INSERTs against the real schema. No stub, no fixture loader, no ORM (F77, Rule 3).
 *   · Every date written EXPLICITLY, including created_at. Postgres NOW() is the real wall
 *     clock — unaffected by the pinned node clock — so any DEFAULT NOW() column would drift
 *     out of its intended period as real time advances (Rule 10).
 *   · Every status passes the vocabulary gate BEFORE it reaches the database, because the
 *     database has no CHECK to reject it (F79).
 *   · TRUNCATE only after the scratch marker is confirmed present (guard.assertMarkerPresent).
 *
 * WHY DIRECT SQL RATHER THAN THE REAL POST ENDPOINTS
 *   The endpoints cannot set the dates this seed requires. `POST /api/invoices` stores
 *   issue_date but created_at is `DEFAULT NOW()`; `POST /api/payroll-runs` hardcodes
 *   `run_date = NOW()` (server.js:3822) with no way to override it — that is F85. A seed built
 *   through the endpoints could not place a single row in May or June.
 *
 *   This is a REAL, DECLARED limitation, not a quiet substitution: the seed exercises the
 *   schema, not the write paths. The write paths are Part B's job, and Part B drives the real
 *   buttons. Stating it plainly so no one later cites a green Part A as evidence that invoice
 *   creation works.
 */

const guard = require('./guard.js');
const { assertStatus } = require('./vocabulary.js');
const D = require('./seedData.js');

// Every table the harness touches. Truncated together, identity restarted, so ids are stable
// run to run and a figure can never be explained by a leftover row.
const SEEDED_TABLES = [
  'invoices', 'expenses', 'bills', 'customers', 'inventory', 'payroll', 'holdings',
  'entities', 'user_settings', 'payments_made', 'payments_received', 'sales_receipts',
  'invoice_payments', 'payroll_runs', 'payroll_run_lines', 'inventory_movements',
  'fx_rates', 'fx_transactions', 'audit_trail', 'vendors', 'items', 'journals',
];

/** ISO timestamp for a local YYYY-MM-DD at midday, so a timezone slip cannot cross a day. */
function localNoonUtc(ymd) {
  // Owner is GMT-4; midday local = 16:00Z. Midday specifically: a date written at 00:00 local
  // would be 04:00Z the same day, but a date written at 20:00 local lands on the NEXT day in
  // UTC — the Rule 10 boundary. Midday is the furthest point from both edges.
  return `${ymd}T16:00:00.000Z`;
}

/**
 * Wipe every seeded table. Requires the scratch marker (guard) — a database the harness did
 * not create and stamp is never truncated.
 */
async function reset(client) {
  await guard.assertMarkerPresent(client);
  const list = SEEDED_TABLES.map((t) => `"${t}"`).join(', ');
  await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/** Insert into a generic JSONB table with an explicit created_at/updated_at. */
async function insertJson(client, table, userId, entityId, dateYmd, data) {
  const ts = localNoonUtc(dateYmd);
  const { rows } = await client.query(
    `INSERT INTO ${table} (user_id, entity_id, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz) RETURNING id`,
    [userId, entityId, data, ts]
  );
  return rows[0].id;
}

async function seed(client, userId) {
  await reset(client);

  const ids = { invoices: {}, bills: {}, runs: {}, customers: {} };

  // ── Entity ─────────────────────────────────────────────────────────────────
  const entityId = await insertJson(client, 'entities', userId, null, '2026-01-01', {
    name: D.ENTITY.name, currency: D.ENTITY.currency, color: '#c9a84c', is_active: 1, sort_order: 0,
  });

  // ── Settings: fiscal year January, USD ─────────────────────────────────────
  // VERIFICATION Environment: "fiscal year starting January", "currency USD".
  await insertJson(client, 'user_settings', userId, entityId, '2026-01-01', {
    fiscal_year_start: 0, currency: 'USD', date_format: 'YYYY-MM-DD',
  });

  // ── Customers ──────────────────────────────────────────────────────────────
  for (const c of D.CUSTOMERS) {
    ids.customers[c.key] = await insertJson(client, 'customers', userId, entityId, '2026-01-02', {
      fname: c.fname, lname: c.lname, company: c.company, email: c.email,
      phone: '', industry: '', revenue: 0, status: 'active', notes: '',
    });
  }

  // ── Invoices ───────────────────────────────────────────────────────────────
  for (const inv of D.INVOICES) {
    const status = assertStatus('invoice', inv.status, inv.key);
    ids.invoices[inv.key] = await insertJson(client, 'invoices', userId, entityId, inv.issue_date, {
      client: inv.client,
      amount: inv.amount,
      amount_paid: inv.amount_paid,
      status,
      issue_date: inv.issue_date,
      due_date: inv.issue_date,
      notes: `seed ${inv.key}`,
      num: inv.key,
    });
  }

  // ── Invoice payments (money in) ────────────────────────────────────────────
  for (const p of D.INVOICE_PAYMENTS) {
    await client.query(
      `INSERT INTO invoice_payments (user_id, entity_id, invoice_id, amount, payment_date, method, reference, notes, created_at)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9::timestamptz)`,
      [userId, entityId, ids.invoices[p.invoice], p.amount, p.date,
       'Bank Transfer', `seed-${p.invoice}`, 'seed', localNoonUtc(p.date)]
    );
  }

  // ── Bills ──────────────────────────────────────────────────────────────────
  for (const b of D.BILLS) {
    const status = assertStatus('bill', b.status, b.key);
    ids.bills[b.key] = await insertJson(client, 'bills', userId, entityId, b.issue_date, {
      vendor: b.vendor,
      amount: b.amount,
      amount_paid: b.amount_paid,
      status,
      issue_date: b.issue_date,
      due_date: b.issue_date,
      num: b.key,
      notes: `seed ${b.key}`,
    });
  }

  // ── Payments made (money out) — bill_id LINKED, see seedData.js ────────────
  for (const p of D.PAYMENTS_MADE) {
    const billId = ids.bills[p.bill];
    if (billId == null) throw new Error(`[seed] payment references unknown bill "${p.bill}"`);
    await insertJson(client, 'payments_made', userId, entityId, p.date, {
      vendor: p.vendor,
      amount: p.amount,
      date: p.date,
      method: p.method,
      notes: `seed payment for ${p.bill}`,
      ref: `PM-${p.bill}`,
      bill_id: billId,        // ← the sole double-count guard (server.js:4111)
    });
  }

  // ── Manual expenses ────────────────────────────────────────────────────────
  for (const e of D.EXPENSES) {
    await insertJson(client, 'expenses', userId, entityId, e.date, {
      description: e.description, category: e.category, amount: e.amount,
      deductible: 'yes', expense_date: e.date,
    });
  }

  // ── Payroll roster (template — must contribute ZERO under basis C) ─────────
  for (const r of D.ROSTER) {
    await insertJson(client, 'payroll', userId, entityId, '2026-01-03', {
      fname: r.fname, lname: r.lname, role: r.role, emp_type: 'Full-time',
      gross: r.gross, deductions: [], av_class: 'av-blue', is_owner: r.is_owner,
    });
  }

  // ── Payroll runs + lines (typed tables, explicit run_date) ─────────────────
  for (const run of D.PAYROLL_RUNS) {
    const status = assertStatus('payroll_run', run.status, run.key);
    const total = run.lines.reduce((s, l) => s + l.gross, 0);
    const { rows } = await client.query(
      `INSERT INTO payroll_runs
         (user_id, entity_id, period, jurisdiction, run_date, status,
          total_gross, total_deductions, total_net, notes, created_at)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11::timestamptz) RETURNING id`,
      [userId, entityId, run.period, 'TT', run.run_date, status,
       total, 0, total, `seed ${run.key}`, localNoonUtc(run.run_date)]
    );
    ids.runs[run.key] = rows[0].id;
    for (const l of run.lines) {
      await client.query(
        `INSERT INTO payroll_run_lines
           (run_id, payroll_id, employee_name, gross, bonus, overtime, deductions, net_pay)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [rows[0].id, null, `Seed ${run.key}`, l.gross, 0, 0, JSON.stringify([]), l.gross]
      );
    }
  }

  // ── Inventory + FIFO movements ─────────────────────────────────────────────
  const itemId = await insertJson(client, 'inventory', userId, entityId, '2025-11-01', {
    sku: D.INVENTORY_ITEM.sku, name: D.INVENTORY_ITEM.name,
    units: D.INVENTORY_ITEM.units, max_units: D.INVENTORY_ITEM.max_units,
    cost: D.INVENTORY_ITEM.cost, low_stock: 0,
  });

  const movement = (type, m) => client.query(
    `INSERT INTO inventory_movements
       (user_id, entity_id, inventory_id, type, quantity, unit_cost, reference, notes, moved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,
    [userId, entityId, itemId, type, m.qty, m.unit_cost != null ? m.unit_cost : null,
     m.key, `seed ${m.key}`, localNoonUtc(m.date)]
  );
  for (const p of D.PURCHASES) await movement('purchase', p);
  for (const s of D.SALES) await movement('sale', s);

  // ── Holdings (business scope — entity_id set; see seedData.js) ─────────────
  for (const h of D.HOLDINGS) {
    await insertJson(client, 'holdings', userId, entityId, '2026-01-04', {
      ticker: h.ticker, name: h.name, asset_type: h.asset_type,
      shares: h.shares, cost_per: h.cost_per, price: h.price,
      dividend: 0, color: '#c9a84c',
    });
  }

  return { entityId, ids };
}

module.exports = { seed, reset, SEEDED_TABLES, localNoonUtc };
