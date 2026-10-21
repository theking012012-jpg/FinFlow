'use strict';
/**
 * LR6 (decision 2026-10-21: option A — keep "Year to date", the LC2 / FIX-2 wording, everywhere). The Reports line read
 * "Year to date · …" but the Year button's tooltip and the period resolver's label (_periodWindow('year')) said "Fiscal
 * year to date". One wording for one period.
 *   1  Year button tooltip = "Year to date"                         bug: "Fiscal year to date"
 *   2  _periodWindow('year').label starts "Year to date"             bug: "Fiscal year to date · …"
 *   3  no "Fiscal year to date" text left on the page after Year is selected
 */
const { run } = require('./clientMoneyKit.js');
run('LR6 — one wording for the year period', async ({ w, d, ev, settle, eq, A }) => {
  eq('1  Year button tooltip', (d.getElementById('pY') || {}).title, 'Year to date', 'Fiscal year to date');
  const lbl = ev(`(typeof _periodWindow==='function'?_periodWindow('year').label:'')`);
  A('2  period label starts "Year to date"', /^Year to date/.test(lbl), JSON.stringify(lbl));
  ev(`setPeriod(document.getElementById('pY'),'year')`); await settle(20, 60);
  A('3  no "Fiscal year to date" on the page', !/Fiscal year to date/.test(d.body.innerHTML), '');
});
