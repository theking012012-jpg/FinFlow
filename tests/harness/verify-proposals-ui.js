'use strict';
/**
 * verify-proposals-ui.js — structural wiring for the engagement-proposals UI on both sides.
 * (The lifecycle itself is proven functionally in verify-accountant-proposals.js; this guards the
 *  client + accountant surfaces that would silently vanish if the markup/handlers regressed.)
 *
 *   node tests/harness/verify-proposals-ui.js
 */
const fs = require('fs');
const path = require('path');
const P = f => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

(function () {
  let pass = 0, fail = 0;
  const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

  const idx = P('public/index.html');
  const acc = P('public/accountant-client.html');
  const db = P('database.js');

  // Schema
  A('db: accountant_proposals table', /CREATE TABLE IF NOT EXISTS accountant_proposals/.test(db) && /fee_cents/.test(db) && /billing/.test(db));

  // Client surface
  A('client: proposals mount on My Accountant page', /id="acct-proposals"/.test(idx));
  A('client: loadMyProposals reads the endpoint', /window\.loadMyProposals/.test(idx) && /\/api\/accountants\/my-accountant\/proposals/.test(idx));
  A('client: Accept/Decline call respondProposal', /window\.respondProposal/.test(idx) && /respondProposal\(\$\{p\.id\},'accept'/.test(idx) && /respondProposal\(\$\{p\.id\},'decline'/.test(idx));
  A('client: respond posts action to the endpoint', /proposals\/'\+id\+'\/respond/.test(idx) && /body:JSON\.stringify\(\{action:action\}\)/.test(idx));
  A('client: proposals load when the page opens', /if \(typeof loadMyProposals === 'function'\) loadMyProposals\(\)/.test(idx));
  A('client: fee formatted with currency', /_fmtFee/.test(idx));

  // Accountant surface
  A('accountant: Proposals nav + section', /showSection\('proposals'/.test(acc) && /id="section-proposals"/.test(acc));
  A('accountant: create form fields', /id="prop-title"/.test(acc) && /id="prop-fee"/.test(acc) && /id="prop-billing"/.test(acc));
  A('accountant: sendProposal posts to the client proposals endpoint', /function sendProposal/.test(acc) && /clients\/\$\{_userId\}\/proposals/.test(acc));
  A('accountant: loadProposals + withdraw wired', /function loadProposals/.test(acc) && /function withdrawProposal/.test(acc) && /proposals\/\$\{id\}\/withdraw/.test(acc));
  A('accountant: section lazy-loads proposals', /if \(name === 'proposals'\) loadProposals\(\)/.test(acc));

  // ── Client tasks / requests UI ────────────────────────────────────────────────
  A('db: accountant_tasks table', /CREATE TABLE IF NOT EXISTS accountant_tasks/.test(db) && /due_date/.test(db));
  A('client: tasks mount + loader', /id="acct-tasks"/.test(idx) && /window\.loadMyTasks/.test(idx) && /\/api\/accountants\/my-accountant\/tasks/.test(idx));
  A('client: toggleTask posts done state', /window\.toggleTask/.test(idx) && /tasks\/'\+id\+'\/done/.test(idx));
  A('client: tasks load when the page opens', /if \(typeof loadMyTasks === 'function'\) loadMyTasks\(\)/.test(idx));
  A('accountant: Requests nav + section + form', /showSection\('requests'/.test(acc) && /id="section-requests"/.test(acc) && /id="task-title"/.test(acc));
  A('accountant: createTask/loadTasks/deleteTask wired', /function createTask/.test(acc) && /function loadTasks/.test(acc) && /function deleteTask/.test(acc) && /clients\/\$\{_userId\}\/tasks/.test(acc));
  A('accountant: requests section lazy-loads', /if \(name === 'requests'\) loadTasks\(\)/.test(acc));

  console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (proposals + requests UI wiring)`);
  console.log('');
  process.exitCode = fail === 0 ? 0 : 1;
})();
