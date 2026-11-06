'use strict';
/**
 * verify-new28-settings-business-name — NEW-28. On an account with several businesses, the Settings "Business name"
 * box must show THE ACTIVE BUSINESS's own name, so saving Settings (which renames the active business from that box —
 * rename_active_entity) never renames it to another business's name.
 *
 * BUG (found by F108's related run, 2026-11-06): applyEntityProfileFields (finflow-api-wiring.js — the only copy, Rule 1)
 * filled the box from the business's profile, ELSE THE ACCOUNT-WIDE business name, else the business's own name — the
 * opposite of its comment. A business without a letterhead profile showed the account's name ("Layout Co"), and saving
 * Settings on it — changing nothing but the fiscal year — silently renamed "January Co" to "Layout Co".
 *
 * Executed: the real /app in Chromium against the real server + scratch Postgres (Rule 3).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-new28-settings-business-name.js
 */
const { runBrowser } = require('./browserKit.js');

runBrowser('NEW-28 — Settings shows and keeps each business\'s own name', async ({ open, A, eq, J, c }) => {
  const eA = (await J('GET', '/api/entities'))[0];                                   // "Layout Co" — the account's business_name too
  const eB = await J('POST', '/api/entities', { name: 'January Co', currency: 'USD', country: 'US', timezone: 'UTC' });
  const page = await open({ width: 1280, height: 900 });
  await page.waitForTimeout(1500);
  const ui = await page.evaluate(async (ids) => {
    const idx = id => (window.ENTITIES || []).findIndex(e => Number(e._dbId) === Number(id));
    await switchEntity(idx(ids.b)); await new Promise(r => setTimeout(r, 1500));
    const shownB = document.getElementById('s-biz-name').value;
    document.getElementById('s-fy').value = 'July';
    if (typeof saveSettings === 'function') await saveSettings();
    await new Promise(r => setTimeout(r, 1000));
    await switchEntity(idx(ids.a)); await new Promise(r => setTimeout(r, 1500));
    return { shownB, shownA: document.getElementById('s-biz-name').value };
  }, { a: eA.id, b: eB.id });
  const name = async id => (await c.query(`SELECT data->>'name' n, data->>'fiscal_year' f FROM entities WHERE id = $1`, [id])).rows[0];
  eq('on business B, the box shows B\'s own name (bug: the account\'s "Layout Co")', ui.shownB, 'January Co');
  const b = await name(eB.id);
  eq('saving Settings on B keeps B\'s name and saves its year (bug: renamed to "Layout Co")', [b.n, b.f], ['January Co', 'July']);
  eq('business A keeps its name and shows it', [(await name(eA.id)).n, ui.shownA], ['Layout Co', 'Layout Co']);
}, {});
