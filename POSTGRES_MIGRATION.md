# Postgres Migration Guide

## What changed
- `database.js` — rewritten. lowDB is gone. Uses `pg` pool + JSONB schema.
- `server.js` — all route handlers made `async`, all `db.*` calls awaited, session store wired to Postgres via `connect-pg-simple`.
- `package.json` — added `pg` and `connect-pg-simple`, removed `lowdb`.

## Files to drop in
Replace these 3 files in your project root:
```
database.js   ← new file
server.js     ← patched file  
package.json  ← updated deps
```

## Setup steps

### 1. Install new deps
```bash
npm install
```
(This installs `pg` and `connect-pg-simple`, removes `lowdb`)

### 2. Provision Postgres
Pick one:
- **Railway** — Add a Postgres plugin, copy the `DATABASE_URL` it gives you
- **Supabase** — Free tier, grab the connection string from Project Settings → Database
- **Render** — Add a Postgres service, copy the external URL
- **Local dev** — `brew install postgresql` / `sudo apt install postgresql`, then `createdb finflow`

### 3. Set environment variables
Add to your `.env` (or platform env vars):
```
DATABASE_URL=postgres://user:pass@host:5432/finflow
SESSION_SECRET=your-long-random-secret-here
NODE_ENV=production   # only on prod
```

### 4. Start the app
```bash
npm start
```

On first boot `initDB()` runs automatically and creates all tables + indexes.
New users who register will get seed data as before.

## Schema design
Every table uses the same structure:
```sql
id         SERIAL PRIMARY KEY
user_id    INTEGER  (indexed)
entity_id  INTEGER  (nullable)
data       JSONB    (all other fields live here)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Storing payload in JSONB means no schema migrations needed when you add new fields — same flexibility as lowDB, real durability of Postgres.

## What you don't need to do
- No schema migrations to write manually — `initDB()` handles it
- No changes to any frontend code — API responses are identical
- No changes to any other server.js logic — same db.get/all/insert/update/delete/upsert API

## Deleting the old JSON file
Once you've confirmed the app boots and logins work on the new DB, you can delete `finflow.db.json`. Don't delete it until you've verified — it's harmless to keep around during transition.
