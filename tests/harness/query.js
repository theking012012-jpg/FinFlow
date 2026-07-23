'use strict';
/**
 * query.js — read-only SQL client for a kept scratch cluster.
 *
 *   node tests/harness/query.js "SELECT * FROM invoices"
 *   node tests/harness/query.js --tables
 *   node tests/harness/query.js --seed          (the seeded rows, formatted)
 *
 * WHY THIS EXISTS: `embedded-postgres` bundles postgres.exe and pg_ctl.exe but NOT psql.exe,
 * so a kept cluster has no shell to connect with. `--keep` is useless without a client.
 *
 * READ-ONLY BY CONSTRUCTION (CLAUDE.md Rule 7):
 *   · every statement runs inside a READ ONLY transaction, so a write is rejected by
 *     POSTGRES, not by a regex over the SQL text. A blocklist of keywords can be defeated by
 *     a CTE, a function call or a comment; `SET TRANSACTION READ ONLY` cannot.
 *   · connects only to a loopback scratch URL, via the same guard as everything else.
 *   · no apply mode, no --write flag, no transaction control exposed.
 *
 * It reads SCRATCH_DATABASE_URL, which the step-2 gate prints when run with --keep.
 * It does NOT read DATABASE_URL — pointing this at production is not a supported mistake.
 */

const { Client } = require('pg');
const guard = require('./guard.js');

const ARGS = process.argv.slice(2);

const PRESETS = {
  '--tables': `
    SELECT table_name,
           (xpath('/row/c/text()',
             query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')
           ))[1]::text::int AS rows
      FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY rows DESC, table_name`,
  '--seed': `
    SELECT 'invoice' AS kind, data->>'num' AS ref, data->>'issue_date' AS date,
           (data->>'amount')::numeric AS amount, data->>'status' AS status
      FROM invoices
    UNION ALL
    SELECT 'bill', data->>'num', data->>'issue_date', (data->>'amount')::numeric, data->>'status'
      FROM bills
    UNION ALL
    SELECT 'expense', data->>'category', data->>'expense_date', (data->>'amount')::numeric, NULL
      FROM expenses
    UNION ALL
    SELECT 'payroll_run', period, run_date::text, total_gross, status
      FROM payroll_runs
    UNION ALL
    SELECT 'payment_made', data->>'ref', data->>'date', (data->>'amount')::numeric,
           CASE WHEN data->>'bill_id' IS NULL THEN 'UNLINKED' ELSE 'linked bill ' || (data->>'bill_id') END
      FROM payments_made
    UNION ALL
    SELECT 'holding', data->>'ticker', NULL,
           (data->>'shares')::numeric * (data->>'price')::numeric, data->>'asset_type'
      FROM holdings
    ORDER BY kind, ref`,
};

function usage() {
  console.log(`
  query.js — read-only SQL against a kept scratch cluster.

    node tests/harness/query.js "SELECT ..."     run a query
    node tests/harness/query.js --tables         every table with its row count
    node tests/harness/query.js --seed           the seeded rows, formatted

  Requires SCRATCH_DATABASE_URL (printed by the step-2 gate when run with --keep):

    SCRATCH_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:PORT/finflow_scratch" \\
      node tests/harness/query.js --seed

  All statements run inside a READ ONLY transaction — writes are refused by Postgres itself.
`);
}

/** Minimal column-aligned table. */
function render(result) {
  const { rows, fields } = result;
  if (!rows.length) { console.log('  (0 rows)'); return; }
  const cols = fields.map((f) => f.name);
  const cell = (v) => (v === null || v === undefined ? '' : String(v));
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...rows.map((r) => cell(r[cols[i]]).length)));
  const line = (parts) => '  ' + parts.map((p, i) => p.padEnd(widths[i])).join('  ');
  console.log(line(cols));
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(cols.map((c) => cell(r[c]))));
  console.log(`  (${rows.length} row${rows.length === 1 ? '' : 's'})`);
}

async function main() {
  if (!ARGS.length || ARGS[0] === '--help' || ARGS[0] === '-h') { usage(); return; }

  const url = process.env.SCRATCH_DATABASE_URL;
  if (!url) {
    console.error('[query] SCRATCH_DATABASE_URL is not set.');
    console.error('[query] Run the step-2 gate with --keep; it prints the URL to use.');
    console.error('[query] (DATABASE_URL is deliberately NOT read — see F78.)');
    process.exitCode = 1;
    return;
  }

  guard.assertScratchUrl(url);   // throws, loudly, on anything that is not loopback scratch

  const sql = PRESETS[ARGS[0]] || ARGS.join(' ');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await guard.assertScratchDatabase(client);
    // The read-only guarantee. Postgres enforces it; no text inspection is involved.
    await client.query('BEGIN READ ONLY');
    const result = await client.query(sql);
    render(result);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\n[query] FAILED');
  console.error('  ' + (err && err.message ? err.message : err));
  if (err && err.code) console.error('  code:   ' + err.code);
  if (err && err.detail) console.error('  detail: ' + err.detail);
  if (err && err.hint) console.error('  hint:   ' + err.hint);
  if (err instanceof AggregateError && err.errors) {
    for (const e of err.errors) console.error('  · ' + (e && e.message ? e.message : e));
  }
  process.exitCode = 1;
});
