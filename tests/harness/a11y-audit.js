#!/usr/bin/env node
'use strict';
/* a11y-audit.js — runs axe-core over the static HTML pages in jsdom. Color-contrast and any layout-
 * dependent rules are disabled (jsdom has no real layout); this catches the structural a11y issues:
 * missing names/labels/alt, roles, landmarks, lang, duplicate ids, list/table semantics, etc.
 *   node tests/harness/a11y-audit.js [file ...]
 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const axe = require('axe-core');

const PUB = path.join(__dirname, '..', '..', 'public');
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['index.html','landing.html','accountant-login.html','accountant-register.html','reset-password.html','team-accept.html','privacy.html','terms.html','security.html','accountants.html'];

const DISABLED = ['color-contrast']; // needs real layout

(async () => {
  let grand = 0;
  for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.join(PUB, f);
    let html; try { html = fs.readFileSync(p, 'utf8'); } catch { console.log(`\n## ${f} — NOT FOUND`); continue; }
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.eval(axe.source);
    const res = await window.axe.run(window.document, {
      rules: Object.fromEntries(DISABLED.map(r => [r, { enabled: false }])),
      resultTypes: ['violations'],
    });
    const v = res.violations;
    const count = v.reduce((s, x) => s + x.nodes.length, 0);
    grand += count;
    console.log(`\n## ${f} — ${count} violation node(s), ${v.length} rule(s)`);
    for (const rule of v.sort((a,b)=>b.nodes.length-a.nodes.length)) {
      console.log(`  [${rule.impact}] ${rule.id} (${rule.nodes.length}) — ${rule.help}`);
      for (const n of rule.nodes.slice(0, 3)) console.log(`       ${n.target[0]}`.slice(0, 140));
    }
    window.close();
  }
  console.log(`\n=== TOTAL: ${grand} violation node(s) across ${files.length} pages ===`);
})();
