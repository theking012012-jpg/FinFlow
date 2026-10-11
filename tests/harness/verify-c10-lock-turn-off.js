'use strict';
/**
 * C10 (Cowork end-to-end test 7.4): the transaction lock can be turned off from its page.
 * BUG: switching the toggle off hid the panel that held the Save button, so "off" could never be saved; the lock
 * stayed on (Cowork had to move the lock date to 2000-01-01 instead).
 * Seed: clientMoneyKit. Lock the books through 2026-06-30 from the page, reopen the page, switch the toggle off.
 *   a "Turn off lock" button is visible            bug: no button (hidden with the panel)
 *   after clicking it the server lock is off        bug: still on
 *   reopening the page shows the toggle off (control)
 */
const { run } = require('./clientMoneyKit.js');

run('C10 — the transaction lock can be turned off', async ({ w, d, ev, settle, eq, http }) => {
  const open = async () => { try { w.showPage('transaction-locking'); } catch (_) {} await settle(15, 60); if (typeof w.renderLockHistory === 'function') { await w.renderLockHistory(); await settle(10, 40); } };
  await open();
  ev(`document.getElementById('lock-enabled').checked=true; toggleLocking(); document.getElementById('lock-date').value='2026-06-30';`);
  await w.saveLockSettings(); await settle(15, 60);
  eq('lock saved on', !!((await http.get('/api/lock-settings')).json || {}).enabled, true);

  await open();
  eq('page shows the lock on', d.getElementById('lock-enabled').checked, true);
  ev(`document.getElementById('lock-enabled').checked=false; toggleLocking();`);
  const btn = d.getElementById('lock-save-btn');
  const visible = !!btn && d.getElementById('lock-config').style.display !== 'none';
  eq('switching off leaves a "Turn off lock" button', [visible, btn && btn.textContent], [true, 'Turn off lock'], [false, 'Save lock settings']);
  if (visible) btn.click();   // what a user can click — nothing, when the button is hidden
  await settle(25, 60);
  eq('server lock is off', !!((await http.get('/api/lock-settings')).json || {}).enabled, false, true);
  await open();
  eq('control: reopened page shows the lock off', d.getElementById('lock-enabled').checked, false);
});
