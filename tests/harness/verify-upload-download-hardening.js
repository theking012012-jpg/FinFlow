'use strict';
/**
 * verify-upload-download-hardening.js — a malicious uploaded file must be served as a DOWNLOAD, never
 * rendered inline (stored-XSS defense). Uploads an HTML file with a <script> payload, downloads it,
 * and asserts Content-Disposition: attachment + X-Content-Type-Options: nosniff — so the browser saves
 * it instead of executing it.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-upload-download-hardening.js
 *
 * Scratch Postgres only.
 */
require('./clock.js');
const bcrypt = require('bcryptjs');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1)', [{ email: 'up@finflow.test', role: 'owner', password: bcrypt.hashSync(PW, 10) }]);
    const http = new HarnessHttp(server.baseUrl);

    console.log('\n' + '='.repeat(78));
    console.log('  UPLOAD/DOWNLOAD HARDENING — malicious upload served as attachment, never inline');
    console.log('='.repeat(78) + '\n');

    A('login → 200', (await http.post('/api/auth/login', { email: 'up@finflow.test', password: PW })).status === 200);

    const payload = Buffer.from("<script>alert('xss')</script>").toString('base64');
    const up = await http.post('/api/documents', { name: 'evil.html', media_type: 'text/html', file_data: payload });
    A('upload malicious html → 201', up.status === 201, JSON.stringify(up.json));
    const id = up.json && up.json.id;
    A('upload returned an id', !!id);

    const dl = await http.get('/api/documents/' + id + '/download');
    A('download → 200', dl.status === 200, 'status=' + dl.status);
    A('Content-Disposition forces attachment (not inline)', /attachment/i.test(String(dl.headers.get('content-disposition') || '')), dl.headers.get('content-disposition'));
    A('X-Content-Type-Options: nosniff (no MIME sniff to text/html execution)', String(dl.headers.get('x-content-type-options') || '') === 'nosniff');
    A('unauthenticated download → 401 (auth enforced)', (await new HarnessHttp(server.baseUrl).get('/api/documents/' + id + '/download')).status === 401);

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (upload/download hardening)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
