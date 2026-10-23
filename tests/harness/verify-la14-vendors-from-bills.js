'use strict';
/**
 * verify-la14-vendors-from-bills.js — LA14 (HANDOVER C19, Vendors part; same class as LA4): a bill or payment to a
 * vendor name with no saved vendor record was listed nowhere — the Vendors page read "0 vendors / No vendors yet"
 * while the business had bills. (The page's Payables / Overdue / Paid cards come from the books and were already
 * complete; the list and the count were not.)
 *
 * Real SPA, real scratch Postgres, clientMoneyKit seed (clock 2026-07-25): one bill, Supply Co 400 unpaid (issued
 * Jul 1). No vendor records. Expected: count 1 (bug 0); a "Supply Co · $400 owing · Not saved" row. Then Supply Co is
 * saved through the real Save path: count stays 1 (bug if double-listed: 2), the row is the saved vendor, $400 owing.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-la14-vendors-from-bills.js
 */
const { run } = require('./clientMoneyKit.js');

run('LA14 — Vendors page lists bill vendors that are not saved as vendors yet', async ({ w, d, settle, eq }) => {
  const open = async () => { w.showPage('vendors'); await settle(40, 50); };
  const count = () => (d.querySelector('#page-vendors .mc-val') || {}).textContent;
  const rows = () => [...d.querySelectorAll('#vendors-list .table-row')].map(r => [
    r.children[0].children[0].textContent.trim(),
    r.children[2].textContent.replace(/\s+/g, ' ').trim(),
    r.children[4].textContent.trim()]);
  await open();
  eq('vendor count', count(), '1', '0');
  eq('rows', rows(), [['Supply Co', '$400 owing', 'Not saved']], []);

  w.openVendorModalFromUnsaved(0);
  eq('Save pre-fills the vendor name', d.getElementById('vendor-name').value, 'Supply Co');
  await w.saveVendor();
  await settle(40, 50);
  eq('after saving: count still 1', count(), '1', '2');
  eq('after saving: the saved vendor, still $400 owing', rows(), [['Supply Co', '$400 owing', 'active']]);
}, { extraSeed: async ({ client, userId }) => {
  // Batch 9 (D3): bills made through the app now save their vendor automatically; the "not saved" flow this test covers
  // only exists for data from BEFORE that — recreated here: the seed's auto-saved vendors removed, links dropped.
  await client.query(`DELETE FROM vendors WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE bills SET data = data - 'vendor_id' WHERE user_id = $1`, [userId]);
} });
