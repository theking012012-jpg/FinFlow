'use strict';
/**
 * verify-c1-invoice-client.js — PROVE (Rule 14) that commit B wires the invoice idempotency token
 * end-to-end through the REAL client: the in-flight lock collapses a double-click to ONE POST, the
 * POST carries the idempotency_key that commit A's DB index enforces, and a reopened modal mints a
 * NEW token so genuine re-invoicing still lands.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-c1-invoice-client.js
 *
 * Boots the REAL SPA in jsdom (real bundle → the shipped saveInvoice/openInvoiceModal runtime
 * winners) against a real seeded scratch Postgres + real server (jsdomBoot), drives the real modal
 * open + save, and reads the captured wire log + the DB. No stubbed client. The client lock is a UX
 * layer, not the guarantee (Rule 9); the durable backstop's failure path was executed in
 * verify-c1-invoice-pilot.js. This test proves the token is actually SENT — without it commit A is
 * inert forever.
 */

const { bootSpaInJsdom } = require('./jsdomBoot.js');

// jsdom schedules requestAnimationFrame callbacks on a timer; when one fires AFTER window.close()
// during teardown it reads a nulled document and throws. That is post-run teardown noise, not a
// test result — swallow ONLY that specific error; anything else still crashes the process.
process.on('uncaughtException', (e) => {
  const m = String(e && e.message || e);
  if (/_location|Cannot read properties of null \(reading '_location'\)/.test(m)) return;
  throw e;
});

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (name, ok, detail) => {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
  };

  try {
    boot = await bootSpaInJsdom();
    const { window, wireLog, settle, client: c, userId } = boot;
    // The SPA scripts (app-main.js, then the deferred bundle) load asynchronously in jsdom — wait
    // for the runtime winners to be defined before driving them (up to ~25s).
    for (let i = 0; i < 250 && typeof window.saveInvoice !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    const postsSince = (from) => wireLog.slice(from).filter(w => w.method === 'POST' && w.path === '/api/invoices');
    const dbCount = async (cli) =>
      Number((await c.query(`SELECT COUNT(*) n FROM invoices WHERE user_id=$1 AND data->>'client'=$2`, [userId, cli])).rows[0].n);
    const fill = (cli, amt) => {
      window.document.getElementById('inv-client').value = cli;
      window.document.getElementById('inv-amount').value = String(amt);
    };

    A('runtime winners present: openInvoiceModal + saveInvoice on window',
      typeof window.openInvoiceModal === 'function' && typeof window.saveInvoice === 'function');

    // ── 1. DOUBLE-CLICK: open modal, fill, fire saveInvoice twice with no await between ──
    const cliA = 'JSDOM Client A';
    window.openInvoiceModal();
    fill(cliA, 1234);
    const before1 = wireLog.length;
    const p1 = window.saveInvoice();
    const p2 = window.saveInvoice();               // must be blocked by the in-flight lock
    await Promise.allSettled([p1, p2]);
    await settle(40, 50);
    const postsA = postsSince(before1);
    A('1a. double-click fires exactly ONE POST /api/invoices (in-flight lock held)', postsA.length === 1, `posts=${postsA.length}`);
    const bodyA = postsA[0] ? JSON.parse(postsA[0].body) : {};
    A('1b. the POST carries a non-empty idempotency_key (token wired to the DB backstop)',
      typeof bodyA.idempotency_key === 'string' && bodyA.idempotency_key.length > 0, `key=${JSON.stringify(bodyA.idempotency_key)}`);
    A('1c. DB has exactly ONE invoice for Client A', (await dbCount(cliA)) === 1, `rows=${await dbCount(cliA)}`);
    A('1d. _invIdemKey cleared to null after the successful save', window._invIdemKey == null, `value=${JSON.stringify(window._invIdemKey)}`);

    // ── 2. REOPEN the modal for a genuinely new invoice → a DIFFERENT token ──
    const cliB = 'JSDOM Client B';
    window.openInvoiceModal();                      // resets _invIdemKey to null
    fill(cliB, 5678);
    const before2 = wireLog.length;
    await window.saveInvoice();
    await settle(40, 50);
    const postsB = postsSince(before2);
    A('2a. second invoice fires ONE POST', postsB.length === 1, `posts=${postsB.length}`);
    const bodyB = postsB[0] ? JSON.parse(postsB[0].body) : {};
    A('2b. reopened modal minted a DIFFERENT token (genuine re-invoicing allowed — the F117/B1.1 discriminator)',
      !!bodyB.idempotency_key && !!bodyA.idempotency_key && bodyB.idempotency_key !== bodyA.idempotency_key,
      `A=${bodyA.idempotency_key} B=${bodyB.idempotency_key}`);
    A('2c. DB has exactly ONE invoice for Client B', (await dbCount(cliB)) === 1, `rows=${await dbCount(cliB)}`);

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  } catch (e) {
    console.error('\n  FATAL:', e && e.stack ? e.stack : String(e));
    if (e && e.code) console.error('  code:', e.code);
    if (e instanceof AggregateError && e.errors) console.error('  aggregate:', e.errors.map(x => x.message).join(' | '));
    fail++;
  } finally {
    try { if (boot) await boot.stop(); } catch { /* ignore */ }
  }
  process.exitCode = fail === 0 ? 0 : 1;
})();
