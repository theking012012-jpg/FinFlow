'use strict';
/**
 * verify-email-resend.js — EXECUTE the transactional-email send path to the Resend boundary
 * (Appendix A: email was UNVERIFIED). No real email is sent and no live key is used: the `resend`
 * module is replaced in the require cache with a mock that CAPTURES each emails.send() payload, so
 * we assert the real server code builds the correct { from, to, subject, html } and a working reset
 * link — everything up to the network call Resend would make.
 *
 * NOTE ON ENV: boot.js installEnv() deliberately DELETES RESEND_API_KEY / APP_URL to keep
 * integrations unconfigured, so we call installEnv() ourselves, THEN set the email env AFTER the
 * scrub, THEN require server.js — the one window where the server sees a configured Resend.
 *
 *   runuser -u postgres -- env SESSION_SECRET=test HOME=/srv/ffv bash -c \
 *     'cd /srv/ffv && node -r ./tests/harness/clock.js tests/harness/verify-email-resend.js'
 */
const bcrypt = require('bcryptjs');

// ── Mock `resend` BEFORE server.js is required (it does `require('resend')` at load when
//    RESEND_API_KEY is set). The mock records every send() call. ──
const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true, exports: {
    Resend: class { constructor(key) { this.key = key; this.emails = { send: async (msg) => { sent.push(msg); return { data: { id: 'mock-' + sent.length } }; } }; } },
  },
};

const { startScratchPostgres } = require('./pgScratch.js');
const { installEnv } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const EMAIL = 'reset-me@finflow.test';
const NAME = 'Reset Tester';

(async () => {
  let scratch, server, database, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    scratch = await startScratchPostgres({ keep: false });
    const c = scratch.client;

    // installEnv sets DATABASE_URL/NODE_ENV/SESSION_SECRET and DELETES RESEND_API_KEY/APP_URL.
    installEnv(scratch.url);
    // Now (after the scrub, before server.js is required) configure email — the launch config.
    process.env.RESEND_API_KEY = 're_mock_boundary_test';
    process.env.EMAIL_FROM = 'FinFlow <noreply@test.example>';
    process.env.APP_URL = 'https://finflow-test.example';

    database = require('../../database.js');
    await database.initDB();
    await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW())`,
      [{ email: EMAIL, name: NAME, plan: 'trial', role: 'owner', password: bcrypt.hashSync('x', 10) }]
    );

    const app = require('../../server.js');
    server = await new Promise((res, rej) => { const s = app.listen(0, '127.0.0.1', () => res(s)); s.on('error', rej); });
    const http = new HarnessHttp(`http://127.0.0.1:${server.address().port}`);

    // ── Drive the REAL forgot-password route ──
    const r = await http.post('/api/auth/forgot-password', { email: EMAIL });
    A('POST /api/auth/forgot-password returns 200 (no account enumeration)', r.status === 200, `status ${r.status}`);
    A('exactly ONE email was sent via Resend (resendClient configured → send branch taken)', sent.length === 1, `sent=${sent.length}`);

    const m = sent[0] || {};
    A('from === EMAIL_FROM env (overrides every hard-coded .app/.io fallback)', m.from === 'FinFlow <noreply@test.example>', `from=${m.from}`);
    A('to === the requesting user email', m.to === EMAIL, `to=${m.to}`);
    A('subject is the reset subject', /reset/i.test(m.subject || ''), `subject=${m.subject}`);
    A('html carries a reset link built from APP_URL', typeof m.html === 'string' && m.html.includes('https://finflow-test.example/reset-password.html?token='), `html…=${(m.html || '').slice(0, 140)}`);

    // The link token is the RAW token; the DB stores only its SHA-256 (L2). Prove the link works
    // end-to-end by extracting it and completing the reset + login.
    const tok = ((m.html || '').match(/token=([A-Za-z0-9]+)/) || [])[1];
    A('a raw token is present in the link', !!tok && tok.length >= 16, `tok=${tok}`);
    const dbRows = (await c.query(`SELECT data->>'token' AS t FROM password_resets`)).rows;
    A('DB stores the HASH, not the raw token (L2 — link token != stored token)', dbRows.length === 1 && dbRows[0].t && dbRows[0].t !== tok, `stored=${(dbRows[0]?.t || '').slice(0, 12)}…`);
    const reset = await http.post('/api/auth/reset-password', { token: tok, password: 'a-new-password-123' });
    A('the emailed link actually resets the password (200)', reset.status === 200, `status ${reset.status}: ${reset.text?.slice(0, 120)}`);
    const login = await http.post('/api/auth/login', { email: EMAIL, password: 'a-new-password-123' });
    A('login works with the new password (full round-trip)', login.status === 200, `status ${login.status}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (Resend send path, mocked at the network boundary)\n`);
  } catch (e) {
    console.error('  PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); fail++;
  } finally {
    try { if (server) await new Promise((r) => server.close(() => r())); } catch {}
    try { if (database && database.pool) await database.pool.end(); } catch {}
    try { if (scratch) await scratch.stop(); } catch {}
  }
  process.exit(fail === 0 ? 0 : 1);
})();
