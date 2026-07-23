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
    accountant: '/api/accountant-messages',
    prefill: '/api/recurring-personal-transactions',
  };

  let h;
  try {
    h = await bootSpaInJsdom({ failMap: { [PATHS[scenario]]: status } });

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
function spawnProbe(scenario, status) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '-r', path.join(__dirname, 'clock.js'),
      path.join(__dirname, 'boot-failures-gate.js'),
    ], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, BF_SCENARIO: scenario, BF_STATUS: status },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', () => {
      const m = stdout.match(/<<<BF>>>([\s\S]*?)<<<END>>>/);
      if (!m) return resolve({ scenario, status, results: [], fatal: `no result block\n${stdout.slice(-800)}\n${stderr.slice(-800)}` });
      try { resolve(JSON.parse(m[1])); } catch (e) { resolve({ scenario, status, results: [], fatal: 'parse: ' + e.message }); }
    });
  });
}

async function runGate() {
  console.log('\n' + '═'.repeat(76));
  console.log('  BOOT FAILURE GATE — executing each F96-class treatment\'s failure path (Rule 14)');
  console.log('  status code (!res.ok branch) AND network rejection (catch branch), per treatment');
  console.log('═'.repeat(76));

  let pass = 0, fail = 0;
  for (const s of SCENARIOS) {
    process.stdout.write(`\n  ── ${s.key} [${s.status}] ` + '─'.repeat(Math.max(0, 50 - s.key.length - s.status.length)) + '\n');
    const r = await spawnProbe(s.key, s.status);
    if (r.fatal) { fail++; console.log(`     FATAL: ${String(r.fatal).split('\n')[0]}`); continue; }
    for (const a of r.results) {
      if (a.ok) { pass++; console.log(`     PASS  ${a.name}`); }
      else { fail++; console.log(`     FAIL  ${a.name}${a.detail ? '\n             ' + a.detail : ''}`); }
    }
  }

  console.log('\n' + '═'.repeat(76));
  console.log(`  BOOT FAILURE GATE — ${pass} passed, ${fail} failed`);
  console.log('═'.repeat(76) + '\n');
}

if (process.env.BF_SCENARIO) {
  runProbe(process.env.BF_SCENARIO, process.env.BF_STATUS);
} else {
  runGate().catch((e) => { console.error('[gate] FAILED', e); process.exitCode = 0; });
}
