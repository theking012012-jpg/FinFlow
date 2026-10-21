'use strict';
/**
 * verify-lr8-budget-audit-units.js — LR8 (owner decision 2026-10-21: record both units). The budget audit row recorded
 * only the stored annual figure ("Software: 300") — not the 25 / month the person typed — and the modal's saves arrived
 * nested ({targets:{…}}), so the Audit page showed one JSON blob instead of a line per category.
 *
 * Real scratch Postgres, real server, real SPA (bundle). Seed Software 300 / yr; in the Monthly view type 30 → saves
 * 360 / yr. Bug values (Rule 4) beside each check.
 *   stored target 360, and the stored targets carry no "entered" key          (old: 360 — guard)
 *   audit row: Software 300 → 360, and _entered.Software = "30 / month"        (old: nested {targets:…}, nothing typed)
 *   the Audit page line: "300 / year" → "360 / year (entered 30 / month)"     (old: a JSON blob)
 *
 *   node bundle.js && node -r ./tests/harness/clock.js tests/harness/verify-lr8-budget-audit-units.js
 */
require('./clock.js');
const { bootSpaInJsdom } = require('./jsdomBoot.js');

let pass = 0, fail = 0;
const eq = (n, m, e, bug) => { const ok = JSON.stringify(m) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  [measured ${JSON.stringify(m)}, correct ${JSON.stringify(e)}${bug !== undefined ? ', bug gives ' + JSON.stringify(bug) : ''}]`); };

(async () => {
  let boot, client, eid;
  console.log('\nLR8 — the budget audit says what was typed and what was stored, with units\n');
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, apiSeed: async ({ http, client: c, userId }) => {
      client = c;
      const J = async (m, p, b) => { const r = await http.request(m, p, b); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + r.text); return r.json; };
      await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [userId]);
      const e = await J('POST', '/api/entities', { name: 'LR8 Co', currency: 'USD', timezone: 'UTC', country: 'US' });
      eid = e.id;
      await J('POST', '/api/entities/' + e.id + '/activate', {});
      await J('PUT', '/api/budget-targets', { targets: { Software: 300 } });
    } });
    const { window: w, settle } = boot; const d = w.document;
    await settle(80, 75);

    await w.openBudgetTargetsModal(); await settle(10, 25);
    w.document.querySelector('#_budget-targets-modal ._bt-period[data-period="monthly"]').click();
    const row = Array.from(d.querySelectorAll('#_budget-target-rows ._bt-row')).find(r => r.querySelector('[data-bt-cat]').value === 'Software');
    const inp = row.querySelector('[data-bt-amt]'); inp.value = '30'; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
    await w._saveBudgetTargets(); await settle(20, 30);

    const st = (await client.query(`SELECT data->'targets' t FROM budget_targets WHERE entity_id = $1`, [eid])).rows[0];
    const flat = st && st.t && st.t.targets ? st.t.targets : (st && st.t);
    eq('stored: Software 360 / yr, and no "entered" kept as a target (guard)', [flat && flat.Software, !!(st && st.t && st.t.entered)], [360, false]);

    const a = (await client.query(`SELECT old_data, new_data FROM audit_trail WHERE table_name = 'budget_targets' AND action = 'UPDATE' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [eid])).rows[0];
    eq('audit row: Software 300 → 360, with what was typed (30 / month)',
      a ? [a.old_data && a.old_data.Software, a.new_data && a.new_data.Software, a.new_data && a.new_data._entered && a.new_data._entered.Software] : null,
      [300, 360, '30 / month'], [undefined, undefined, undefined]);

    w.showPage('audit'); await settle(10, 20);
    if (typeof w.loadAuditTrail === 'function') await w.loadAuditTrail();
    await settle(20, 30);
    const txt = ((d.getElementById('audit-trail-body') || {}).textContent || '').replace(/\s+/g, ' ');
    eq('the Audit page line reads 300 / year → 360 / year (entered 30 / month)', /Software\s*300 \/ year\s*360 \/ year \(entered 30 \/ month\)/.test(txt), true, false);
    eq('…and shows no "_entered" field or JSON blob', /_entered|\{"/.test(txt), false, true);
  } catch (e) { fail++; console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
