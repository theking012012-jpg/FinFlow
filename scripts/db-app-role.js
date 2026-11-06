#!/usr/bin/env node
'use strict';
/**
 * db-app-role.js — NEW-23. Owner-run, from the owner's own computer (never from Railway): creates / re-keys the
 * restricted login `finflow_app` by running scripts/db-app-role.sql with a fresh random password, then proves it by
 * connecting AS that login. The new connection address is put on the clipboard (Windows: clip.exe) and never printed,
 * so it cannot end up in a chat or a log. Paste it into Railway → DATABASE_URL.
 *
 *   PowerShell, in the repo folder, with the OWNER address in DATABASE_URL (OWNER_ACTIONS §11):
 *     node scripts/db-app-role.js
 *
 * Run AFTER `node scripts/migrate.js` (so the tables it restricts exist). Re-running re-keys the login: Railway must then
 * get the new address. Writes: CREATE/ALTER ROLE + GRANT/REVOKE only (scripts/db-app-role.sql) — no table data.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const ssl = (url) => (/localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false });

(async () => {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) { console.error('usage: put the OWNER database address in DATABASE_URL, then: node scripts/db-app-role.js'); process.exit(2); }
  const pw = crypto.randomBytes(24).toString('hex');           // hex: nothing to URL-encode
  const owner = new Client({ connectionString: ownerUrl, ssl: ssl(ownerUrl) });
  await owner.connect();
  const sql = fs.readFileSync(path.join(__dirname, 'db-app-role.sql'), 'utf8')
    .replace(/^\\set.*$/gm, '')
    .replace(/:'app_pw'/g, owner.escapeLiteral(pw));
  await owner.query(sql);
  await owner.end();

  // The app's address: same host / port / database; user finflow_app (Supabase pooler: finflow_app.<project-ref>).
  const u = new URL(ownerUrl);
  const ref = decodeURIComponent(u.username).includes('.') ? decodeURIComponent(u.username).split('.').slice(1).join('.') : '';
  u.username = encodeURIComponent(ref ? 'finflow_app.' + ref : 'finflow_app');
  u.password = pw;
  const appUrl = u.toString();

  // Prove it: connect AS the new login; it must not be able to switch off the audit trail.
  const app = new Client({ connectionString: appUrl, ssl: ssl(appUrl) });
  await app.connect();
  const who = (await app.query('SELECT current_user AS u')).rows[0].u;
  let refused = null;
  try { await app.query('ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_mutate'); refused = false; } catch (e) { refused = e.code === '42501' ? true : e.code; }
  await app.end();
  console.log(`[db-app-role] login works as "${who}"; switching off the audit trail as it: ${refused === true ? 'REFUSED (correct)' : 'NOT REFUSED — stop, do not use this login: ' + refused}`);
  if (who !== 'finflow_app' || refused !== true) process.exit(1);

  if (process.platform === 'win32') {
    const r = spawnSync('clip', { input: appUrl });
    if (r.status === 0) { console.log('[db-app-role] the new DATABASE_URL is on your clipboard (not shown). Paste it into Railway → Variables → DATABASE_URL now.'); process.exit(0); }
  }
  if (process.env.FF_PRINT_APP_URL === '1') { console.log(appUrl); process.exit(0); }
  console.log('[db-app-role] no clipboard here; re-run with FF_PRINT_APP_URL=1 to print the address (keep it out of chat).');
})().catch((e) => { console.error('[db-app-role] FAILED:', e && e.message, e && e.code, '\n', e && e.stack); process.exit(1); });
