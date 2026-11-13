// k6-finflow.js — capacity test for a STAGING copy of FinFlow (never production).
//
//   k6 run -e BASE_URL=https://<staging>.up.railway.app -e USERS=200 tests/load/k6-finflow.js
//
// Each virtual user signs in ONCE as its own seeded account (loadtest+<n>@finflow.test — see seed-load-users.js), then
// loops a realistic session: open the dashboard (the app's main reads), look at invoices / expenses / reports, and
// every few loops create an invoice, record a partial payment on it and add an expense. Think time 3–8 s, like a person.
// Stages ramp 10 → 50 → 100 → 200 users over ~15 minutes, so the report shows where response times start to climb.
//
// Pass / fail (thresholds): 95 % of requests under 800 ms, 99 % under 2 s, fewer than 1 % failed requests.
// Watch at the same time: Railway → service metrics (CPU / memory) and Supabase → Database → connections (the app keeps
// up to 10 per process; the session pooler has its own cap — that is the likeliest first limit).
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || '').replace(/\/$/, '');
if (!BASE) throw new Error('Set -e BASE_URL=https://<staging host>');
if (/finflow-production/.test(BASE)) throw new Error('Refusing to load-test production. Use a staging copy.');
const PASSWORD = __ENV.LOAD_PASSWORD || 'LoadTest-pw-2026!';
const USERS = parseInt(__ENV.USERS || '200', 10);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [
        { duration: '2m', target: Math.min(10, USERS) },
        { duration: '3m', target: Math.min(50, USERS) },
        { duration: '4m', target: Math.min(100, USERS) },
        { duration: '4m', target: USERS },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    'write_duration': ['p(95)<1500'],
  },
};

const writeDur = new Trend('write_duration', true);
const rateLimited = new Counter('rate_limited_429');
const H = { headers: { 'Content-Type': 'application/json' } };

export function setup() {
  const r = http.get(BASE + '/healthz');
  if (r.status !== 200) throw new Error('staging /healthz is ' + r.status);
}

let signedIn = false;
export default function () {
  const n = ((__VU - 1) % USERS) + 1;
  if (!signedIn) {
    const r = http.post(BASE + '/api/auth/login', JSON.stringify({ email: `loadtest+${n}@finflow.test`, password: PASSWORD }), H);
    if (!check(r, { 'signed in': x => x.status === 200 })) { sleep(5); return; }
    signedIn = true;
  }
  group('dashboard', () => {
    const rs = http.batch([
      ['GET', BASE + '/api/entities'], ['GET', BASE + '/api/settings'], ['GET', BASE + '/api/invoices'],
      ['GET', BASE + '/api/expenses'], ['GET', BASE + '/api/reports?period=year'], ['GET', BASE + '/api/customers'],
    ]);
    rs.forEach(x => { if (x.status === 429) rateLimited.add(1); check(x, { 'read ok': y => y.status === 200 }); });
  });
  sleep(3 + Math.random() * 5);
  group('reports', () => {
    const r = http.get(BASE + '/api/reports?period=quarter&monthIdx=6');
    check(r, { 'report ok': x => x.status === 200 });
  });
  if (__ITER % 3 === 0) {
    group('write', () => {
      const key = `k6-${__VU}-${__ITER}`;
      let r = http.post(BASE + '/api/invoices', JSON.stringify({ client: 'Load Customer ' + n, amount: 250, status: 'pending', issue_date: '2026-07-10', due_date: '2026-08-10', idempotency_key: key + '-inv' }), H);
      writeDur.add(r.timings.duration); if (r.status === 429) rateLimited.add(1);
      check(r, { 'invoice created': x => x.status === 201 || x.status === 200 });
      const inv = r.status < 300 ? r.json() : null;
      if (inv && inv.id) {
        r = http.post(BASE + '/api/invoice-payments', JSON.stringify({ invoice_id: inv.id, amount: 100, payment_date: '2026-07-12', method: 'bank', idempotency_key: key + '-pay' }), H);
        writeDur.add(r.timings.duration); check(r, { 'payment recorded': x => x.status < 300 });
      }
      r = http.post(BASE + '/api/expenses', JSON.stringify({ description: 'k6 expense', category: 'Rent', amount: 42, deductible: 'yes', expense_date: '2026-07-11', idempotency_key: key + '-exp' }), H);
      writeDur.add(r.timings.duration); check(r, { 'expense added': x => x.status < 300 });
    });
  }
  sleep(3 + Math.random() * 5);
}
