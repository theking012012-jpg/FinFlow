'use strict';
/**
 * boot-failures-gate.js — EXECUTE the failure path of every F96-class treatment.
 *
 *   node -r ./tests/harness/clock.js tests/harness/boot-failures-gate.js
 *
 * Rule 14: a fix is not verified until its failure path is executed. Each treatment is failed by
 * BOTH a status code (the !res.ok branch) and a network rejection (the catch branch) — different
 * code paths. Assertions are on SETTLED state (DOM, DB, wire body), never first paint.
 *
 * DUAL MODE. `database.js` holds a single module-level Pool, so a fresh scratch cluster cannot be
 * booted twice in one process (the first stop() ends the shared pool). So each scenario runs in
 * its OWN process — same split as tz-matrix/tz-probe. With BF_SCENARIO set this file IS the probe
 * (one scenario, prints a JSON result block); without it, it is the gate (spawns the probe per
 * scenario and aggregates).
 *
 * PREFILL is the one that matters — being wrong there DESTROYS DATA. It drives the real modal +
 * save and asserts, against the DATABASE, that recurring_profile_id is UNCHANGED, and that the
 * PUT body over the wire OMITS the field rather than trusting JSON.stringify to drop it.
 */

const path = require('path');
const { spawn } = require('child_process');

const SCENARIOS = [
  { key: 'banking',    status: '500' },
  { key: 'banking',    status: 'network' },
  { key: 'mrr',        status: '500' },
  { key: 'mrr',        status: 'network' },
  { key: 'accountant', status: '500' },
  { key: 'prefill',    status: '500' },
  { key: 'prefill',    status: 'network' },
];

let _probeHarness = null;
// The gate asks a probe that ran out of time to stop: tear down its jsdom + server + scratch cluster, then exit. Without
// this, killing the probe leaves its scratch Postgres running (seen 2026-11-03: three orphaned clusters).
process.on('message', async (m) => {
  if (m !== 'stop') return;
  try { if (_probeHarness) await _probeHarness.stop(); } catch { /* best effort */ }
  process.exit(0);
});
// The message channel must not keep a finished probe alive (a healthy probe exits on its own, as before).
if (process.channel && typeof process.channel.unref === 'function') process.channel.unref();

