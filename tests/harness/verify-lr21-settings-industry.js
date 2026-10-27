'use strict';
/**
 * LR21 (live retest A2 / A10), first half: Settings → Industry showed BLANK for Northwind, whose stored industry is
 * "Media & Creative". Read: the onboarding list (#ob-industry) offers 11 industries; the Settings list (#s-industry) a
 * different 7 — a second copy of one vocabulary that drifted (4 onboarding values missing). The loader
 * (finflow-api-wiring.js loadSettingsFromDB → setField) sets select.value to a value with no <option> → nothing shown.
 * Second half (GET /api/settings ×5 on opening Settings): NOT reproduced on seeded data — measured 0 GETs on opening
 * Settings, 2 per boot (probe, 2026-10-21). Needs the live account's Network trace; recorded as a question in LR21.
 *
 *   1  the Settings list (as shipped in index.html) offers every onboarding industry   bug: 4 missing
 *   2  a stored industry in NEITHER list (legacy "Agriculture", seeded before the app loads) is shown, never blank
 *      — the same loader path a stored "Media & Creative" took live                    bug: first option / blank
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./clientMoneyKit.js');

const html = require('./appScripts.js').pageSource('index.html');
const listOf = id => { const m = html.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>')); return m ? [...m[1].matchAll(/<option(?:\s+value="([^"]*)")?>([^<]*)<\/option>/g)].map(o => (o[1] != null ? o[1] : o[2]).replace(/&amp;/g, '&')).filter(Boolean) : []; };

run('LR21 — Settings shows the stored industry', async ({ d, settle, eq, A }) => {
  const ob = listOf('ob-industry'), st = listOf('s-industry');
  A('setup: both lists found in index.html', ob.length >= 10 && st.length >= 5, JSON.stringify({ ob: ob.length, st: st.length }));
  eq('1  Settings offers every onboarding industry', ob.filter(v => !st.includes(v)), [], ['Construction', 'Food & Beverage', 'Real Estate', 'Media & Creative']);
  try { d.defaultView.showPage('settings'); } catch (_) {}
  await settle(30, 60);
  const s = d.getElementById('s-industry');
  const shown = s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].textContent : '';
  eq('2  stored legacy "Agriculture" is shown (not blank, not the first option)', [s && s.value, shown], ['Agriculture', 'Agriculture'], ['', '']);
}, { extraSeed: async ({ http }) => { await http.put('/api/settings', { industry: 'Agriculture' }); } });
