# FinFlow — Postgres Row-Level Security (RLS) Design

_Design only — no code shipped. This de-risks the RLS pass so it can be done fast and safely later._
_Written 2026-09-14 against the real query path (`database.js`)._

## Goal

Defense-in-depth tenant isolation **at the database**, so a route that ever forgets its
`ownedBy(...)` / `WHERE user_id` guard still cannot read or write another tenant's rows. This sits
*on top of* the app-layer isolation that `verify-tenant-isolation` (47/0) already proves — it is a
second wall, not a replacement.

## The hard constraint (why this isn't a one-liner)

- The app connects through the **Supabase session pooler** with `new Pool({ max: 10 })`, and every
  runtime query is a bare `pool.query(...)` — a **fresh connection checkout, autocommit, no
  per-request transaction** (`db.updateById/deleteById/allByUser/insert` all do this).
- RLS policies need to know "who is the current user" per query. The usual lever is a GUC
  (`current_setting('app.uid')`). But:
  - `SET app.uid = …` (session-level) on a **pooled** connection **leaks** to the next request that
    reuses that connection — a correctness *and* security bug.
  - `SET LOCAL` / `set_config('app.uid', …, true)` (transaction-local) is safe, but only exists
    inside a **transaction** — which the current autocommit `pool.query` path doesn't have.
- **Ownership gotcha:** the app role *owns* these tables (it runs `CREATE/ALTER` in `initDB`). A table
  owner **bypasses RLS by default**. So RLS does nothing until we also `ALTER TABLE … FORCE ROW LEVEL
  SECURITY` — and the moment we do, the app's *own* queries are subject to policy, so if the GUC isn't
  set every query returns **empty**. This is the single biggest footgun: enabling FORCE without the
  context plumbing = instant app-wide "no data".

## Approach (recommended)

**Request-scoped DB context via a transaction wrapper + AsyncLocalStorage.**

1. **Context capture (middleware).** After session resolution, store the effective tenant id in an
   `AsyncLocalStorage` store: `{ uid }`. For **owner** sessions `uid = req.session.userId`. For
   **accountant** sessions this is the subtle part — see "Accountant dimension" below.
2. **Scoped execution.** Replace the bare `pool.query` used by `db.*` with a helper that, per logical
   operation, checks out one client and runs:
   ```
   BEGIN;
   SELECT set_config('app.uid', $uid, true);   -- transaction-local, cannot leak
   <the actual statement(s)>;
   COMMIT;
   ```
   Multi-statement operations (e.g. `updateById` does SELECT-then-UPDATE) run on the **same** client
   inside the **same** transaction so the GUC and the read/write are consistent.
3. **Policies.** For each tenant table:
   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <t> FORCE  ROW LEVEL SECURITY;   -- required: app role owns the table
   CREATE POLICY tenant_isolation ON <t>
     USING      (user_id = current_setting('app.uid', true)::int)
     WITH CHECK (user_id = current_setting('app.uid', true)::int);
   ```
   `current_setting('app.uid', true)` — the `true` = missing_ok, returns NULL when unset (query then
   matches nothing, which is the safe default rather than an error).

Tables in scope (all carry `user_id`): invoices, expenses, bills, customers, journals,
personal_transactions, personal_accounts, entities, documents, payroll, holdings, goals,
recurring_*, user_settings, snapshots, chart_of_accounts, lock_settings, audit_trail (read-only),
and any other row-owned table — enumerate from `database.js` TABLES at implementation time.

## Accountant dimension (the real complexity)

Accountants act on a **client's** `user_id`, not their own. A naive `user_id = app.uid` policy would
lock accountants out of client books. Options, in order of preference:

- **A. Set `app.uid` to the client being accessed.** When an accountant session operates on a client,
  the middleware resolves the target client id (already done today via the accountant→client scoping)
  and sets `app.uid` to *that* client's id, but only after the app-layer check confirms an active
  `accountant_clients` link. RLS then behaves identically for owner and accountant. Simplest policy,
  keeps all the "which client" logic in the app where it already lives.
- **B. Policy-level accountant grant.** Add a second GUC `app.accountant_id` and a policy branch:
  `EXISTS (SELECT 1 FROM accountant_clients ac WHERE ac.accountant_id = current_setting('app.accountant_id')::int AND ac.user_id = <t>.user_id AND ac.status='active')`. More DB logic, more surface to get wrong, but enforces the accountant→client boundary in the DB too.

Recommend **A** for the first pass (least risk, mirrors current app logic), consider **B** later if we
want the accountant boundary itself enforced at the DB.

## Rollout (staged, reversible)

1. **Plumbing first, no policies.** Ship the ALS context + transaction wrapper. No behavior change
   (GUC is set but nothing reads it yet). Verify the whole app still works + full sweep green.
2. **One table, permissive.** Enable RLS+FORCE on a single low-risk table with the policy, behind a
   flag. Confirm reads/writes still work for owner + accountant; confirm the isolation harness passes.
3. **Roll table-by-table**, re-running the sweep after each.
4. **Prove it adds value:** a new harness variant that calls a data path with the app-layer `ownedBy`
   guard *disabled* (simulating a forgetful route) and asserts RLS **still** denies cross-tenant
   access. That's the whole point of RLS — this test is the deliverable that justifies it.

## Rollback

Instant and per-table: `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` (or `DROP POLICY`). The context
plumbing is inert without policies, so it can stay. Keep the app-layer `ownedBy` guards permanently —
RLS is the second wall, never the only one.

## Effort / risk

- Plumbing (ALS + transaction wrapper around `db.*`): **medium**, touches the shared data layer — the
  riskiest part, needs the full sweep after.
- Policies: **low** per table, mechanical.
- Accountant path: **medium** — the one place to get subtly wrong; option A keeps it in the app.
- Overall: a real, careful pass — not a rush job. The transaction-per-operation change also has a
  small latency cost (BEGIN/COMMIT per op) worth measuring, though at SMB volumes it's negligible.

## Not needed / out of scope

- Supabase's own `auth.uid()` RLS (that's for Supabase-client/JWT access; FinFlow uses a Node server
  with its own sessions, so the GUC approach is correct).
- RLS does **not** replace the least-privilege DB role (separate item) — that stops schema
  destruction; RLS stops cross-tenant row access. Do both.
