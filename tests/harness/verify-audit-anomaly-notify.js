'use strict';
/**
 * verify-audit-anomaly-notify.js — the alert DELIVERY layer for the anomaly detector. Proves the pure
 * email formatter, and notifyAnomalies() against real PG with a MOCKED Resend boundary: sends a digest
 * when anomalies exist + recipient set; safely no-ops (sent:false + reason) with no anomalies, no
 * recipient, or no Resend client.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-audit-anomaly-notify.js
 *
 * Scratch Postgres only. Never hits the network (Resend is a capturing fake).
 */
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { formatAnomalyEmail, notifyAnomalies } = require('../../audit-anomalies.js');

let pass = 0, fail = 0;
const A = (n, ok, d) => { ok ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '\n          ' + d : ''))); };

let _seq = 0;
async function mkUser(c) {
  const data = { email: 'notif' + (++_seq) + '@finflow.test', password: 'x', role: 'owner' };
  return (await c.query('INSERT INTO users (user_id, entity_id, data) VALUES (NULL, NULL, $1) RETURNING id', [data])).rows[0].id;
}
async function seedDelete(c, uid) {
  await c.query(
    "INSERT INTO audit_trail (user_id, entity_id, table_name, record_id, action, actor_type, actor_id, changed_at) VALUES ($1, NULL, 'invoices', 1, 'DELETE', 'user', $1, NOW())",
    [uid]);
}
function fakeResend() { const sent = []; return { sent, emails: { send: async (m) => { sent.push(m); return { id: 'fake_' + sent.length }; } } }; }

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);
    delete process.env.SECURITY_ALERT_EMAIL;   // ensure the "no recipient" path is genuine

    console.log('\n' + '='.repeat(78));
    console.log('  AUDIT ANOMALY NOTIFY — pure email formatter + delivery via mocked Resend');
    console.log('='.repeat(78) + '\n');

    // Pure formatter
    const mail = formatAnomalyEmail({ thresholds: { windowMinutes: 60 }, anomalies: [{ type: 'mass_delete', severity: 'high', message: 'user 5 deleted 4 records' }] });
    A('formatter: subject counts the anomalies', /\b1 audit anomaly\b/.test(mail.subject), mail.subject);
    A('formatter: html lists the anomaly type', mail.html.includes('mass_delete'));
    A('formatter: text carries severity + message', mail.text.includes('high') && mail.text.includes('deleted 4 records'));
    A('formatter: html-escapes to avoid injection', formatAnomalyEmail({ thresholds: {}, anomalies: [{ type: 't', severity: 's', message: '<script>x</script>' }] }).html.includes('&lt;script&gt;'));

    // Seed a real mass_delete anomaly (4 deletes by one real user)
    const u = await mkUser(c); for (let i = 0; i < 4; i++) await seedDelete(c, u);
    const OVER = { windowMinutes: 60, crossClient: 3, activity: 5, massDelete: 3 };

    // 1) anomalies + recipient + client → SENT
    let fr = fakeResend();
    let r = await notifyAnomalies(c, fr, { over: OVER, to: 'sec@finflow.test' });
    A('sends when anomalies + recipient present', r.sent === true && r.count >= 1, JSON.stringify(r));
    A('exactly one email dispatched', fr.sent.length === 1);
    A('email addressed to the configured recipient', fr.sent[0] && fr.sent[0].to === 'sec@finflow.test');
    A('email subject is the security digest', /^\[FinFlow security\]/.test(fr.sent[0].subject || ''));

    // 2) no recipient → no send
    fr = fakeResend();
    r = await notifyAnomalies(c, fr, { over: OVER, to: null });
    A('no recipient → sent:false + reason, no email', r.sent === false && /recipient/i.test(r.reason) && fr.sent.length === 0, JSON.stringify(r));

    // 3) no Resend client → no send
    r = await notifyAnomalies(c, null, { over: OVER, to: 'sec@finflow.test' });
    A('no Resend client → sent:false + reason', r.sent === false && /Resend|configured/i.test(r.reason), JSON.stringify(r));

    // 4) no anomalies (thresholds above the seed) → no send
    fr = fakeResend();
    r = await notifyAnomalies(c, fr, { over: { massDelete: 9999, activity: 9999, crossClient: 9999 }, to: 'sec@finflow.test' });
    A('no anomalies → sent:false, count 0, no email', r.sent === false && r.count === 0 && fr.sent.length === 0, JSON.stringify(r));

    console.log('\n' + '-'.repeat(78));
    console.log(fail ? ('  ' + pass + ' passed, ' + fail + ' FAILED') : ('  ALL GREEN - ' + pass + ' passed, 0 failed  (audit anomaly notify / delivery)'));
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
