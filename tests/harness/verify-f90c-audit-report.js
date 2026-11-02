'use strict';
/**
 * verify-f90c-audit-report — F90 part 3. The Audit log is a report: filter by WHO, by the BUSINESS's calendar days, by
 * words in the record; page through all of it; export the whole filtered trail as CSV or PDF (not just the rows on
 * screen); every export is itself recorded.
 *
 * BUG: the page loaded the newest 500 entries and nothing older, had no person / date / search filter, and its CSV
 * copied the rows on screen — an export of "everything" silently stopped at 500.
 *
 * Executed: the real /app in Chromium, real server, scratch Postgres (Rule 3). The business is Asia/Tokyo (UTC+9).
 * Seed (hand-made, independent of the code — Rule 6):
 *   · 2 entries at 2026-07-01 16:30 UTC = 2 July 01:30 in Tokyo, by the owner — on the business's 2 July
 *     (bug, UTC day: 1 July — a "2 July only" filter would miss them, a "1 July only" filter would wrongly show them);
 *   · 1 entry at 2026-07-02 14:30 UTC = 2 July 23:30 Tokyo, by the team member Casey;
 *   · 1 entry at 2026-07-02 15:30 UTC = 3 July 00:30 Tokyo, by Casey (bug, UTC day: 2 July);
 *   · 620 older entries on 1 June (more than one page of 500).
 *   Expected for From = To = 2 July: 3 entries (owner 2, Casey 1); Casey alone: 1; search "Lighthouse": 1.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-f90c-audit-report.js
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('F90 part 3 — the audit log as a report', async ({ open, A, eq, J, c, uid, http }) => {
  await c.query(`UPDATE users SET data = data || '{"name":"Avery Owner"}'::jsonb WHERE id = $1`, [uid]);
  const eid = (await c.query(`SELECT id FROM entities WHERE user_id = $1 ORDER BY id LIMIT 1`, [uid])).rows[0].id;
  await c.query(`UPDATE entities SET data = data || '{"timezone":"Asia/Tokyo"}'::jsonb WHERE id = $1`, [eid]);
  const casey = (await c.query(`INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1) RETURNING id`, [{ email: 'casey@finflow.test', name: 'Casey Clerk', role: 'owner' }])).rows[0].id;
  const ins = (at, actor, rec, data) => c.query(`INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, new_data, actor_type, actor_id, changed_at, source)
      VALUES ($1,$2,'invoices',$3,'CREATE',$4,'user',$5,$6,'web POST /api/invoices')`, [uid, eid, rec, JSON.stringify(data), actor, at]);
  await ins('2026-07-01T16:30:00Z', uid, 9001, { client: 'Harbour Ltd', amount: 100 });
  await ins('2026-07-01T16:31:00Z', uid, 9002, { client: 'Lighthouse Co', amount: 200 });
  await ins('2026-07-02T14:30:00Z', casey, 9003, { client: 'Dock Inc', amount: 300 });
  await ins('2026-07-02T15:30:00Z', casey, 9004, { client: 'Pier Co', amount: 400 });
  await c.query(`INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, new_data, actor_type, actor_id, changed_at, source)
      SELECT $1, $2, 'expenses', 20000 + g, 'CREATE', jsonb_build_object('description', 'Old ' || g, 'amount', g), 'user', $1, TIMESTAMPTZ '2026-06-01T03:00:00Z' + (g || ' seconds')::interval, 'web POST /api/expenses'
        FROM generate_series(1, 620) g`, [uid, eid]);

  // ── server: the business's calendar day, who, search ──
  const get = async q => (await J('GET', '/api/audit-log?' + q)).rows.filter(r => r.record_id >= 9001 && r.record_id <= 9004).map(r => r.record_id).sort();
  eq('From = To = 2 July (Tokyo): the two 01:30 entries and the 23:30 one (bug, UTC days: 9003 and 9004)', await get('from=2026-07-02&to=2026-07-02'), [9001, 9002, 9003], [9003, 9004]);
  eq('…and 1 July (Tokyo) holds none of them (bug: 9001, 9002)', await get('from=2026-07-01&to=2026-07-01'), [], [9001, 9002]);
  eq('Who = Casey, on 2 July: only Casey\'s entry', await get('from=2026-07-02&to=2026-07-02&actor=user:' + casey), [9003]);
  eq('Search "Lighthouse": that one record', await get('q=Lighthouse'), [9002]);

  // ── export: the WHOLE filtered trail, not the page ──
  const csv = await http.request('GET', '/api/audit-log/export?format=csv&type=expenses');
  const body = String(csv.text || '');
  const dataLines = body.replace(/^﻿/, '').split(/\r\n/).slice(1).filter(Boolean);
  A('CSV export of every expense entry: 620 entries → ≥ 620 lines (bug: at most the 500 on screen)', csv.status === 200 && dataLines.length >= 620, 'status ' + csv.status + ' lines ' + dataLines.length);
  A('…its times are the business\'s (header names Asia/Tokyo; 1 June 03:00:01 UTC → 2026-06-01 12:00:01)', /When \(Asia\/Tokyo\)/.test(body) && body.includes('2026-06-01 12:00:01'), body.slice(0, 200));
  const exp = (await c.query(`SELECT new_data FROM audit_trail WHERE user_id = $1 AND action = 'EXPORT' AND table_name = 'audit_trail' ORDER BY id DESC LIMIT 1`, [uid])).rows[0];
  A('the export is itself on the trail (EXPORT, with its filters and size)', !!exp && exp.new_data.filters.type === 'expenses' && exp.new_data.entries >= 620, JSON.stringify(exp && exp.new_data));

  // ── the page ──
  const page = await open({ width: 1400, height: 900 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.showPage('audit')); await page.waitForTimeout(2000);
  const ui = await page.evaluate(() => ({ from: !!document.getElementById('audit-filter-from'), to: !!document.getElementById('audit-filter-to'),
    who: Array.from((document.getElementById('audit-filter-actor') || { options: [] }).options).map(o => o.textContent.trim()), q: !!document.getElementById('audit-filter-q'),
    more: !(document.getElementById('audit-load-more') || { classList: { contains: () => true } }).classList.contains('hidden'),
    loaded: Number((document.getElementById('audit-event-count') || {}).textContent) }));
  A('the page has From / To / Who / Search, and Who lists Avery Owner and Casey Clerk', ui.from && ui.to && ui.q && ui.who.includes('Avery Owner') && ui.who.includes('Casey Clerk'), JSON.stringify(ui));
  A('more than one page: "Load older entries" is offered (bug: the trail stopped at 500)', ui.more && ui.loaded <= 500, JSON.stringify(ui));
  await page.evaluate(() => window.loadAuditTrail(true)); await page.waitForTimeout(1500);
  const loaded2 = await page.evaluate(() => Number(document.getElementById('audit-event-count').textContent));
  A('Load older entries adds the rest (≥ 624 events loaded)', loaded2 >= 624, 'loaded ' + loaded2);
  await page.evaluate(() => { document.getElementById('audit-filter-from').value = '2026-07-02'; document.getElementById('audit-filter-to').value = '2026-07-02'; return window.loadAuditTrail(); });
  await page.waitForTimeout(1500);
  const recs = await page.evaluate(() => Array.from(document.querySelectorAll('#audit-trail-body tr')).map(tr => (tr.querySelectorAll('td')[2] || {}).textContent).filter(Boolean));
  eq('the page with From = To = 2 July shows records 9001, 9002, 9003 (one line per field)', [...new Set(recs)].sort(), ['9001', '9002', '9003']);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.evaluate(() => window.exportAuditPDF())]);
  A('Export PDF downloads a PDF of the filtered trail', !!dl && /^audit-log-.*\.pdf$/.test(dl.suggestedFilename()), dl ? dl.suggestedFilename() : 'no download');
  eq('no page errors', errs, []);
}, {});
