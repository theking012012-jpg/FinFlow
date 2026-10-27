'use strict';
/**
 * FA-P2 (2026-10-27) — the Connections page asks each provider for its status ONCE per visit, and none at boot.
 *
 * BUG (executed on the old code, this harness): one visit fired 68 status requests — each of the 17 providers 4 times —
 * because render() ended in updateStats(), which re-fetched all 17 just to count them, and the visit ran render twice
 * (app-main showPage, then the hydrate's own render) plus updateStats once more.
 * The page script also fetched at parse time; jsdom measured no /status request at boot on the old code — check 1 guards it.
 * Seed: clientMoneyKit + WiPay connected (POST /api/wipay/connect — no outside call), so the "connected" count is 1, not
 * the 0 an unseeded page shows whether or not the count is right.
 *   boot: 0 /status requests · a visit: 17 — one per provider (bug 68) · a second visit: 17 again (current state)
 *   the count reads 1 and the WiPay card reads connected — from the one round of answers, not a second fetch
 */
const { run } = require('./clientMoneyKit.js');

// The server logs every request as a JSON line on stdout — count status paths from it, so boot (before the window
// exists for us to wrap) is measured too.
const STATUS = /"path":"\/api\/(?:[a-z]+\/status|plaid\/items)"/;
let seen = [];
const ow = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, ...rest) {
  const s = String(chunk);
  if (s.startsWith('{"t"')) { s.split('\n').forEach(l => { const m = STATUS.test(l) && l.match(/"path":"([^"]+)"/); if (m) seen.push(m[1]); }); return true; }
  return ow(chunk, ...rest);
};
const take = () => { const s = seen; seen = []; return s; };
const perPath = s => { const c = {}; s.forEach(p => c[p] = (c[p] || 0) + 1); return [...new Set(Object.values(c))]; };

run('FA-P2 — each connection status once per visit', async ({ w, d, settle, eq }) => {
  await settle(20, 40);
  // /api/plaid/items is also the Banking strip's (3 at boot, unchanged) — the Connections page's own are the /status ones.
  eq('1  boot asks for no connection status (the page is not open)', take().filter(p => /\/status$/.test(p)).length, 0);
  w.showPage('connections'); await settle(40, 60);
  const v1 = take();
  eq('2  a visit asks each of the 17 providers once', [v1.length, new Set(v1).size, perPath(v1)], [17, 17, [1]], [68, 17, [4]]);
  eq('2  the count reads 1 (WiPay)', (d.getElementById('cs-connected') || {}).textContent, '1');
  const connected = Array.from(d.querySelectorAll('#page-connections .conn-card.is-connected .conn-card-name')).map(e => e.textContent);
  eq('2  …and the WiPay card — only it — is marked connected', connected, ['WiPay'], []);
  w.showPage('dashboard'); await settle(20, 40); take();
  w.showPage('connections'); await settle(40, 60);
  eq('3  a second visit asks again — once each (the state is current, not cached forever)', take().length, 17, 68);
}, { extraSeed: async ({ http }) => { await http.request('POST', '/api/wipay/connect', { account_number: 'WP-100', api_key: 'k-test', country: 'TT' }); } });
