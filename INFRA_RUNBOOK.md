# FinFlow — Infra Hardening + Housekeeping Runbook

_Do-it-now steps for the owner/ops items. Each is self-contained. Order below is the recommended order._
_Verified against the codebase 2026-09-13: `database.js` runs DDL on boot (38 ALTER, 29 CREATE TABLE, 54 CREATE INDEX) — this shapes the DB-role step._

---

## 1. Move the repo out of OneDrive (do this FIRST — it's causing the lock fight)

OneDrive keeps a handle on `.git/index` and syncs it mid-write → the recurring `.git/index.lock`. Moving the working tree off the synced path fixes it permanently. Nothing about the remote changes; you're just relocating your local clone.

```powershell
# 1. Make sure everything is pushed first (it is — HEAD is 3c59133 on origin)
cd "C:\Users\theki\OneDrive\Desktop\finflow-FINAL7 (4)"
git status            # should say "nothing to commit, working tree clean" (aside from LAUNCH_PUNCHLIST.md / INFRA_RUNBOOK.md if uncommitted)

# 2. Create a non-synced home and move it there
New-Item -ItemType Directory -Force "C:\dev" | Out-Null
Move-Item "C:\Users\theki\OneDrive\Desktop\finflow-FINAL7 (4)" "C:\dev\finflow"

# 3. Work from the new path from now on
cd "C:\dev\finflow"
git status            # confirm it's the same repo, clean
git remote -v         # confirm origin still points at theking012012-jpg/FinFlow
```

After this, clear the last stale lock once (`Remove-Item ".git\index.lock" -Force`) and you should never see it again. Update any Railway/local scripts or shortcuts that referenced the old Desktop path. **Do not** put a Windows exclusion on the OneDrive folder and leave the repo there — moving it out is the clean fix; the exclusion is fragile.

---

## 2. Cloudflare in front of the domain (~15 min, no code change)

Free tier is enough to launch behind (managed WAF ruleset + unmetered DDoS).

1. Add the site at cloudflare.com → **Add a site** → enter your apex domain → pick the **Free** plan.
2. Cloudflare imports your existing DNS records — **verify the record that points at Railway is there** (the CNAME/A for your app), and set its proxy status to **Proxied (orange cloud)**.
3. At your registrar, replace the nameservers with the two Cloudflare gives you. Propagation is usually minutes.
4. **SSL/TLS → Overview → set encryption mode to `Full (strict)`.** (Railway serves valid TLS, so strict works and prevents a downgrade-in-the-middle. Do NOT use `Flexible` — it leaves Cloudflare→origin unencrypted.)
5. **Security → WAF → Managed rules → enable the Cloudflare Managed Ruleset.**
6. Quick wins while you're there: **SSL/TLS → Edge Certificates →** turn on **Always Use HTTPS** and **Automatic HTTPS Rewrites**.

**Gotcha:** your Railway app reads the client IP for the login rate-limiter. Behind Cloudflare the real IP arrives in `CF-Connecting-IP` / `X-Forwarded-For`. Confirm Express `trust proxy` is set so `authLimiter` keys on the real client, not Cloudflare's edge IP (otherwise the whole internet shares one rate-limit bucket). If it isn't, that's a one-line code change — tell me and I'll do it + harness it.

Upgrade path (not now): Pro (~$25/mo) for the fuller managed WAF around launch; Business (~$250/mo) only once you need custom WAF rules.

---

## 3. Tested backups + point-in-time restore (actually run a restore)

Configuring backups isn't the deliverable — proving a restore works is.

1. **Supabase → Project → Database → Backups.** Confirm daily backups are on. PITR requires a paid plan (Pro+); confirm your plan actually includes it, and note the retention window (7 days on Pro).
2. **Run a real restore drill** — do NOT restore over production. Either:
   - Use **Supabase → Restore to a new project** (or a branch) to a timestamp ~1 hour ago, then
   - Point a local checkout's `DATABASE_URL` at the restored copy and boot FinFlow against it.
