'use strict';
/**
 * verify-fab1-auto-emails-ui.js — FA-B1, the screen. The Templates page listed six "Email Templates" with "Auto — …"
 * triggers nothing ran (two of them — quote follow-up, welcome — had no sender at all); its editor's Save and Send test
 * toasted "coming soon"; Settings "Email alerts — notify on overdue invoices" was read by nothing.
 * After: the card is "Automatic emails" — the four FinFlow really sends, each with an on/off switch (and its days), an
 * editor that saves to the business, and "Send a test to me"; the Settings switch is the owner's overdue alert.
 * Real SPA in jsdom + real bundle + real scratch Postgres; every action is checked against what the SERVER stored.
 *   node -r ./tests/harness/clock.js tests/harness/verify-fab1-auto-emails-ui.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');
process.on('uncaughtException', (e) => { const s = String(e && e.message || e); if (/_location/.test(s)) return; throw e; });

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };
  try {
    boot = await bootSpaInJsdom({ baseSeed: false, seedExtra: async (c, uid) => {
      await c.query(`INSERT INTO entities (user_id, entity_id, data) VALUES ($1, NULL, $2)`, [uid, { name: 'Northwind', currency: 'USD', timezone: 'UTC', country: 'US', is_active: 1 }]);
    } });
    const { window, http, settle } = boot;
    const d = window.document;
    const toast = () => ((d.getElementById('notif-text') || {}).textContent || '').trim();   // what notify() shows
    for (let i = 0; i < 250 && typeof window.renderTemplates !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
    await settle(14, 100);
    try { window.showPage('templates'); } catch (_) {}
    await settle(4, 40);
    try { window.renderTemplates(); } catch (_) {}
    await settle(10, 60);
    const list = () => ((d.getElementById('email-templates-list') || {}).textContent || '').replace(/\s+/g, ' ');
    A('1  the card lists the four emails FinFlow sends, each Off at first (bug: six "Auto —" rows nothing sent)', ['Payment reminder', 'Overdue notice', 'Payment receipt', 'Monthly statement'].every(t => list().includes(t)) && !/Auto —|Quote Follow-up|Welcome/.test(list()) && (list().match(/Off/g) || []).length === 4, list().slice(0, 300));
    const sw = d.querySelector('#email-templates-list input[data-ae="reminder"]');
    if (sw) { sw.checked = true; sw.dispatchEvent(new window.Event('change')); }
    await settle(8, 50);
    const srv = async () => ((await http.get('/api/auto-emails')).json || {});
    A('2  switching the payment reminder on is saved for the business', ((await srv()).settings || {}).reminder && (await srv()).settings.reminder.on === true, '');
    const days = d.querySelector('#email-templates-list input[type="number"]');
    if (days) { days.value = '10'; days.dispatchEvent(new window.Event('change')); }
    await settle(8, 50);
    A('3  its days (10) are saved', ((await srv()).settings.reminder || {}).days_after_due === 10, JSON.stringify((await srv()).settings.reminder));
    try { await window.openEmailTemplateEditor('reminder'); } catch (e) { A('editor opened', false, e.message); }
    await settle(3, 30);
    const subj = d.getElementById('ae-subject');
    A('4  the editor shows the saved template and only the placeholders it can fill', !!subj && /\{\{invoice_number\}\}/.test(subj.value) && !/portal_link/.test(d.getElementById('email-tmpl-editor').textContent), '');
    if (subj) subj.value = 'Gentle nudge: {{invoice_number}}';
    try { await window._ffSaveEmailTemplate('reminder'); } catch (e) { A('save ran', false, e.message); }
    await settle(4, 40);
    A('5  Save stores it for the business (bug: "saving is coming soon")', ((await srv()).templates.reminder || {}).subject === 'Gentle nudge: {{invoice_number}}' && toast() === 'Saved ✦', toast());
    try { await window.openEmailTemplateEditor('reminder'); await window._ffTestEmailTemplate('reminder'); } catch (e) { A('test ran', false, e.message); }
    await settle(3, 30);
    const last = toast();
    A('6  "Send a test to me" really tries to send — here the server has no email service, and says so (bug: "coming soon")', /not set up|isn.t available|Test sent to/i.test(last) && !/coming soon/i.test(last), last);
    try { window.showPage('settings'); } catch (_) {}
    await settle(6, 50);
    const al = d.getElementById('s-email-alerts');
    if (al) { al.checked = true; al.dispatchEvent(new window.Event('change')); }
    await settle(8, 50);
    A('7  Settings "Email alerts" turns on the owner\'s overdue alert for this business (bug: read by nothing)', ((await srv()).settings.owner_alert || {}).on === true, '');
  } catch (e) { console.error('\n  FATAL:', e && e.stack || e); fail++; }
  finally { try { if (boot && boot.stop) await boot.stop(); } catch (_) {} }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (FA-B1 automatic emails UI)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
