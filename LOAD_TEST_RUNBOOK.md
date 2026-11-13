# Capacity test runbook (load test #3)

How many people can use FinFlow at once before it slows down or fails. Run against a **staging copy**, never the live
site: the test creates accounts and data, and production's database limits are exactly what is being measured.

Everything here is prepared and checked: `tests/load/seed-load-users.js` (creates the test accounts) and
`tests/load/k6-finflow.js` (the simulated users). `tests/harness/verify-load-flow-smoke.js` runs the same request flow
with 20 users on a scratch database and checks every write lands exactly once. It confirms the tools work; it does
**not** measure capacity.

## 1. Make the staging copy (about 20 minutes, once)

1. **Database.** In Supabase, create a new project (e.g. `finflow-staging`) on the **same plan and region** as
   production, so its connection limits match. Copy its **Session pooler** connection string (the same kind production
   uses).
2. **App.** In Railway, add a second service to the FinFlow project from the same GitHub repo, branch `main`.
   Set its variables:
   - `DATABASE_URL` = the staging Supabase session-pooler string
   - `SESSION_SECRET` = any new long random string (not production's)
   - `APP_URL` = the staging service's Railway URL
   - `NODE_ENV=production`
   - **Leave unset:** Stripe keys, `RESEND_API_KEY`, bank-connector keys, `ALLOW_INDEXING`, `SENTRY_DSN`. The test
     needs none of them, and staging must never charge cards or email real people.
   - Use the **same instance size** as production (Railway → Settings → Resources), or the numbers won't carry over.
3. Deploy. Open `https://<staging>/healthz`: it should say `"status":"ok","db":"up"`. The first boot creates the tables.

## 2. Create the test accounts (on your machine, PowerShell)

```powershell
$env:DATABASE_URL = "<staging session-pooler URL>"
$env:STAGING_CONFIRM = "yes"
node tests/load/seed-load-users.js 200
Remove-Item Env:DATABASE_URL, Env:STAGING_CONFIRM
```

This creates 200 accounts (`loadtest+1@finflow.test` …) with a business, 20 invoices, 10 expenses and 2 employees each.
It refuses to run without `STAGING_CONFIRM=yes`, or if the database address contains "prod".

## 3. Run the test

Install k6 once: `winget install k6 --source winget`. Then:

```powershell
k6 run -e BASE_URL=https://<staging>.up.railway.app -e USERS=200 tests/load/k6-finflow.js
```

It takes about 15 minutes. The number of simulated users ramps 10 → 50 → 100 → 200, then back to 0. Each user signs in
once, then repeats: open the dashboard, view a report, and every third time create an invoice, record a payment and add
an expense. Each user pauses 3–8 seconds between steps, like a person.

**While it runs, watch:**
- **Railway** → staging service → Metrics: CPU and memory.
- **Supabase** → staging project → Database / Reports: active connections. Each app process keeps up to **10**
  connections (`database.js`, `max: 10`), and requests wait for a free one. That is the likeliest first limit.

## 4. Read the result

k6 prints a summary at the end. The test **passes** if:
- `http_req_failed` is under 1 %,
- `http_req_duration` p(95) is under 800 ms and p(99) under 2 s,
- `write_duration` p(95) is under 1.5 s.

If it fails, the timeline shows **at how many users** it started failing. That number is the answer. Send me the k6
summary plus screenshots of the Railway and Supabase graphs, and I'll find the cause. The usual suspects, in order:
1. The 10-connection pool (`database.js`).
2. Slow queries on the dashboard and reports.
3. CPU on a small instance.

`rate_limited_429` should stay at 0. Each user is its own account, and the limit is 300 writes a minute per account. If
it isn't 0, something is wrong with the test, not the app.

## 5. Clean up

```powershell
$env:DATABASE_URL = "<staging session-pooler URL>"; $env:STAGING_CONFIRM = "yes"
node tests/load/seed-load-users.js --remove
```

Then pause or delete the staging service and Supabase project, so they stop costing money.

## A lead before you run it

In the scratch-database smoke test, 20 users firing all their requests at the same moment (no pauses) saw p95 ≈ 1.8 s,
on a shared machine that was also running other tests. That is not a capacity figure. But it points at request queuing,
most likely the 10-connection pool, as the first thing the real test should confirm or rule out.
