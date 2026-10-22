'use strict';
// Server-side allow-list validation. Every function returns { value, errors }.
// Only known fields are copied into `value` (no mass assignment).

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const LICENSE_RE = /^[A-Z0-9-]{5,20}$/;
const PLATE_RE = /^[A-Z0-9- ]{2,10}$/;
const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;

function str(input, field, errors, { min = 1, max = 100 } = {}) {
  if (typeof input !== 'string') {
    errors[field] = 'must be a string';
    return undefined;
  }
  const v = input.trim();
  if (v.length < min || v.length > max) {
    errors[field] = `must be between ${min} and ${max} characters`;
    return undefined;
  }
  return v;
}

function int(input, field, errors, { min, max }) {
  if (!Number.isInteger(input) || input < min || input > max) {
    errors[field] = `must be an integer between ${min} and ${max}`;
    return undefined;
  }
  return input;
}

function oneOf(input, field, errors, allowed) {
  if (!allowed.includes(input)) {
    errors[field] = `must be one of: ${allowed.join(', ')}`;
    return undefined;
  }
  return input;
}

function isObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

function validateDriver(body) {
  const errors = {};
  if (!isObject(body)) return { value: null, errors: { body: 'must be a JSON object' } };
  const value = {
    full_name: str(body.full_name, 'full_name', errors, { min: 2, max: 100 }),
    phone: undefined,
    license_number: undefined,
    status: oneOf(body.status ?? 'active', 'status', errors, ['active', 'inactive']),
  };
  const phone = str(body.phone, 'phone', errors, { min: 7, max: 20 });
  if (phone !== undefined) {
    if (PHONE_RE.test(phone)) value.phone = phone;
    else errors.phone = 'invalid phone number';
  }
  const lic = str(body.license_number, 'license_number', errors, { min: 5, max: 20 });
  if (lic !== undefined) {
    const up = lic.toUpperCase();
    if (LICENSE_RE.test(up)) value.license_number = up;
    else errors.license_number = 'letters, digits and dashes only (5-20 chars)';
  }
  return { value, errors };
}

function validateCar(body) {
  const errors = {};
  if (!isObject(body)) return { value: null, errors: { body: 'must be a JSON object' } };
  const value = {
    plate: undefined,
    make: str(body.make, 'make', errors, { max: 50 }),
    model: str(body.model, 'model', errors, { max: 50 }),
    year: int(body.year, 'year', errors, { min: 1990, max: new Date().getFullYear() + 1 }),
    seats: int(body.seats, 'seats', errors, { min: 1, max: 8 }),
    status: oneOf(body.status ?? 'available', 'status', errors, ['available', 'maintenance']),
    driver_id: null,
  };
  const plate = str(body.plate, 'plate', errors, { min: 2, max: 10 });
  if (plate !== undefined) {
    const up = plate.toUpperCase();
    if (PLATE_RE.test(up)) value.plate = up;
    else errors.plate = 'letters, digits, spaces and dashes only (2-10 chars)';
  }
  if (body.driver_id !== undefined && body.driver_id !== null) {
    value.driver_id = int(body.driver_id, 'driver_id', errors, { min: 1, max: Number.MAX_SAFE_INTEGER });
  }
  return { value, errors };
}

function validateBooking(body) {
  const errors = {};
  if (!isObject(body)) return { value: null, errors: { body: 'must be a JSON object' } };
  const value = {
    customer_name: str(body.customer_name, 'customer_name', errors, { min: 2, max: 100 }),
    customer_phone: undefined,
    pickup: str(body.pickup, 'pickup', errors, { min: 3, max: 200 }),
    dropoff: str(body.dropoff, 'dropoff', errors, { min: 3, max: 200 }),
    distance_km: undefined,
    scheduled_at: undefined,
  };
  const phone = str(body.customer_phone, 'customer_phone', errors, { min: 7, max: 20 });
  if (phone !== undefined) {
    if (PHONE_RE.test(phone)) value.customer_phone = phone;
    else errors.customer_phone = 'invalid phone number';
  }
  if (typeof body.distance_km !== 'number' || !Number.isFinite(body.distance_km) ||
      body.distance_km < 0.1 || body.distance_km > 500) {
    errors.distance_km = 'must be a number between 0.1 and 500';
  } else {
    value.distance_km = Math.round(body.distance_km * 10) / 10;
  }
  const when = typeof body.scheduled_at === 'string' ? new Date(body.scheduled_at) : null;
  if (!when || Number.isNaN(when.getTime())) errors.scheduled_at = 'must be a valid ISO date-time';
  else value.scheduled_at = when.toISOString();
  return { value, errors };
}

function validateNewUser(body) {
  const errors = {};
  if (!isObject(body)) return { value: null, errors: { body: 'must be a JSON object' } };
  const value = { username: undefined, password: undefined, role: oneOf(body.role, 'role', errors, ['admin', 'dispatcher']) };
  const username = str(body.username, 'username', errors, { min: 3, max: 32 });
  if (username !== undefined) {
    const low = username.toLowerCase();
    if (USERNAME_RE.test(low)) value.username = low;
    else errors.username = 'lowercase letters, digits, dot, dash, underscore (3-32 chars)';
  }
  const pw = body.password;
  if (typeof pw !== 'string' || pw.length < 12 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    errors.password = 'must be 12-128 characters and contain letters and digits';
  } else {
    value.password = pw;
  }
  return { value, errors };
}

// Fare = base fee + per-km rate. Computed on the server, never trusted from the client.
const BASE_FARE = 3;
const RATE_PER_KM = 1.5;
function calculateFare(distanceKm) {
  return Math.round((BASE_FARE + RATE_PER_KM * distanceKm) * 100) / 100;
}

module.exports = {
  validateDriver, validateCar, validateBooking, validateNewUser,
  calculateFare, BASE_FARE, RATE_PER_KM,
};
