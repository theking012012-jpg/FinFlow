'use strict';
/**
 * verify-n3-21-owner-chat-label.js — N3-21 (live chat check 2026-11-11).
 * On the owner's My Accountant chat, a message the owner had JUST sent was labelled "Client · <time>"; after a reload it
 * read "You · <time>". The live (SSE) copy of the owner's own message carries sender_name "Client" (the accountant's view
 * of the sender), and the owner renderer printed sender_name as given.
 * Executed in Chromium (browserKit, real server): owner linked to a real accountant; the owner opens My Accountant (live
 * stream connects), types a message and presses Send through the page's own sendMsgToAccountant().
 * EXPECTED: the owner's bubble is labelled "You"; the accountant's message "Your accountant" (or their name).
 * BUG VALUE: "Client".
 */
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');

runBrowser('N3-21 — the owner\'s own chat message is labelled "You", live and after reload', async ({ open, A, c, uid }) => {
  const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
     VALUES ('n321-acc@finflow.test', $1, 'Ada', 'Ledger', 'Firm', 'N321', 'verified') RETURNING id`, [bcrypt.hashSync('x-not-a-secret', 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1, $2, 'active', 'view')`, [acc, uid]);
  await c.query(`INSERT INTO accountant_messages (accountant_id, user_id, message, sender, created_at) VALUES ($1, $2, 'Hello from Ada', 'accountant', NOW() - interval '1 minute')`, [acc, uid]);
  const page = await open({ width: 1280, height: 900 });
  await page.evaluate(() => window.showPage('my-accountant'));
  await page.waitForTimeout(2500);
  await page.fill('#acct-chat-input', 'Owner says hi');
  await page.evaluate(() => window.sendMsgToAccountant());
  await page.waitForTimeout(1500);
  const labels = async () => page.evaluate(() => [...document.querySelectorAll('#acct-chat-panel div')].map(d => d.textContent.trim()).filter(t => /^[^·]{1,40} · \d/.test(t) && t.length < 60));
  const live = await labels();
  A('the accountant\'s message is shown', await page.evaluate(() => /Hello from Ada/.test(document.getElementById('acct-chat-panel').textContent)));
  A('right after sending, the owner\'s own message is labelled "You" (bug: "Client")', live.length >= 2 && /^You · /.test(live[live.length - 1]) && !live.some(l => /^Client · /.test(l)), JSON.stringify(live));
  await page.evaluate(() => window.loadAccountantMessages());
  await page.waitForTimeout(1200);
  const after = await labels();
  A('after reloading the thread: still "You", and the accountant\'s is not "You"', /^You · /.test(after[after.length - 1]) && !/^You · /.test(after[0]), JSON.stringify(after));
});
