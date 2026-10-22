const { test, expect } = require('@playwright/test');
const { apiAs, newDriver, newCar, createCarWithDriver } = require('../helpers');

test.describe('drivers API', () => {
  let admin; let dispatcher;
  test.beforeAll(async ({ playwright: _p }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    admin = await apiAs('admin', baseURL);
    dispatcher = await apiAs('dispatcher', baseURL);
  });
  test.afterAll(async () => { await admin.dispose(); await dispatcher.dispose(); });

  test('admin creates, reads, updates and deletes a driver', async () => {
    const payload = newDriver();
    const created = await admin.post('/api/drivers', payload);
    expect(created.status()).toBe(201);
    const driver = await created.json();
    expect(driver).toMatchObject({ full_name: payload.full_name, status: 'active' });

    expect((await (await admin.get(`/api/drivers/${driver.id}`)).json()).license_number).toBe(payload.license_number);

    const upd = await admin.put(`/api/drivers/${driver.id}`, { status: 'inactive' });
    expect(upd.status()).toBe(200);
    expect((await upd.json()).status).toBe('inactive');

    expect((await admin.del(`/api/drivers/${driver.id}`)).status()).toBe(204);
    expect((await admin.get(`/api/drivers/${driver.id}`)).status()).toBe(404);
  });

  test('duplicate license number -> 409', async () => {
    const payload = newDriver();
    expect((await admin.post('/api/drivers', payload)).status()).toBe(201);
    expect((await admin.post('/api/drivers', newDriver({ license_number: payload.license_number }))).status()).toBe(409);
  });

  test('validation errors -> 400 with details', async () => {
    const res = await admin.post('/api/drivers', { full_name: 'A', phone: 'x', license_number: '!' });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.details)).toEqual(expect.arrayContaining(['full_name', 'phone', 'license_number']));
  });

  test('malformed JSON -> 400, invalid id -> 400, unknown id -> 404', async () => {
    const bad = await admin.ctx.post('/api/drivers', {
      data: '{not json', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': (await (await admin.get('/api/auth/me')).json()).csrfToken },
    });
    expect(bad.status()).toBe(400);
    expect((await admin.get('/api/drivers/abc')).status()).toBe(400);
    expect((await admin.get('/api/drivers/99999999')).status()).toBe(404);
  });

  test('RBAC: dispatcher can read but not create/update/delete drivers', async () => {
    expect((await dispatcher.get('/api/drivers')).status()).toBe(200);
    expect((await dispatcher.post('/api/drivers', newDriver())).status()).toBe(403);
    expect((await dispatcher.put('/api/drivers/1', { status: 'inactive' })).status()).toBe(403);
    expect((await dispatcher.del('/api/drivers/1')).status()).toBe(403);
  });
});

test.describe('cars API', () => {
  let admin; let dispatcher;
  test.beforeAll(async ({ playwright: _p }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    admin = await apiAs('admin', baseURL);
    dispatcher = await apiAs('dispatcher', baseURL);
  });
  test.afterAll(async () => { await admin.dispose(); await dispatcher.dispose(); });

  test('admin registers a car with a driver and sees the driver name', async () => {
    const { driver, car } = await createCarWithDriver(admin);
    expect(car).toMatchObject({ driver_id: driver.id, driver_name: driver.full_name, status: 'available' });
  });

  test('plate is normalised to upper case; duplicate plate -> 409', async () => {
    const payload = newCar({ plate: `dup-${Date.now() % 100000}` });
    const res = await admin.post('/api/cars', payload);
    expect(res.status()).toBe(201);
    expect((await res.json()).plate).toBe(payload.plate.toUpperCase());
    expect((await admin.post('/api/cars', payload)).status()).toBe(409);
  });

  test('a driver can only be assigned to one car -> 409', async () => {
    const { driver } = await createCarWithDriver(admin);
    const res = await admin.post('/api/cars', newCar({ driver_id: driver.id }));
    expect(res.status()).toBe(409);
  });

  test('unknown driver -> 400', async () => {
    expect((await admin.post('/api/cars', newCar({ driver_id: 99999999 }))).status()).toBe(400);
  });

  test('boundary validation: seats 0/9 and year 1989 rejected, 1 / 8 / 1990 accepted', async () => {
    for (const bad of [{ seats: 0 }, { seats: 9 }, { year: 1989 }]) {
      expect((await admin.post('/api/cars', newCar(bad))).status()).toBe(400);
    }
    expect((await admin.post('/api/cars', newCar({ seats: 1, year: 1990 }))).status()).toBe(201);
    expect((await admin.post('/api/cars', newCar({ seats: 8 }))).status()).toBe(201);
  });

  test('update status to maintenance then delete', async () => {
    const car = await (await admin.post('/api/cars', newCar())).json();
    const upd = await admin.put(`/api/cars/${car.id}`, { status: 'maintenance' });
    expect((await upd.json()).status).toBe('maintenance');
    expect((await admin.del(`/api/cars/${car.id}`)).status()).toBe(204);
  });

  test('mass assignment: client-supplied id is ignored', async () => {
    const res = await admin.post('/api/cars', { ...newCar(), id: 1, created_at: '2000-01-01' });
    expect(res.status()).toBe(201);
    expect((await res.json()).id).not.toBe(1);
  });

  test('RBAC: dispatcher can list cars but not register or delete', async () => {
    expect((await dispatcher.get('/api/cars')).status()).toBe(200);
    expect((await dispatcher.post('/api/cars', newCar())).status()).toBe(403);
    expect((await dispatcher.del('/api/cars/1')).status()).toBe(403);
  });

  test('SQL injection attempt in plate is stored as data / rejected, never executed', async () => {
    const res = await admin.post('/api/cars', newCar({ plate: "x'; DROP TABLE cars;--" }));
    expect(res.status()).toBe(400);
    expect((await admin.get('/api/cars')).status()).toBe(200);
  });
});
