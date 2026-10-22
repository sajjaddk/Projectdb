// k6 load test. Run with: npm run test:perf   (starts the app, runs this, stops the app)
// Or against a running app:  k6 run -e BASE_URL=http://127.0.0.1:4000 -e ADMIN_PASSWORD=... -e DISPATCHER_PASSWORD=... performance/load.js
// Tunables: -e VUS=20 -e DURATION=60s
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || `http://127.0.0.1:${__ENV.PORT || 4000}`;
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '30s';
const bookingFailures = new Rate('booking_flow_failures');

export const options = {
  noCookiesReset: true, // keep the session cookie across iterations (one login per VU)
  scenarios: {
    dispatchers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],             // < 1% errors
    http_req_duration: ['p(95)<800'],           // 95% of requests under 800 ms
    'http_req_duration{name:list_bookings}': ['p(95)<500'],
    booking_flow_failures: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const json = { 'Content-Type': 'application/json' };

// One login per VU (scrypt is deliberately CPU-expensive); the cookie jar keeps the session.
let csrf = null;
function ensureLogin() {
  if (csrf) return;
  const res = http.post(`${BASE}/api/auth/login`,
    JSON.stringify({ username: 'dispatcher', password: __ENV.DISPATCHER_PASSWORD }),
    { headers: json, tags: { name: 'login' } });
  check(res, { 'login 200': (r) => r.status === 200 });
  csrf = res.json('csrfToken');
}

export function setup() {
  const res = http.get(`${BASE}/api/health`);
  if (res.status !== 200) throw new Error(`App not reachable at ${BASE}`);
}

export default function () {
  ensureLogin();
  const auth = { headers: { ...json, 'X-CSRF-Token': csrf } };

  group('browse', () => {
    const cars = http.get(`${BASE}/api/cars`, { tags: { name: 'list_cars' } });
    const drivers = http.get(`${BASE}/api/drivers`, { tags: { name: 'list_drivers' } });
    const list = http.get(`${BASE}/api/bookings?status=requested`, { tags: { name: 'list_bookings' } });
    check(cars, { 'cars 200': (r) => r.status === 200 });
    check(drivers, { 'drivers 200': (r) => r.status === 200 });
    check(list, { 'bookings 200': (r) => r.status === 200 });
  });

  group('create and cancel a booking', () => {
    const create = http.post(`${BASE}/api/bookings`, JSON.stringify({
      customer_name: `Load Test ${__VU}-${__ITER}`,
      customer_phone: '555-0100',
      pickup: '1 Load Street',
      dropoff: '2 Stress Avenue',
      distance_km: 5 + (__ITER % 20),
      scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    }), { ...auth, tags: { name: 'create_booking' } });
    const ok = check(create, { 'booking 201': (r) => r.status === 201 });
    bookingFailures.add(!ok);
    if (ok) {
      const cancel = http.post(`${BASE}/api/bookings/${create.json('id')}/cancel`, null, { ...auth, tags: { name: 'cancel_booking' } });
      bookingFailures.add(!check(cancel, { 'cancel 200': (r) => r.status === 200 }));
    }
  });

  sleep(1);
}
