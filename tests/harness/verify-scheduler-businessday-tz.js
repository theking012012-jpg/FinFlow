#!/usr/bin/env node
'use strict';
/**
 * verify-scheduler-businessday-tz.js (F88 step 6, Rule 10 + Rule 14) — a recurring run's schedule anchor
 * (`next_run`) stays unadjusted, but the DATE STAMPED on the generated document (invoice/bill due_date) is
 * shifted off weekends + the entity COUNTRY's public holidays to the nearest business day, MODIFIED
 * FOLLOWING (forward, unless it leaves the month → then backward). ADDITIVE: an entity with no country
 * (and every personal row) gets the raw date — byte-identical to pre-step-6.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-scheduler-businessday-tz.js
 *
 * Discriminates (Rule 14): the SAME next_run, with nothing changed but the entity's country, produces a
 * shifted due_date for the US entity and the raw (weekend/holiday) date for the no-country entity.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { initSchema, bootServer } = require('./boot.js');

let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const dow = ymd => new Date(Date.UTC(+ymd.slice(0,4), +ymd.slice(5,7)-1, +ymd.slice(8,10))).getUTCDay(); // 0 Sun..6 Sat
const isWeekend = ymd => dow(ymd) === 0 || dow(ymd) === 6;
const monthOf = ymd => ymd.slice(0,7);

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  const { pool: appPool } = await initSchema(scratch.url);
  let server = null;
  try {
    server = await bootServer(scratch.url);
    const app = require('../../server.js');
    const S = app.businessDayShift;

    console.log('\n' + '='.repeat(78));
    console.log('  SCHEDULER BUSINESS-DAY SHIFT — per-country, Modified Following (F88 step 6)');
    console.log('='.repeat(78) + '\n');

    A('businessDayShift is exported', typeof S === 'function');

    // ── 1. ADDITIVE: no country ⇒ date returned unchanged, even on a weekend/holiday ──
    A('no country: a Saturday is returned unchanged', S('2026-08-01', null) === '2026-08-01', S('2026-08-01', null));
    A("empty country: unchanged", S('2026-08-01', '') === '2026-08-01', S('2026-08-01', ''));
    A('no country: Dec 25 unchanged', S('2026-12-25', null) === '2026-12-25', S('2026-12-25', null));

    // ── 2. Plain weekend, mid-month → FORWARD to the next business day (Modified Following) ──
    A('Sat 2026-08-01 is a weekend (premise)', isWeekend('2026-08-01'));
    const wf = S('2026-08-01', 'US');
    A('US: Sat 2026-08-01 → forward to a weekday, same month', wf === '2026-08-03' && !isWeekend(wf) && monthOf(wf) === '2026-08', wf);

    // ── 3. Month-END weekend → forward would leave the month, so go BACKWARD (the whole point of MF) ──
    A('Sat 2026-10-31 is a weekend (premise)', isWeekend('2026-10-31'));
    const mb = S('2026-10-31', 'US');
    A('US: Sat 2026-10-31 → BACKWARD to Fri 2026-10-30 (stays in October)', mb === '2026-10-30' && monthOf(mb) === '2026-10', mb);

    // ── 4. Weekday PUBLIC HOLIDAY → shifted (US Memorial Day = Mon 2026-05-25) ──
    A('2026-05-25 is a Monday (premise: not a weekend)', !isWeekend('2026-05-25'));
    const mh = S('2026-05-25', 'US');
    A('US: Memorial Day Mon 2026-05-25 → shifted off the holiday, same month, a weekday', mh !== '2026-05-25' && monthOf(mh) === '2026-05' && !isWeekend(mh), mh);

    // ── 5. Plain weekday, no holiday → UNCHANGED even with a country (shift only fires on non-business days) ──
    A('US: ordinary Wed 2026-08-05 unchanged', S('2026-08-05', 'US') === '2026-08-05', S('2026-08-05','US'));

    // ── 6. PER-COUNTRY: US Thanksgiving (Thu 2026-11-26) is a US holiday but NOT a Canadian one ──
    A('2026-11-26 is a Thursday (premise)', !isWeekend('2026-11-26'));
    const usT = S('2026-11-26', 'US'), caT = S('2026-11-26', 'CA');
    A('US: Thanksgiving 2026-11-26 is shifted (US holiday)', usT !== '2026-11-26' && !isWeekend(usT), usT);
    A('CA: 2026-11-26 unchanged (not a Canadian holiday) — per-country discriminator', caT === '2026-11-26', caT);

    // ── 6b. F190 UNDER-SHIFT guard: a far-EAST (UTC+12/+13) country's PUBLIC holiday must be recognised.
    //    The prior noon-UTC-instant probe missed 11 of 13 New Zealand public holidays (the date rolled to
    //    the wrong local day). Now matched by calendar string, so it must shift. ──
    A('2026-04-03 is a Friday (premise: NZ Good Friday, not a weekend)', !isWeekend('2026-04-03'));
    const nzGF = S('2026-04-03', 'NZ');
    A('NZ (UTC+13): Good Friday 2026-04-03 IS shifted (public holiday recognised, not missed)', nzGF !== '2026-04-03', nzGF);
    A('2026-02-06 is a Friday (premise: NZ Waitangi Day)', !isWeekend('2026-02-06'));
    A('NZ: Waitangi Day 2026-02-06 IS shifted (public holiday recognised)', S('2026-02-06','NZ') !== '2026-02-06', S('2026-02-06','NZ'));

    // ── 6c. F190 OVER-SHIFT guard: an OBSERVANCE is a working day and must NOT shift (date-holidays'
    //    isHoliday() returns truthy for observance/school; the fix filters to {public, bank} only). ──
    A('US: St Patrick 2026-03-17 (observance) NOT shifted — a working day', S('2026-03-17', 'US') === '2026-03-17', S('2026-03-17','US'));
    A('US: Tax Day 2026-04-15 (observance) NOT shifted — a working day', S('2026-04-15', 'US') === '2026-04-15', S('2026-04-15','US'));

    // ── 6d. F190 SCHOOL-type guard, where the data actually exists. US carries NO school-typed events
    //    in date-holidays 3.36.0, so a US school assertion is vacuous; Netherlands (NL) does. Derive the
    //    dates from the library so the guard can't rot: a weekday NL 'school' day (not also public) must
    //    NOT shift, while a weekday NL 'public' holiday MUST — same country, so TYPE is the discriminator,
    //    not country. This is what proves {public,bank} filtering (not raw isHoliday) is honoured. ──
    const _HD = require('date-holidays');
    const _nl = new _HD('NL').getHolidays(2026);
    const _pub = new Set(_nl.filter(e => e.type === 'public').map(e => String(e.date).slice(0, 10)));
    const _pick = (type, excludePublic) => {
      for (const e of _nl) { const ymd = String(e.date).slice(0, 10); if (e.type === type && !isWeekend(ymd) && (!excludePublic || !_pub.has(ymd))) return ymd; }
      return null;
    };
    const nlSchool = _pick('school', true), nlPublic = _pick('public', false);
    A('NL has a weekday school-typed day in 2026 (premise, non-vacuous)', !!nlSchool, 'nlSchool=' + nlSchool);
    A('NL: weekday school day ' + nlSchool + ' NOT shifted (school excluded from closures)', !!nlSchool && S(nlSchool, 'NL') === nlSchool, 'got ' + (nlSchool && S(nlSchool, 'NL')));
    A('NL has a weekday public holiday in 2026 (premise)', !!nlPublic, 'nlPublic=' + nlPublic);
    A('NL: weekday public holiday ' + nlPublic + ' IS shifted (public honoured) — same country, TYPE discriminates', !!nlPublic && S(nlPublic, 'NL') !== nlPublic, 'got ' + (nlPublic && S(nlPublic, 'NL')));

    // ── 7. Modified-Following MONTH INVARIANT: every day of a sample month stays in that month ──
    let inMonth = true, offenders = [];
    for (let d = 1; d <= 31; d++) {
      const ymd = '2026-08-' + String(d).padStart(2, '0');
      if (!/^\d{4}-\d{2}-(0[1-9]|[12]\d|3[01])$/.test(ymd)) continue;
      if (new Date(Date.UTC(2026, 7, d)).getUTCMonth() !== 7) continue; // skip overflow (Aug has 31)
      const s = S(ymd, 'US');
      if (monthOf(s) !== '2026-08') { inMonth = false; offenders.push(ymd + '→' + s); }
    }
    A('MF invariant: every August day shifts to a date still in August', inMonth, offenders.join(', '));

    // ════════════════════════════════════════════════════════════════════════════════
    //  END-TO-END through the live scheduler (pinned 2026-07-25T16:00Z)
    // ════════════════════════════════════════════════════════════════════════════════
    A('runRecurringScheduler is exported', typeof app.runRecurringScheduler === 'function');

    const uid = (await c.query(
      `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL,NULL,$1,NOW(),NOW()) RETURNING id`,
      [{ email: 'bday-owner@finflow.test', name: 'BDay Owner', plan: 'business', role: 'owner', password: bcrypt.hashSync('x', 10) }]
    )).rows[0].id;
    const mkEntity = async (data) => (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,NOW(),NOW()) RETURNING id`,
      [uid, data]
    )).rows[0].id;
    // Country drives the shift; NO timezone on either ⇒ both resolve "today" in UTC (2026-07-25), isolating
    // step 6 from step 3. Same everything except `country`.
    const eidUS   = await mkEntity({ name: 'US Co',   currency: 'USD', country: 'US', is_active: 0, sort_order: 0 });
    const eidBare = await mkEntity({ name: 'Bare Co', currency: 'USD',                 is_active: 0, sort_order: 1 });

    const mkRecurBill = async (eid, data) => (await c.query(
      `INSERT INTO recurring_bills (user_id, entity_id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id`,
      [uid, eid, { status: 'active', frequency: 'monthly', user_id: uid, ...data }]
    )).rows[0].id;

    // A weekend next_run in the past (fires now): Sat 2026-07-18. And a US weekday-holiday: Memorial Day 2026-05-25.
    A('2026-07-18 is a Saturday (premise)', isWeekend('2026-07-18'));
    await mkRecurBill(eidUS,   { next_run: '2026-07-18', vendor: 'US-Weekend',  amount: 111, entity_id: eidUS });
    await mkRecurBill(eidBare, { next_run: '2026-07-18', vendor: 'Bare-Weekend', amount: 112, entity_id: eidBare });
    await mkRecurBill(eidUS,   { next_run: '2026-05-25', vendor: 'US-Holiday',   amount: 113, entity_id: eidUS });
    // Control: a US recurring bill on an ordinary weekday must NOT be shifted (Wed 2026-07-15).
    A('2026-07-15 is a Wednesday (premise)', !isWeekend('2026-07-15'));
    await mkRecurBill(eidUS,   { next_run: '2026-07-15', vendor: 'US-Weekday',   amount: 114, entity_id: eidUS });

    const dueOf = async (vendor) => (await c.query(`SELECT data->>'due_date' AS d FROM bills WHERE data->>'vendor'=$1`, [vendor])).rows[0]?.d;
    const cntOf = async (vendor) => Number((await c.query(`SELECT COUNT(*) n FROM bills WHERE data->>'vendor'=$1`, [vendor])).rows[0].n);

    await app.runRecurringScheduler();

    // ── discriminator: same next_run, only country differs ──
    const usW = await dueOf('US-Weekend'), bareW = await dueOf('Bare-Weekend');
    A('US-Weekend bill generated', (await cntOf('US-Weekend')) === 1);
    A('Bare-Weekend bill generated', (await cntOf('Bare-Weekend')) === 1);
    A('US entity: Sat 2026-07-18 due date shifted to a weekday, same month', usW && !isWeekend(usW) && monthOf(usW) === '2026-07', 'due=' + usW);
    A('US entity: due date === businessDayShift(next_run, US) (e2e ties to the unit fn)', usW === S('2026-07-18', 'US'), 'due=' + usW + ' fn=' + S('2026-07-18','US'));
    A('DISCRIMINATOR: no-country entity keeps the RAW weekend date 2026-07-18', bareW === '2026-07-18', 'due=' + bareW);
    A('  → the two differ on identical input (only country changed)', usW !== bareW, `US=${usW} bare=${bareW}`);

    // ── holiday leg ──
    const usH = await dueOf('US-Holiday');
    A('US entity: Memorial Day 2026-05-25 due date shifted off the holiday', usH && usH !== '2026-05-25' && !isWeekend(usH) && monthOf(usH) === '2026-05', 'due=' + usH);

    // ── weekday control: no shift ──
    const usWd = await dueOf('US-Weekday');
    A('US entity: ordinary Wed 2026-07-15 due date UNCHANGED (shift only on non-business days)', usWd === '2026-07-15', 'due=' + usWd);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (F88 step 6 business-day shift, per-country)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    try { if (appPool && appPool.end && !appPool.ended) await appPool.end(); } catch (_) {}
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[sched-bday] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
