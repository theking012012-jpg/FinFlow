# FinFlow — Deploy to Railway

## This is a single-repo app
Express serves both the API and the frontend HTML files from `public/`.
Everything runs on Railway. No Vercel needed.

---

## Step 1 — Push to GitHub
Make sure your code is in a GitHub repo.

## Step 2 — Create Railway project
1. Go to railway.app → New Project → Deploy from GitHub repo
2. Select your FinFlow repo
3. Railway detects Node.js and runs `npm start` automatically

## Step 3 — Set environment variables in Railway dashboard
Go to your service → Variables tab and add all of these:

```
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
SESSION_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
NODE_ENV=production
ANTHROPIC_API_KEY=sk-ant-...
RESEND_API_KEY=re_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
EMAIL_FROM=FinFlow <noreply@yourdomain.com>
APP_URL=https://your-app.up.railway.app
ADMIN_PASSWORD=<strong password>
```

ALLOWED_ORIGIN is NOT needed — frontend and backend are the same origin.

## Step 4 — Get your Supabase connection string
Supabase Dashboard → Settings → Database → Connection string → URI tab
Use port 5432 (Session mode) — NOT 6543

## Step 5 — Railway will auto-deploy
Watch the build logs. On first boot, all database tables are created automatically.

## Step 6 — Your app URLs
- Landing page: https://your-app.up.railway.app
- App (login): https://your-app.up.railway.app/app
- Admin panel: https://your-app.up.railway.app/admin
- Accountant portal: https://your-app.up.railway.app/accountant

## Step 7 — Custom domain (optional)
Railway Settings → Domains → Add custom domain
Then in Cloudflare (or your DNS), point your domain to the Railway URL.

## Step 8 — Stripe webhook
In Stripe Dashboard → Webhooks → Add endpoint:
URL: https://your-app.up.railway.app/api/stripe/webhook
Events: checkout.session.completed, customer.subscription.deleted, account.updated

---

## What's already working
- ✅ All API routes (invoices, expenses, customers, inventory, payroll, etc.)
- ✅ Session auth with Postgres session store
- ✅ Recurring invoice/bill scheduler (runs on boot + every hour)
- ✅ Stripe payments + webhook
- ✅ Email (Resend) for password reset
- ✅ AI assistant (Anthropic) with prompt caching
- ✅ Receipt scanner
- ✅ Accountant marketplace
- ✅ Admin panel
- ✅ Plan/trial enforcement
- ✅ Audit log
- ✅ All data scoped by user + entity
