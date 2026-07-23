'use strict';
/**
 * tz-probe.js — read every A5 figure once, under whatever viewer timezone HARNESS_TZ names,
 * and emit the result as JSON on stdout.
 *
 * Not a gate. It asserts nothing. It is one half of an A/B experiment: tz-matrix.js runs this
 * twice with the timezone as the ONLY difference and compares the two result sets.
 *
 * Everything else is held constant by construction:
 *   · the pinned INSTANT is identical (clock.js pins an absolute moment, not a local time)
 *   · the seed writes fixed UTC instants (`${ymd}T16:00:00.000Z`), so both runs store
 *     byte-identical rows
 *   · each run gets its own scratch cluster, both UTC, both freshly seeded
 *
 * So if a figure differs between the two runs, the ONLY thing that can have caused it is the
 * viewer's timezone.
 */

const bcrypt = require('bcryptjs');
const clock = require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');
const { seed } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');
const { PERIODS, toQuery } = require('./periods.js');

const LOGIN = { email: 'seed@finflow.test', password: 'harness-password-not-a-secret' };
const PERIOD_KEYS = ['may', 'jun', 'jul', 'q2', 'q3', 'fy'];

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;

  const out = {
    tz: clock.TZ,
    offsetMinutes: clock.OFFSET_MIN,
    pinnedIso: clock.PINNED_ISO,
    windows: {},
    figures: {},
    errors: [],
  };

  try {
    const userId = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at)
       VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
      [{
        email: LOGIN.email, name: 'Seed Owner', plan: 'trial', role: 'owner',
        password: bcrypt.hashSync(LOGIN.password, 10),
      }]
    )).rows[0].id;

    const { entityId } = await seed(c, userId);

    // ── The boundary row (Rule 4: the seed must DISCRIMINATE) ────────────────
    // The first run of this experiment showed identical figures under both viewers. That was a
    // property of the SEED, not of the code: every seeded row carries a date-only string, and
    // `winInc` (server.js:3978) parses those with `new Date('2026-06-01')` → UTC midnight,
    // which sits BEFORE both viewers' local-midnight boundaries (04:00Z and 07:00Z). Both
    // viewers were wrong in the same way, so nothing moved and the test proved nothing.
    //
    // This row is timestamped INSIDE the inter-viewer gap, and carries no expense_date so the
    // leg falls back to created_at (`_expDate = e => e.expense_date || e.date || e.created_at`,
    // server.js:4095) — a real instant rather than a date-only string.
    //
    //   2026-06-01T05:30:00Z  is  01:30 on 1 June for viewer A (UTC-4)   → inside A's June
    //                         and 22:30 on 31 May for viewer B (UTC-7)   → inside B's MAY
    //
    // One row, one database, one instant. If the two viewers file it in different months, the
    // books depend on the reader. Amount 777 so it is unmistakable in the delta.
    if (process.env.HARNESS_BOUNDARY_ROW === '1') {
      await c.query(
        `INSERT INTO expenses (user_id, entity_id, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz)`,
        [userId, entityId,
         { description: 'BOUNDARY PROBE', category: 'Other', amount: 777, deductible: 'no' },
         '2026-06-01T05:30:00.000Z']
      );
      out.boundaryRow = { amount: 777, instant: '2026-06-01T05:30:00.000Z' };
    }

    server = await bootServer(scratch.url);
    const http = new HarnessHttp(server.baseUrl);
    const login = await http.post('/api/auth/login', LOGIN);
    if (login.status !== 200) throw new Error(`login failed: HTTP ${login.status} ${login.text.slice(0, 200)}`);

    for (const key of PERIOD_KEYS) {
      const p = PERIODS[key];
      // The window is recorded as sent — it is the independent variable and must be visible
      // in the output, not inferred from the timezone name.
      out.windows[key] = {
        label: p.label,
        start: p.start.toISOString(),
        end: p.end.toISOString(),
        elapsedMonths: p.elapsedMonths,
      };
      const res = await http.get(`/api/reports?${toQuery(p)}`);
      if (res.status !== 200) {
        out.errors.push(`${key}: HTTP ${res.status} ${res.text.slice(0, 120)}`);
        out.figures[key] = null;
        continue;
      }
      const j = res.json;
      out.figures[key] = {
        revenue: j.revenue,
        cogs: j.cogs,
        grossProfit: j.grossProfit,
        opex: j.expenses,          // server names opex `expenses` (server.js:3313)
        netProfit: j.netProfit,
        outstanding: j.outstanding,
      };
    }
  } catch (err) {
    out.errors.push(String(err && err.message ? err.message : err));
  } finally {
    if (server) await server.close();
    try { await appPool.end(); } catch { /* ignore */ }
    await scratch.stop();
  }

  // Delimited so the parent can find it regardless of server log noise on stdout.
  process.stdout.write('\n<<<TZPROBE>>>' + JSON.stringify(out) + '<<<END>>>\n');
}

main().catch((err) => {
  process.stdout.write('\n<<<TZPROBE>>>' + JSON.stringify({
    tz: process.env.HARNESS_TZ || '(default)',
    fatal: String(err && err.stack ? err.stack : err),
  }) + '<<<END>>>\n');
  process.exitCode = 0;
});
