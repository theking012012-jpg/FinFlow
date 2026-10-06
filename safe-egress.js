'use strict';
// safe-egress — the ONE way the server makes a request to a host a USER supplied (N54).
//
// A user-entered URL (WooCommerce store_url) fetched server-side is an SSRF primitive: it can reach
// localhost services, the private network and the cloud metadata endpoint (169.254.169.254), with
// the server's network position. Rules enforced here:
//   - https only (the request carries the user's API credentials);
//   - the hostname is resolved and EVERY address must be public — no loopback, private, link-local,
//     CGNAT, multicast, reserved or IPv4-mapped/NAT64 forms of those;
//   - the socket connects to the address that was checked (pinned via `lookup`), so a DNS answer
//     that changes between check and connect (rebinding) cannot redirect it;
//   - redirects are not followed (a 3xx is returned as-is, never chased to an internal host).
const dns = require('dns');
const net = require('net');
const https = require('https');

function _v4Private(a) {
  const p = a.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  const [x, y] = p;
  return x === 0 || x === 10 || x === 127 || x >= 224 ||
    (x === 100 && y >= 64 && y <= 127) ||          // CGNAT
    (x === 169 && y === 254) ||                    // link-local / cloud metadata
    (x === 172 && y >= 16 && y <= 31) ||
    (x === 192 && y === 168) ||
    (x === 192 && y === 0 && (p[2] === 0 || p[2] === 2)) ||
    (x === 198 && (y === 18 || y === 19)) ||       // benchmarking
    (x === 198 && y === 51 && p[2] === 100) ||
    (x === 203 && y === 0 && p[2] === 113);
}
function isPrivateAddress(addr) {
  const a = String(addr || '').replace(/^\[|\]$/g, '').toLowerCase();
  const fam = net.isIP(a);
  if (fam === 4) return _v4Private(a);
  if (fam !== 6) return true;
  if (a === '::' || a === '::1') return true;
  const m = a.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);   // v4-mapped / v4-compatible / NAT64
  if (m) return _v4Private(m[1]);
  const mh = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);       // v4-mapped in hex form
  if (mh) { const n = (parseInt(mh[1], 16) << 16) | parseInt(mh[2], 16); return _v4Private([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.')); }
  const first = parseInt(a.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 ||   // fc00::/7 unique-local
    (first & 0xffc0) === 0xfe80 ||        // fe80::/10 link-local
    (first & 0xff00) === 0xff00 ||        // multicast
    first === 0x2001 && parseInt(a.split(':')[1] || '0', 16) === 0xdb8;   // documentation
}

// Parse + resolve + check. Returns { url, address, family } or throws an Error with .code 'EGRESS_DENIED'.
async function checkUrl(raw) {
  const deny = (msg) => { const e = new Error(msg); e.code = 'EGRESS_DENIED'; return e; };
  let u;
  try { u = new URL(String(raw || '')); } catch (_) { throw deny('not a valid URL'); }
  if (u.protocol !== 'https:') throw deny('the URL must use https://');
  if (u.username || u.password) throw deny('the URL must not contain credentials');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) }];
  else {
    try { addrs = await dns.promises.lookup(host, { all: true, verbatim: true }); }
    catch (e) { throw deny('the host ' + host + ' could not be resolved'); }
  }
  if (!addrs.length) throw deny('the host ' + host + ' could not be resolved');
  const bad = addrs.find(a => isPrivateAddress(a.address));
  if (bad) throw deny('the host ' + host + ' resolves to a private or reserved address');
  return { url: u, address: addrs[0].address, family: addrs[0].family };
}

// Socket I/O after the check. Replaceable ONLY for harnesses (the check above is never bypassed — a
// replaced transport still receives the already-validated, pinned address).
function _httpsTransport({ url, address, family, headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: 'https:', hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method: 'GET',
      headers: Object.assign({ 'Accept': 'application/json' }, headers || {}),
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      lookup: (_h, opts, cb) => (opts && opts.all) ? cb(null, [{ address, family }]) : cb(null, address, family),
      timeout: timeoutMs || 15000,
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (d) => { size += d.length; if (size <= 2 * 1024 * 1024) chunks.push(d); else req.destroy(new Error('response too large')); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: { get: (k) => { const v = res.headers[String(k).toLowerCase()]; return v == null ? null : String(v); } },
          json: async () => JSON.parse(body), text: async () => body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}
const _io = { transport: _httpsTransport };

async function safeGet(raw, { headers, timeoutMs } = {}) {
  const { url, address, family } = await checkUrl(raw);
  return _io.transport({ url, address, family, headers, timeoutMs });
}

module.exports = { safeGet, checkUrl, isPrivateAddress, _io };