3. **Verify the restore is actually usable**, not just present: log in, load the dashboard, open an invoice, run a report. If `initDB` boots clean and the books render, the restore is real.
4. Write down the RPO (how much data you'd lose = backup frequency / PITR granularity) and RTO (how long the restore took). That's your answer when a customer asks "what happens if the DB dies."

---

## 4. Least-privilege DB role (app can't be a superuser)

**Critical constraint (verified in `database.js`):** the app runs `CREATE TABLE / ALTER TABLE / CREATE INDEX / DROP` on its own tables at every boot. So the app role must be able to modify **its own** objects — the way to allow that safely is to make it the **owner** of those objects, NOT to grant it superuser. A true "can't ALTER anything" role would fail `initDB` on your next deploy.

Goal: app connects as `finflow_app` — a role that owns the `public` schema objects but has **NOSUPERUSER NOCREATEROLE NOCREATEDB** and no reach into other databases, roles, or extensions.

Run in the **Supabase SQL editor** (as the `postgres` role). **Do this in a branch/staging project first, boot the app against it, and confirm `initDB` succeeds before touching production.** Keep your current `DATABASE_URL` as an instant rollback.

```sql
-- 1. Create the app role (no superuser powers, can log in)
CREATE ROLE finflow_app WITH LOGIN PASSWORD 'REPLACE_WITH_A_STRONG_PASSWORD'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- 2. Let it use the schema and own future objects it creates
GRANT USAGE, CREATE ON SCHEMA public TO finflow_app;

-- 3. Hand it ownership of every existing table/sequence so boot-time ALTER/DROP works
--    (run the generated statements this produces)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO finflow_app', r.tablename);
  END LOOP;
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO finflow_app', r.sequence_name);
  END LOOP;
END $$;

-- 4. Confirm it is NOT a superuser
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
FROM pg_roles WHERE rolname='finflow_app';   -- rolsuper must be false
```

Then in **Railway**, change `DATABASE_URL` to connect as `finflow_app` (keep the same Supabase **session pooler** host/port — just swap the user + password in the connection string). Redeploy and watch the logs: `initDB` must complete without permission errors. If anything fails, revert `DATABASE_URL` to the old value — instant rollback.

**Note:** this is independent of the Postgres RLS item on the code list. RLS is belt-and-suspenders row filtering; this is "the app account can't nuke the schema." Do this one now (ops); RLS is a code pass I do later.

---

## 5. Secrets rotation cadence

Set a recurring reminder and rotate on schedule + on any suspected exposure. The secrets that matter, where they live, and how to rotate:

| Secret | Where | Rotate | How |
|---|---|---|---|
| `DATABASE_URL` (app role pw) | Railway env | Quarterly + on exposure | `ALTER ROLE finflow_app PASSWORD '...'` then update Railway |
| `SESSION_SECRET` | Railway env | Quarterly | New random value — **note: rotating logs everyone out** (sessions invalidate) |
| `STRIPE_SECRET_KEY` / webhook signing secret | Stripe dashboard → API keys | On exposure; roll keys annually | Roll in Stripe, update Railway, re-verify webhook |
| `CONNECTOR_ENC_KEY` | Railway env | **Do NOT rotate casually** | This decrypts stored connector tokens at rest — rotating it strands existing encrypted tokens. Only rotate with a re-encryption migration; tell me first. |
| `RESEND_API_KEY` | Resend dashboard | On exposure | Regenerate, update Railway |
| Provider connector keys (Plaid/Belvo/…) | each provider | On exposure | Regenerate per provider, update Railway |

Cadence to actually put on the calendar: **quarterly** for `DATABASE_URL` + `SESSION_SECRET`, **annually** for provider/Stripe keys, and **immediately** on any laptop loss, repo leak, or suspected compromise. The one landmine is `CONNECTOR_ENC_KEY` — it's not a rotate-on-a-whim secret; treat it like the master key it is.

---

## Suggested order

1 (repo move) → 2 (Cloudflare) → 4 (DB role, in staging first) → 3 (restore drill) → 5 (write the rotation reminders down). 1 and 2 are quick and unblock everything else; 4 needs a careful staging test; 3 is the one that actually proves you can survive a bad day.
