const { request, expect } = require('@playwright/test');

const CREDS = {
  admin: { username: 'admin', password: process.env.ADMIN_PASSWORD },
  dispatcher: { username: 'dispatcher', password: process.env.DISPATCHER_PASSWORD },
};

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

/** Logs in through the API and returns a client that sends the session cookie + CSRF header. */
async function apiAs(role, baseURL) {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/auth/login', { data: CREDS[role] });
  expect(res.status()).toBe(200);
  const { csrfToken } = await res.json();
  const headers = { 'X-CSRF-Token': csrfToken };
  return {
    ctx,
    get: (url) => ctx.get(url),
    post: (url, data) => ctx.post(url, { data, headers }),
    put: (url, data) => ctx.put(url, { data, headers }),
    del: (url) => ctx.delete(url, { headers }),
    dispose: () => ctx.dispose(),
  };
}

const newDriver = (over = {}) => ({
  full_name: `Test Driver ${uid()}`, phone: `+1 555 ${digits(4)}`, license_number: `LIC-${uid()}${digits(3)}`, ...over,
});
const newCar = (over = {}) => ({
  plate: `T-${uid()}`, make: 'Toyota', model: 'Prius', year: 2023, seats: 4, ...over,
});
const newBooking = (over = {}) => ({
  customer_name: `Customer ${uid()}`, customer_phone: `555-${digits(4)}`, pickup: '1 Main Street',
  dropoff: '99 Station Road', distance_km: 10, scheduled_at: new Date(Date.now() + 3600_000).toISOString(), ...over,
});

/** Creates a driver and a car with that driver (admin client required). */
async function createCarWithDriver(admin) {
  const driver = await (await admin.post('/api/drivers', newDriver())).json();
  const car = await (await admin.post('/api/cars', newCar({ driver_id: driver.id }))).json();
  return { driver, car };
}

module.exports = { CREDS, apiAs, newDriver, newCar, newBooking, createCarWithDriver, uid };