// ─────────────────────────────────────────────────────────────────────────────
// PROBE — one scenario in its own process
// ─────────────────────────────────────────────────────────────────────────────
async function runProbe(scenario, statusRaw) {
  const { bootSpaInJsdom } = require('./jsdomBoot.js');
  const status = statusRaw === 'network' ? 'network' : parseInt(statusRaw, 10);
  const out = { scenario, status: statusRaw, results: [], fatal: null };
  const A = (name, ok, detail) => out.results.push({ name, ok: !!ok, detail: ok ? null : (detail || null) });
  const has = (arr, sub) => arr.some((m) => m.includes(sub));

  const PATHS = {
    banking: '/api/banking',
    mrr: '/api/recurring-invoices',
    accountant: '/api/accountants/my-accountant/messages',   // chat client-load endpoint (was /api/accountant-messages)
    prefill: '/api/recurring-personal-transactions',
  };

  let h;
  try {
    h = await bootSpaInJsdom({ failMap: { [PATHS[scenario]]: status } });
    _probeHarness = h;
    // BF_HANG=<scenario>/<status>: this probe boots, then never finishes — executes the gate's per-probe timeout and its
    // clean stop (Rule 14). Test-only; the gate never sets it.
    if (process.env.BF_HANG === scenario + '/' + statusRaw) await new Promise(() => {});

    if (scenario === 'banking' || scenario === 'mrr' || scenario === 'accountant') {
      const label = scenario === 'banking' ? 'Banking' : scenario === 'mrr' ? 'MRR' : 'AccountantMessages';
      const tag = scenario === 'banking' ? '[Banking]' : scenario === 'mrr' ? '[MRR]' : '[AccountantMessages]';
      // Let the bundle load and boot loaders run FIRST. banking runs on ff:authed at boot; MRR and
      // accountant are page loaders not triggered by the dashboard, so DRIVE them here — but only
      // after settle, or the function isn't defined yet (that was the first run's "none matching").
      await h.settle(45, 100);
      if (scenario === 'mrr') { try { if (typeof h.window.loadMRRData === 'function') h.window.loadMRRData(); } catch { /* ignore */ } }
      if (scenario === 'accountant') { try { if (typeof h.window.loadAccountantMessages === 'function') h.window.loadAccountantMessages(); } catch { /* ignore */ } }
      await h.settle(20, 100);
      const errs = h.consoleErrors.concat(h.consoleWarns);
      A(`${label}: failure logged (${tag})`, has(errs, tag),
        `console tail: ${errs.slice(-4).join(' | ') || '(none)'}`);
      if (scenario !== 'accountant') {
        // Assert on the toast TEXT, which persists — the isError CLASS is transient (notify
        // auto-dismisses at ~3.6s and resets the class, so reading it after settle is a race).
        // notify(msg,true) writing this exact text IS the user-visible error toast.
        A(`${label}: user sees an error toast`, /could not load/i.test(h.toast().text || ''), `toast=${JSON.stringify(h.toast())}`);
      }
    }

    if (scenario === 'prefill') {
      await h.settle(35, 100);
      const { window: w, client } = h;
      const profId = (await client.query(
        `INSERT INTO recurring_personal_transactions (user_id, entity_id, data, created_at, updated_at)
         VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
        [h.userId, { description: 'Rent', category: 'Housing', amount: 1500, tx_type: 'expense',
          frequency: 'Monthly', status: 'active', currency: 'USD', next_run: '2026-08-01' }]
      )).rows[0].id;
      const txId = (await client.query(
        `INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at)
         VALUES ($1, NULL, $2, NOW(), NOW()) RETURNING id`,
        [h.userId, { description: 'Rent', category: 'Housing', amount: 1500, tx_type: 'expense',
          tx_date: '2026-07-01', currency: 'USD', recurring_profile_id: profId }]
      )).rows[0].id;

      const editTx = { _dbId: txId, type: 'expense', amount: 1500, desc: 'Rent', date: '2026-07-01', cat: 'Housing' };
      w._txRecurringUnknown = undefined;
      try { w.openTransactionModal(null, editTx); } catch (e) { A('modal opened', false, e.message); }
      await h.settle(14, 100);

      A('failed prefill flags state unknown', w._txRecurringUnknown === true, `_txRecurringUnknown=${w._txRecurringUnknown}`);
      const recurringChecked = !!(w.document.getElementById('tx-recurring') || {}).checked;
      A('recurring toggle at unchecked default (the hazard)', recurringChecked === false);

      try { await w.saveTransaction(); } catch (e) { A('save ran', false, e.message); }
      await h.settle(18, 100);

      const put = h.wireLog.find((r) => r.method === 'PUT' && r.path === '/api/personal-transactions/' + txId);
      A('PUT sent for the transaction', !!put, `wire: ${h.wireLog.map((r) => r.method + ' ' + r.path).join(', ')}`);
      if (put) A('PUT body OMITS recurring_profile_id (not null)', !/recurring_profile_id/.test(put.body), `body=${put.body}`);

      const dbVal = (await client.query(
        `SELECT data->>'recurring_profile_id' AS rpid FROM personal_transactions WHERE id = $1`, [txId]
      )).rows[0].rpid;
      A(`DB recurring_profile_id UNCHANGED (${profId}, not null)`, String(dbVal) === String(profId), `db=${JSON.stringify(dbVal)}`);
    }
  } catch (e) {
    out.fatal = e && e.stack ? e.stack : String(e);
  } finally {
    if (h) { try { await h.stop(); } catch { /* ignore */ } }
  }

  process.stdout.write('\n<<<BF>>>' + JSON.stringify(out) + '<<<END>>>\n');
  process.exitCode = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE — spawn the probe per scenario, aggregate
// ─────────────────────────────────────────────────────────────────────────────
// Each probe gets its own budget: a hung probe is killed and reported BY NAME (FATAL), instead of the whole gate
// running into the sweep's per-harness limit and coming back as a bare TIMEOUT with no verdict.
const PROBE_TIMEOUT_MS = parseInt(process.env.BF_PROBE_TIMEOUT_MS || '90000', 10);
// Probes run JOBS at a time. Each is its own process with its own scratch cluster on an OS-assigned port, so they share
// nothing. Sequential, the gate took 163–178s on the owner's machine against the sweep's 180s limit (sweep logs
// 2026-10-28/29/11-02) and timed out once (sweep 2026-11-03 run 2).
const JOBS = Math.max(1, parseInt(process.env.BF_JOBS || String(Math.min(3, require('os').cpus().length || 1)), 10));

function spawnProbe(scenario, status) {
  const t0 = process.hrtime.bigint();   // hrtime, not Date — clock.js pins Date
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '-r', path.join(__dirname, 'clock.js'),
      path.join(__dirname, 'boot-failures-gate.js'),
    ], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, BF_SCENARIO: scenario, BF_STATUS: status },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '', stderr = '', timedOut = false, forced = false;
    // Out of time: ask the probe to stop cleanly (it tears down its scratch cluster); force-kill only if it cannot.
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.send('stop'); } catch { /* ignore */ }
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) { forced = true; try { child.kill('SIGKILL'); } catch { /* ignore */ } } }, 15000).unref();
    }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', () => {
      clearTimeout(timer);
      const secs = (Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1);
      const done = (r) => resolve(Object.assign(r, { secs }));
      if (timedOut) return done({ scenario, status, results: [], fatal: `probe did not finish within ${PROBE_TIMEOUT_MS / 1000}s — ${forced ? 'force-killed (its scratch database may still be running)' : 'stopped cleanly'}\n${stdout.slice(-800)}\n${stderr.slice(-800)}` });
      const m = stdout.match(/<<<BF>>>([\s\S]*?)<<<END>>>/);
      if (!m) return done({ scenario, status, results: [], fatal: `no result block\n${stdout.slice(-800)}\n${stderr.slice(-800)}` });
      try { done(JSON.parse(m[1])); } catch (e) { done({ scenario, status, results: [], fatal: 'parse: ' + e.message }); }
    });
  });
}

/** Run every scenario, JOBS at a time; results come back in SCENARIOS order so the report reads the same every run. */
async function runAll() {
  const out = new Array(SCENARIOS.length);
  let next = 0;
  const worker = async () => { while (next < SCENARIOS.length) { const i = next++; out[i] = await spawnProbe(SCENARIOS[i].key, SCENARIOS[i].status); } };
  await Promise.all(Array.from({ length: Math.min(JOBS, SCENARIOS.length) }, worker));
  return out;
}

async function runGate() {
  console.log('\n' + '═'.repeat(76));
  console.log('  BOOT FAILURE GATE — executing each F96-class treatment\'s failure path (Rule 14)');
  console.log('  status code (!res.ok branch) AND network rejection (catch branch), per treatment');
  console.log('═'.repeat(76));

  let pass = 0, fail = 0;
  const all = await runAll();
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i], r = all[i];
    process.stdout.write(`\n  ── ${s.key} [${s.status}] ` + '─'.repeat(Math.max(0, 50 - s.key.length - s.status.length)) + ` (${r.secs}s)\n`);
    if (r.fatal) { fail++; console.log(`     FATAL: ${String(r.fatal).split('\n')[0]}`); continue; }
    for (const a of r.results) {
      if (a.ok) { pass++; console.log(`     PASS  ${a.name}`); }
      else { fail++; console.log(`     FAIL  ${a.name}${a.detail ? '\n             ' + a.detail : ''}`); }
    }
  }

  console.log('\n' + '═'.repeat(76));
  console.log(`  ${fail ? fail + ' FAILED' : 'ALL GREEN'} — ${pass} passed, ${fail} failed  (boot failure gate)`);
  console.log('═'.repeat(76) + '\n');
  process.exitCode = fail ? 1 : 0;
}

if (process.env.BF_SCENARIO) {
  runProbe(process.env.BF_SCENARIO, process.env.BF_STATUS);
} else {
  runGate().catch((e) => { console.error('  FATAL: [gate] ' + (e && e.stack || e)); process.exitCode = 1; });   // a crashed gate is red, never a silent exit 0
}
