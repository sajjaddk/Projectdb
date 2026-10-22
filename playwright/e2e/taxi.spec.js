const { test, expect } = require('@playwright/test');
const { CREDS, apiAs, newDriver, newCar, newBooking, uid } = require('../helpers');

async function login(page, role) {
  await page.goto('/');
  await page.getByTestId('username').fill(CREDS[role].username);
  await page.getByTestId('password').fill(CREDS[role].password);
  await page.getByTestId('login-btn').click();
  await expect(page.getByTestId('whoami')).toContainText(role);
}

test.describe('login', () => {
  test('shows the login form when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('invalid credentials show an error and stay on login', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('username').fill('admin');
    await page.getByTestId('password').fill('definitely-wrong-1');
    await page.getByTestId('login-btn').click();
    await expect(page.getByTestId('message')).toHaveText('Invalid username or password');
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('admin can log in, sees Users tab, and can log out', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByTestId('tab-users')).toBeVisible();
    await page.getByTestId('logout-btn').click();
    await expect(page.getByTestId('login-btn')).toBeVisible();
  });

  test('session survives a page reload', async ({ page }) => {
    await login(page, 'dispatcher');
    await page.reload();
    await expect(page.getByTestId('whoami')).toContainText('dispatcher');
  });
});

test.describe('admin: drivers and cars', () => {
  test('create a driver, then register a car with that driver', async ({ page }) => {
    const driver = newDriver();
    const car = newCar();
    await login(page, 'admin');

    await page.getByTestId('tab-drivers').click();
    await page.getByTestId('d-name').fill(driver.full_name);
    await page.getByTestId('d-phone').fill(driver.phone);
    await page.getByTestId('d-license').fill(driver.license_number);
    await page.getByTestId('d-submit').click();
    await expect(page.getByTestId('driver-row').filter({ hasText: driver.full_name })).toBeVisible();

    await page.getByTestId('tab-cars').click();
    await page.getByTestId('c-plate').fill(car.plate);
    await page.getByTestId('c-make').fill(car.make);
    await page.getByTestId('c-model').fill(car.model);
    await page.getByTestId('c-year').fill(String(car.year));
    await page.getByTestId('c-seats').fill(String(car.seats));
    await page.getByTestId('c-driver').selectOption({ label: driver.full_name });
    await page.getByTestId('c-submit').click();
    const row = page.getByTestId('car-row').filter({ hasText: car.plate });
    await expect(row).toContainText(driver.full_name);
  });

  test('duplicate plate shows an error message', async ({ page, baseURL }) => {
    const admin = await apiAs('admin', baseURL);
    const car = newCar();
    await admin.post('/api/cars', car);
    await admin.dispose();
    await login(page, 'admin');
    await page.getByTestId('tab-cars').click();
    await page.getByTestId('c-plate').fill(car.plate);
    await page.getByTestId('c-make').fill('Ford');
    await page.getByTestId('c-model').fill('Focus');
    await page.getByTestId('c-year').fill('2020');
    await page.getByTestId('c-seats').fill('4');
    await page.getByTestId('c-submit').click();
    await expect(page.getByTestId('message')).toHaveText('Plate already registered');
  });

  test('toggle a car to maintenance and delete it', async ({ page, baseURL }) => {
    const admin = await apiAs('admin', baseURL);
    const car = newCar();
    await admin.post('/api/cars', car);
    await admin.dispose();
    await login(page, 'admin');
    await page.getByTestId('tab-cars').click();
    const row = page.getByTestId('car-row').filter({ hasText: car.plate });
    await row.getByTestId('toggle-car').click();
    await expect(row).toContainText('maintenance');
    await row.getByTestId('delete-car').click();
    await expect(row).toHaveCount(0);
  });
});

