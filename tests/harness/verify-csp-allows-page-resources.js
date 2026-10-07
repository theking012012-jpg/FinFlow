'use strict';
/**
 * verify-csp-allows-page-resources.js — Phase 1.3 / L22 (class check). A page must not reference a stylesheet,
 * script or font that the Content-Security-Policy the server SENDS WITH THAT PAGE blocks. Measured in real Chromium:
 * the accountant portal's Tabler icon stylesheet (cdn.jsdelivr.net) was refused — `style-src 'unsafe-inline'
 * https://fonts.googleapis.com` — so every `ti ti-*` icon in the portal rendered blank (36 uses).
 *
 * Executed against the real server: for EVERY .html page under public/, GET it, read its CSP header, then check each
 *   <link rel="stylesheet" href>   against style-src
 *   <script src>                   against script-src
 *   url(...) fonts inside each same-origin stylesheet it links   against font-src
 * Source matching implements the CSP subset the app uses: 'self', exact scheme+host, *.wildcard hosts; 'none'
 * blocks; falls back to default-src. Also asserts each same-origin stylesheet + font actually serves (200).
 * Same class, second mechanism: an `integrity` digest that is not a whole sha256/384/512 digest. Measured in
 * Chromium (/srv/ff/probe/sri-probe.js): a 63-char sha384 value ⇒ "Failed to find a valid digest" ⇒ the resource
 * is REFUSED. admin.html's Chart.js carried one, so the admin charts never rendered.
 * Pre-fix: accountant-client.html stylesheet blocked by style-src (and its SRI malformed); admin.html script SRI
 * malformed. A vendored copy also needs 'self' in style-src/font-src, which the policy lacked.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-csp-allows-page-resources.js
 */
require('./clock.js');
const fs = require('fs');
const path = require('path');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

function parseCsp(h) {
  const out = {};
  String(h || '').split(';').map(s => s.trim()).filter(Boolean).forEach(d => { const [k, ...v] = d.split(/\s+/); out[k.toLowerCase()] = v; });
  return out;
}
const SRI_BYTES = { sha256: 32, sha384: 48, sha512: 64 };
function sriWellFormed(tag) {
  const m = tag.match(/integrity=["']([^"']*)["']/i); if (!m) return true;      // no SRI ⇒ nothing to mis-check
  return m[1].trim().split(/\s+/).some(tok => { const [alg, b64] = [tok.slice(0, tok.indexOf('-')), tok.slice(tok.indexOf('-') + 1).split('?')[0]];
    return SRI_BYTES[alg] && /^[A-Za-z0-9+/]+={0,2}$/.test(b64) && Buffer.from(b64, 'base64').length === SRI_BYTES[alg] && b64.length % 4 === 0; });
}
function allowed(csp, directive, url, origin) {
  const srcs = csp[directive] || csp['default-src'];
  if (!srcs) return true;                                  // no policy for it ⇒ allowed
  if (srcs.includes("'none'")) return false;
  const u = new URL(url, origin);
  if (u.origin === new URL(origin).origin) return srcs.includes("'self'");
  return srcs.some(s => {
    if (!/^https?:\/\//.test(s)) return false;
    const m = s.match(/^(https?):\/\/(\*\.)?([^/]+)/); if (!m) return false;
    if (u.protocol !== m[1] + ':') return false;
    return m[2] ? (u.hostname === m[3] || u.hostname.endsWith('.' + m[3])) : u.hostname === m[3];
  });
}

(async () => {
  const scratch = await startScratchPostgres({ keep: false });
  let server;
  try {
    server = await bootServer(scratch.url);
    console.log('\n' + '='.repeat(78) + '\n  L22 — every page\'s resources are allowed by the CSP it is served with\n' + '='.repeat(78) + '\n');
    const http = new HarnessHttp(server.baseUrl);
    const pub = path.resolve(__dirname, '..', '..', 'public');
    const pages = fs.readdirSync(pub).filter(f => f.endsWith('.html') && !f.startsWith('.'));
    let checked = 0;
    for (const f of pages) {
      const r = await http.get('/' + f);
      if (r.status !== 200) continue;
      const hdr = r.headers && (typeof r.headers.get === 'function' ? r.headers.get('content-security-policy') : r.headers['content-security-policy']);
      const csp = parseCsp(hdr);
      const html = r.text;
      const sheetTags = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)].map(m => m[0]);
      const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi)].map(m => m[0]);
      for (const t of sheetTags.concat(scriptTags)) if (/integrity=/i.test(t))
        A(`${f}: integrity on ${(t.match(/(?:href|src)=["']([^"']+)/i) || [])[1]} is a whole digest (else the browser refuses it)`, sriWellFormed(t), t.slice(0, 200));
      const sheets = sheetTags.map(t => (t.match(/href=["']([^"']+)["']/i) || [])[1]).filter(Boolean);
      const scripts = scriptTags.map(t => (t.match(/\bsrc=["']([^"']+)["']/i) || [])[1]);
      for (const s of sheets) {
        checked++;
        A(`${f}: stylesheet ${s} allowed by style-src`, allowed(csp, 'style-src', s, server.baseUrl), 'style-src=' + (csp['style-src'] || []).join(' '));
        const su = new URL(s, server.baseUrl);
        if (su.origin === new URL(server.baseUrl).origin) {
          const cr = await http.get(su.pathname);
          A(`${f}: same-origin stylesheet ${su.pathname} serves 200`, cr.status === 200, 'status=' + cr.status);
          const fonts = [...new Set([...String(cr.text).matchAll(/url\(["']?([^"')]+\.(?:woff2?|ttf|otf|eot)[^"')]*)["']?\)/gi)].map(m => m[1]))];
          const first = fonts.find(u => /\.woff2/.test(u)) || fonts[0];
          if (first) {
            const fu = new URL(first, su);
            A(`${f}: font ${fu.pathname} allowed by font-src`, allowed(csp, 'font-src', fu.href, server.baseUrl), 'font-src=' + (csp['font-src'] || []).join(' '));
            const fr = await http.get(fu.pathname);
            A(`${f}: font ${fu.pathname} serves 200`, fr.status === 200, 'status=' + fr.status);
          }
        }
      }
      for (const s of scripts) { checked++;
        const xu = new URL(s, server.baseUrl);
        if (xu.origin === new URL(server.baseUrl).origin) { const xr = await http.get(xu.pathname); A(`${f}: same-origin script ${xu.pathname} serves 200`, xr.status === 200, 'status=' + xr.status); }
        A(`${f}: script ${s} allowed by script-src`, allowed(csp, 'script-src', s, server.baseUrl), 'script-src=' + (csp['script-src'] || []).join(' ')); }
    }
    A('checked resources on the served pages (sanity)', checked > 10, 'checked=' + checked);
  } catch (e) {
    fail++; console.log('  FATAL: ' + (e && e.stack || e));
  } finally { if (server && server.close) await server.close(); await scratch.stop(); }
  console.log('\n' + '-'.repeat(78));
  console.log(fail ? ('  ' + fail + ' FAILED — ' + pass + ' passed, ' + fail + ' failed') : ('  ALL GREEN — ' + pass + ' passed, 0 failed  (CSP allows page resources)'));
  console.log('-'.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
