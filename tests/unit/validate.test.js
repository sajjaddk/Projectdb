'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateDriver, validateCar, validateBooking, validateNewUser, calculateFare,
} = require('../../src/validate');
const { hashPassword, verifyPassword } = require('../../src/passwords');

const goodDriver = { full_name: 'Alex Morgan', phone: '+1 555 0101', license_number: 'dl-12345' };
const goodCar = { plate: 'ab-123', make: 'Toyota', model: 'Camry', year: 2022, seats: 4 };
const goodBooking = {
  customer_name: 'Pat Doe', customer_phone: '555-0199', pickup: '1 Main St', dropoff: '9 High St',
  distance_km: 10, scheduled_at: '2030-01-01T10:00:00Z',
};

test('driver: valid input is normalised (license upper-cased, status defaults to active)', () => {
  const { value, errors } = validateDriver(goodDriver);
  assert.deepEqual(errors, {});
  assert.equal(value.license_number, 'DL-12345');
  assert.equal(value.status, 'active');
});

test('driver: rejects short name, bad phone, bad license, bad status', () => {
  const { errors } = validateDriver({ full_name: 'A', phone: 'abc', license_number: '!!', status: 'x' });
  assert.deepEqual(Object.keys(errors).sort(), ['full_name', 'license_number', 'phone', 'status']);
});

test('driver: non-object body is rejected', () => {
  assert.ok(validateDriver(null).errors.body);
  assert.ok(validateDriver([]).errors.body);
});

test('car: valid input, plate upper-cased', () => {
  const { value, errors } = validateCar(goodCar);
  assert.deepEqual(errors, {});
  assert.equal(value.plate, 'AB-123');
  assert.equal(value.driver_id, null);
});

test('car: boundary values for year and seats', () => {
  assert.deepEqual(validateCar({ ...goodCar, year: 1990, seats: 1 }).errors, {});
  assert.deepEqual(validateCar({ ...goodCar, seats: 8 }).errors, {});
  assert.ok(validateCar({ ...goodCar, year: 1989 }).errors.year);
  assert.ok(validateCar({ ...goodCar, seats: 0 }).errors.seats);
  assert.ok(validateCar({ ...goodCar, seats: 9 }).errors.seats);
  assert.ok(validateCar({ ...goodCar, year: '2022' }).errors.year);
});

test('car: unknown fields are dropped (no mass assignment)', () => {
  const { value } = validateCar({ ...goodCar, id: 99, is_admin: true });
  assert.equal('id' in value, false);
  assert.equal('is_admin' in value, false);
});

test('booking: valid input', () => {
  const { value, errors } = validateBooking(goodBooking);
  assert.deepEqual(errors, {});
  assert.equal(value.scheduled_at, '2030-01-01T10:00:00.000Z');
});

test('booking: distance boundaries', () => {
  assert.deepEqual(validateBooking({ ...goodBooking, distance_km: 0.1 }).errors, {});
  assert.deepEqual(validateBooking({ ...goodBooking, distance_km: 500 }).errors, {});
  assert.ok(validateBooking({ ...goodBooking, distance_km: 0 }).errors.distance_km);
  assert.ok(validateBooking({ ...goodBooking, distance_km: 500.1 }).errors.distance_km);
  assert.ok(validateBooking({ ...goodBooking, distance_km: '10' }).errors.distance_km);
  assert.ok(validateBooking({ ...goodBooking, distance_km: NaN }).errors.distance_km);
});

test('booking: invalid date', () => {
  assert.ok(validateBooking({ ...goodBooking, scheduled_at: 'tomorrow-ish' }).errors.scheduled_at);
});

test('fare = 3.00 base + 1.50 per km, rounded to cents', () => {
  assert.equal(calculateFare(10), 18);
  assert.equal(calculateFare(0.1), 3.15);
  assert.equal(calculateFare(7.3), 13.95);
});

test('new user: password policy', () => {
  const base = { username: 'Bob.Smith', role: 'dispatcher' };
  assert.deepEqual(validateNewUser({ ...base, password: 'Correct-Horse-1' }).errors, {});
  assert.equal(validateNewUser({ ...base, password: 'Correct-Horse-1' }).value.username, 'bob.smith');
  assert.ok(validateNewUser({ ...base, password: 'short1' }).errors.password);
  assert.ok(validateNewUser({ ...base, password: 'onlyletterspassword' }).errors.password);
  assert.ok(validateNewUser({ ...base, password: 'Correct-Horse-1', role: 'root' }).errors.role);
});

test('passwords: hash is salted, verifies, and rejects wrong password', async () => {
  const h1 = await hashPassword('Secret-Pass-123');
  const h2 = await hashPassword('Secret-Pass-123');
  assert.notEqual(h1, h2);
  assert.ok(!h1.includes('Secret-Pass-123'));
  assert.equal(await verifyPassword('Secret-Pass-123', h1), true);
  assert.equal(await verifyPassword('wrong', h1), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});