test.describe('dispatcher: bookings', () => {
  test('create a booking, assign a car, start and complete the trip', async ({ page, baseURL }) => {
    const admin = await apiAs('admin', baseURL);
    const driver = await (await admin.post('/api/drivers', newDriver())).json();
    const car = await (await admin.post('/api/cars', newCar({ driver_id: driver.id }))).json();
    await admin.dispose();

    const b = newBooking({ customer_name: `Rider ${uid()}`, distance_km: 12 });
    await login(page, 'dispatcher');
    await page.getByTestId('b-customer').fill(b.customer_name);
    await page.getByTestId('b-phone').fill(b.customer_phone);
    await page.getByTestId('b-pickup').fill(b.pickup);
    await page.getByTestId('b-dropoff').fill(b.dropoff);
    await page.getByTestId('b-distance').fill('12');
    await page.getByTestId('b-when').fill('2030-05-20T09:30');
    await page.getByTestId('b-submit').click();

    const row = page.getByTestId('booking-row').filter({ hasText: b.customer_name });
    await expect(row.getByTestId('booking-status')).toHaveText('requested');
    await expect(row).toContainText('$21.00'); // 3 + 1.5 * 12

    await row.getByTestId('assign-select').selectOption({ label: `${car.plate} - ${driver.full_name}` });
    await row.getByTestId('assign-btn').click();
    await expect(row.getByTestId('booking-status')).toHaveText('assigned');

    await row.getByTestId('start-btn').click();
    await expect(row.getByTestId('booking-status')).toHaveText('in_progress');
    await row.getByTestId('complete-btn').click();
    await expect(row.getByTestId('booking-status')).toHaveText('completed');
  });

  test('cancel a booking', async ({ page }) => {
    const b = newBooking({ customer_name: `Cancel ${uid()}` });
    await login(page, 'dispatcher');
    await page.getByTestId('b-customer').fill(b.customer_name);
    await page.getByTestId('b-phone').fill(b.customer_phone);
    await page.getByTestId('b-pickup').fill(b.pickup);
    await page.getByTestId('b-dropoff').fill(b.dropoff);
    await page.getByTestId('b-distance').fill('3');
    await page.getByTestId('b-when').fill('2030-05-20T09:30');
    await page.getByTestId('b-submit').click();
    const row = page.getByTestId('booking-row').filter({ hasText: b.customer_name });
    await row.getByTestId('cancel-btn').click();
    await expect(row.getByTestId('booking-status')).toHaveText('cancelled');
  });

  test('dispatcher does not see admin-only forms or the Users tab', async ({ page }) => {
    await login(page, 'dispatcher');
    await expect(page.getByTestId('tab-users')).toBeHidden();
    await page.getByTestId('tab-drivers').click();
    await expect(page.getByTestId('d-submit')).toBeHidden();
    await page.getByTestId('tab-cars').click();
    await expect(page.getByTestId('c-submit')).toBeHidden();
  });

  test('user-supplied markup is rendered as text, not executed (XSS)', async ({ page, baseURL }) => {
    const dispatcher = await apiAs('dispatcher', baseURL);
    const name = `<img src=x onerror="window.__xss=1"> ${uid()}`;
    await dispatcher.post('/api/bookings', newBooking({ customer_name: name }));
    await dispatcher.dispose();
    await login(page, 'dispatcher');
    await expect(page.getByTestId('booking-row').filter({ hasText: name }).first()).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('admin: users', () => {
  test('admin adds a user who can then log in', async ({ page, browser }) => {
    const username = `staff-${uid().toLowerCase()}`;
    await login(page, 'admin');
    await page.getByTestId('tab-users').click();
    await page.getByTestId('u-name').fill(username);
    await page.getByTestId('u-password').fill('Staff-Password-123');
    await page.getByTestId('u-role').selectOption('dispatcher');
    await page.getByTestId('u-submit').click();
    await expect(page.getByTestId('user-row').filter({ hasText: username })).toBeVisible();

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto('/');
    await p2.getByTestId('username').fill(username);
    await p2.getByTestId('password').fill('Staff-Password-123');
    await p2.getByTestId('login-btn').click();
    await expect(p2.getByTestId('whoami')).toContainText(username);
    await ctx.close();
  });
});
