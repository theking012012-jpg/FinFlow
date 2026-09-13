#!/usr/bin/env node
'use strict';
/**
 * verify-cloudflare-rl-key.js — the pre-login IP-keyed limiters (authLimiter/acceptLimiter) must
 * key on the REAL client, not the Cloudflare edge. Behind Cloudflare every request arrives from a
 * small pool of CF edge IPs; if the limiter keyed on that, one attacker would exhaust the shared
 * budget and lock out every legitimate login (or, inversely, one CF IP fronts thousands of users).
 * The fix keys on _clientIp → CF-Connecting-IP first, then Envoy/XFF, then req.ip.
 *
 * Proves:
 *   isolation  — flood login from CF ip A until 429; a request from CF ip B is NOT 429 (own bucket).
 *   still bites — the SAME CF ip A is 429 after max:10 (we didn't neuter the limiter).
 *   cf > xff   — cf=C with xff=A (A already exhausted) is NOT 429 → CF-Connecting-IP wins over XFF.
 *   fallback   — no cf/xff still rate-limits (keys on req.ip via _clientIp last resort).
 *
 * RED without the fix: authLimiter has no keyGenerator → keys on req.ip = 127.0.0.1 for every
 * harness request → CF ip B (and C) share A's exhausted bucket and would return 429. The isolation
 * + cf>xff asserts can only pass when the limiter reads CF-Connecting-IP.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-cloudflare-rl-key.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

// A login POST with an arbitrary (unknown) credential — the limiter runs BEFORE the handler, so the
// body only matters for what the non-limited response is (401 unknown-user), never for the count.
const login = (base, { cf, xff } = {}) =>
  new HarnessHttp(base, { cf, xff }).post('/api/auth/login', { email: 'nobody@finflow.test', password: 'x' });

const MAX = 10; // authLimiter max per 15-min window (clock is pinned, so the window never advances)

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const base = server.baseUrl;

    console.log('\n' + '='.repeat(78));
    console.log('  CLOUDFLARE-AWARE RATE-LIMIT KEY — authLimiter keys on the real client, not the edge');
    console.log('='.repeat(78) + '\n');

    // Exhaust CF ip A.
    let aStatuses = [];
    for (let i = 0; i < MAX; i++) aStatuses.push((await login(base, { cf: '10.0.0.1' })).status);
    A('first ' + MAX + ' logins from CF ip A are NOT 429', aStatuses.every(s => s !== 429), JSON.stringify(aStatuses));
    A('login ' + (MAX + 1) + ' from CF ip A → 429 (limiter still bites)', (await login(base, { cf: '10.0.0.1' })).status === 429);

    // Isolation: a DIFFERENT CF ip is untouched — the core RED/GREEN discriminator.
    A('CF ip B → NOT 429 (own bucket; RED without the keyGenerator)', (await login(base, { cf: '10.0.0.2' })).status !== 429);

    // Precedence: CF-Connecting-IP must win over X-Forwarded-For. cf=C is fresh even though xff=A is spent.
    A('cf=C + xff=A (A exhausted) → NOT 429 (CF-Connecting-IP wins over XFF)', (await login(base, { cf: '10.0.0.3', xff: '10.0.0.1' })).status !== 429);

    // XFF still works when there is no CF header (pre-Cloudflare / direct topology).
    let dStatuses = [];
    for (let i = 0; i < MAX; i++) dStatuses.push((await login(base, { xff: '10.0.0.9' })).status);
    A('XFF-only client: first ' + MAX + ' NOT 429, then 429', dStatuses.every(s => s !== 429) && (await login(base, { xff: '10.0.0.9' })).status === 429, JSON.stringify(dStatuses));
    A('a fresh XFF-only ip is isolated → NOT 429', (await login(base, { xff: '10.0.0.10' })).status !== 429);

    console.log('\n' + '-'.repeat(78));
    console.log(`  ${pass} passed, ${fail} failed`);
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
