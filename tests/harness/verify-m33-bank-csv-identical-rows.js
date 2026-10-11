'use strict';
/**
 * M33 (money audit 2026-10-09): a bank CSV with two GENUINE identical same-day transactions imports both.
 * BUG: the dedupe key was sha1(date|amount|description), so the second 4.50 coffee was skipped as a duplicate.
 * Seed: CSV with COFFEE 4.50 ×2 on 2026-07-10 + LUNCH 12.00.  correct: imported 3, skipped 0 · bug: 2 / 1.
 * Re-importing the SAME file must still import nothing (imported 0, skipped 3) — dedupe is not weakened.
 * An overlapping statement that adds a THIRD coffee imports exactly that one.
 */
const { run } = require('./moneyFixKit.js');

run('M33 — bank CSV keeps genuine identical same-day rows', async ({ newOwner, eq }) => {
  const { J, ids } = await newOwner('M33');
  const imp = csv => J('POST', '/api/banking/import?entity_id=' + ids[0], { format: 'csv', content: csv, mapping: { date_order: 'mdy' } });
  const csv1 = 'Date,Description,Amount\n2026-07-10,COFFEE SHOP,-4.50\n2026-07-10,COFFEE SHOP,-4.50\n2026-07-10,LUNCH,-12.00\n';
  const r1 = await imp(csv1);
  eq('first import: imported / skipped', [r1.imported, r1.skipped], [3, 0], [2, 1]);
  const r2 = await imp(csv1);
  eq('re-importing the same file: imported / skipped', [r2.imported, r2.skipped], [0, 3]);
  const r3 = await imp(csv1 + '2026-07-10,COFFEE SHOP,-4.50\n');
  eq('overlapping statement with a third coffee: imported / skipped', [r3.imported, r3.skipped], [1, 3], [0, 4]);
  const feed = await J('GET', '/api/banking?entity_id=' + ids[0]);
  eq('bank feed holds 3 coffees + 1 lunch', feed.filter(t => /COFFEE/.test(t.description)).length, 3, 1);
});
