'use strict';
/**
 * M44 (money audit 2026-10-09): /api/v1/reports/summary uses the OWNER's fiscal year, and an entity-scoped key's
 * lists include the same rows its summary counts.
 * BUG: the summary always used a January fiscal year; the key's lists excluded legacy entity-less rows that
 * computeBooks (the summary) includes, so the lists never added up to the summary.
 * Seed (today pinned 2026-07-25; owner fiscal year starts JULY → FY 2026-07-01 … 2027-06-30):
 *   entity invoices 500 (2026-03-10) and 200 (2026-07-10); legacy entity-less invoice 50 (2026-07-12)
 *   correct revenue 250 (200 + 50, July FY) · bug 750 (January FY: 500 + 200 + 50)
 *   correct: the entity key's invoice list includes "Legacy" · bug: it does not
 */
const { run } = require('./moneyFixKit.js');

run('M44 — API summary fiscal year and entity scope', async ({ newOwner, c, eq, server }) => {
  const { uid, J, ids } = await newOwner('M44');
  await J('PUT', '/api/settings', { fiscal_year: 'July' });
  await J('POST', '/api/invoices', { client: 'March', amount: 500, status: 'pending', issue_date: '2026-03-10', due_date: '2026-04-10', idempotency_key: 'm44-1' });
  await J('POST', '/api/invoices', { client: 'July', amount: 200, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-10', idempotency_key: 'm44-2' });
  // Legacy (pre-F150) shape: the NOT VALID chk_invoices_entity_nn constraint blocks NEW entity-less rows, so it is
  // dropped in this scratch database only, to reproduce rows that exist from before it.
  await c.query(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_entity_nn`);
  await c.query(`INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW())`,
    [uid, { client: 'Legacy', amount: 50, amount_paid: 0, status: 'pending', issue_date: '2026-07-12', due_date: '2026-08-12' }]);
  const key = (await J('POST', '/api/api-keys', { name: 'entity key', entity_id: ids[0] })).key;
  const api = async p => { const r = await fetch(server.baseUrl + p, { headers: { Authorization: 'Bearer ' + key, 'X-Forwarded-For': '203.0.113.244' } }); return r.json(); };
  const sum = await api('/api/v1/reports/summary');
  eq('summary revenue for the owner\'s July fiscal year', Number(sum.revenue), 250, 750);
  const list = await api('/api/v1/invoices');
  eq('the entity key\'s invoice list includes the legacy entity-less invoice its summary counts',
    (list.data || []).some(i => i.client === 'Legacy'), true, false);
});
