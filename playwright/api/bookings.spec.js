const { test, expect } = require('@playwright/test');
const { apiAs, newCar, newBooking, createCarWithDriver } = require('../helpers');

test.describe('bookings API', () => {
  let admin; let dispatcher;
  test.beforeAll(async ({ playwright: _p }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    admin = await apiAs('admin', baseURL);
    dispatcher = await apiAs('dispatcher', baseURL);
  });
  test.afterAll(async () => { await admin.dispose(); await dispatcher.dispose(); });

  const create = async (client = dispatcher, over = {}) => (await client.post('/api/bookings', newBooking(over))).json();

  test('dispatcher creates a booking; fare is computed on the server (3 + 1.5/km)', async () => {
    const res = await dispatcher.post('/api/bookings', { ...newBooking({ distance_km: 10 }), fare: 0.01, status: 'completed' });
    expect(res.status()).toBe(201);
    const b = await res.json();
    expect(b).toMatchObject({ status: 'requested', fare: 18, car_id: null });
  });

  test('validation: missing fields, bad distance, bad date -> 400', async () => {
    expect((await dispatcher.post('/api/bookings', {})).status()).toBe(400);
    for (const bad of [{ distance_km: 0 }, { distance_km: 501 }, { scheduled_at: 'soon' }, { customer_phone: 'abc' }]) {
      expect((await dispatcher.post('/api/bookings', newBooking(bad))).status(), JSON.stringify(bad)).toBe(400);
    }
  });

  test('full lifecycle: requested -> assigned -> in_progress -> completed', async () => {
    const { car } = await createCarWithDriver(admin);
    const b = await create();
    const assigned = await (await dispatcher.post(`/api/bookings/${b.id}/assign`, { car_id: car.id })).json();
    expect(assigned).toMatchObject({ status: 'assigned', car_id: car.id, car_plate: car.plate });
    expect((await (await dispatcher.post(`/api/bookings/${b.id}/start`)).json()).status).toBe('in_progress');
    expect((await (await dispatcher.post(`/api/bookings/${b.id}/complete`)).json()).status).toBe('completed');
  });

  test('invalid transitions -> 409', async () => {
    const b = await create();
    expect((await dispatcher.post(`/api/bookings/${b.id}/start`)).status()).toBe(409);
    expect((await dispatcher.post(`/api/bookings/${b.id}/complete`)).status()).toBe(409);
    expect((await dispatcher.post(`/api/bookings/${b.id}/cancel`)).status()).toBe(200);
    expect((await dispatcher.post(`/api/bookings/${b.id}/cancel`)).status()).toBe(409);
  });

  test('cannot assign: maintenance car, car without driver, inactive driver, busy car', async () => {
    const b = await create();

    const maint = await (await admin.post('/api/cars', newCar({ status: 'maintenance' }))).json();
    expect((await dispatcher.post(`/api/bookings/${b.id}/assign`, { car_id: maint.id })).status()).toBe(409);

    const noDriver = await (await admin.post('/api/cars', newCar())).json();
    expect((await dispatcher.post(`/api/bookings/${b.id}/assign`, { car_id: noDriver.id })).status()).toBe(409);

    const { driver, car } = await createCarWithDriver(admin);
    await admin.put(`/api/drivers/${driver.id}`, { status: 'inactive' });
    expect((await dispatcher.post(`/api/bookings/${b.id}/assign`, { car_id: car.id })).status()).toBe(409);

    const ok = await createCarWithDriver(admin);
    expect((await dispatcher.post(`/api/bookings/${b.id}/assign`, { car_id: ok.car.id })).status()).toBe(200);
    const b2 = await create();
    expect((await dispatcher.post(`/api/bookings/${b2.id}/assign`, { car_id: ok.car.id })).status()).toBe(409);
  });

  test('assign validation: missing car_id -> 400, unknown car -> 404', async () => {
    const b = await create();
    expect((await dispatcher.post(`/api/bookings/${b.id}/assign`, {})).status()).toBe(400);
    expect((await dispatcher.post(`/api/bookings/${b.id}/assign`, { car_id: 99999999 })).status()).toBe(404);
  });

  test('cannot delete a car that has an active booking', async () => {
    const { car } = await createCarWithDriver(admin);
    const b = await create();
    await dispatcher.post(`/api/bookings/${b.id}/assign`, { car_id: car.id });
    expect((await admin.del(`/api/cars/${car.id}`)).status()).toBe(409);
  });

  test('list supports a status filter; invalid filter -> 400', async () => {
    const b = await create();
    await dispatcher.post(`/api/bookings/${b.id}/cancel`);
    const list = await (await dispatcher.get('/api/bookings?status=cancelled')).json();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((x) => x.status === 'cancelled')).toBe(true);
    expect((await dispatcher.get('/api/bookings?status=bogus')).status()).toBe(400);
  });

  test('RBAC: only admin can delete bookings', async () => {
    const b = await create();
    expect((await dispatcher.del(`/api/bookings/${b.id}`)).status()).toBe(403);
    expect((await admin.del(`/api/bookings/${b.id}`)).status()).toBe(204);
    expect((await admin.get(`/api/bookings/${b.id}`)).status()).toBe(404);
  });

  test('RBAC: only admin can manage users; weak password rejected; duplicate username -> 409', async () => {
    expect((await dispatcher.get('/api/users')).status()).toBe(403);
    expect((await dispatcher.post('/api/users', { username: 'x-user', password: 'Strong-Pass-123', role: 'admin' })).status()).toBe(403);
    const name = `staff-${Date.now() % 1e7}`;
    expect((await admin.post('/api/users', { username: name, password: 'short', role: 'dispatcher' })).status()).toBe(400);
    expect((await admin.post('/api/users', { username: name, password: 'Strong-Pass-123', role: 'dispatcher' })).status()).toBe(201);
    expect((await admin.post('/api/users', { username: name, password: 'Strong-Pass-123', role: 'dispatcher' })).status()).toBe(409);
    const list = await (await admin.get('/api/users')).json();
    expect(list.some((u) => u.username === name)).toBe(true);
    expect(JSON.stringify(list)).not.toContain('password');
  });

});
