'use strict';
const express = require('express');
const path = require('node:path');
const { createAuth } = require('./auth');
const { verifyPassword, hashPassword, DUMMY_HASH } = require('./passwords');
const {
  validateDriver, validateCar, validateBooking, validateNewUser, calculateFare,
} = require('./validate');

const isUnique = (err) => /UNIQUE constraint failed/.test(String(err && err.message));
const log = (event, data = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  return id;
}

function createApp(db, { secureCookie = false } = {}) {
  const app = express();
  const auth = createAuth(db, { secureCookie });
  const { requireAuth, requireCsrf, requireRole } = auth;
  const admin = requireRole('admin');
  const anyStaff = requireRole('admin', 'dispatcher');

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '50kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // ---------- auth ----------
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password ||
        username.length > 64 || password.length > 128) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const key = auth.loginKey(req, username);
    if (auth.limiter.isLocked(key)) {
      log('auth.locked', { username });
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }
    const user = db.prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?')
      .get(username.toLowerCase());
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      auth.limiter.fail(key);
      log('auth.failed', { username });
      return res.status(401).json({ error: 'Invalid username or password' }); // generic on purpose
    }
    auth.limiter.reset(key);
    const { token, csrfToken } = auth.createSession(user.id); // new session id on every login
    auth.setCookie(res, token);
    log('auth.login', { userId: user.id });
    res.json({ user: { id: user.id, username: user.username, role: user.role }, csrfToken });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user, csrfToken: req.session.csrfToken });
  });

  app.post('/api/auth/logout', requireAuth, requireCsrf, (req, res) => {
    auth.destroySession(req.session.token);
    auth.clearCookie(res);
    res.status(204).end();
  });

  // Everything below needs a valid session; state-changing calls also need the CSRF token.
  app.use('/api', requireAuth, requireCsrf);

  // ---------- users (admin only) ----------
  app.get('/api/users', admin, (req, res) => {
    res.json(db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all());
  });

  app.post('/api/users', admin, async (req, res) => {
    const { value, errors } = validateNewUser(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', details: errors });
    try {
      const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)')
        .run(value.username, await hashPassword(value.password), value.role);
      log('admin.user_created', { by: req.user.id, userId: Number(info.lastInsertRowid) });
      res.status(201).json({ id: Number(info.lastInsertRowid), username: value.username, role: value.role });
    } catch (err) {
      if (isUnique(err)) return res.status(409).json({ error: 'Username already exists' });
      throw err;
    }
  });

  // ---------- drivers ----------
  app.get('/api/drivers', anyStaff, (req, res) => {
    res.json(db.prepare('SELECT * FROM drivers ORDER BY id').all());
  });

  app.get('/api/drivers/:id', anyStaff, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const row = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    return row ? res.json(row) : res.status(404).json({ error: 'Driver not found' });
  });

  app.post('/api/drivers', admin, (req, res) => {
    const { value, errors } = validateDriver(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', details: errors });
    try {
      const info = db.prepare('INSERT INTO drivers (full_name, phone, license_number, status) VALUES (?,?,?,?)')
        .run(value.full_name, value.phone, value.license_number, value.status);
      res.status(201).json(db.prepare('SELECT * FROM drivers WHERE id = ?').get(Number(info.lastInsertRowid)));
    } catch (err) {
      if (isUnique(err)) return res.status(409).json({ error: 'License number already registered' });
      throw err;
    }
  });

  app.put('/api/drivers/:id', admin, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const existing = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Driver not found' });
    const { value, errors } = validateDriver({ ...existing, ...req.body });
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', details: errors });
    try {
      db.prepare('UPDATE drivers SET full_name=?, phone=?, license_number=?, status=? WHERE id=?')
        .run(value.full_name, value.phone, value.license_number, value.status, id);
      res.json(db.prepare('SELECT * FROM drivers WHERE id = ?').get(id));
    } catch (err) {
      if (isUnique(err)) return res.status(409).json({ error: 'License number already registered' });
      throw err;
    }
  });

  app.delete('/api/drivers/:id', admin, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const info = db.prepare('DELETE FROM drivers WHERE id = ?').run(id);
    return info.changes ? res.status(204).end() : res.status(404).json({ error: 'Driver not found' });
  });

  // ---------- cars ----------
  const CAR_SELECT = `SELECT c.*, d.full_name AS driver_name FROM cars c LEFT JOIN drivers d ON d.id = c.driver_id`;

  app.get('/api/cars', anyStaff, (req, res) => {
    res.json(db.prepare(`${CAR_SELECT} ORDER BY c.id`).all());
  });

  app.get('/api/cars/:id', anyStaff, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const row = db.prepare(`${CAR_SELECT} WHERE c.id = ?`).get(id);
    return row ? res.json(row) : res.status(404).json({ error: 'Car not found' });
  });

  function saveCar(req, res, id) {
    const existing = id ? db.prepare('SELECT * FROM cars WHERE id = ?').get(id) : {};
    const { value, errors } = validateCar({ ...existing, ...req.body });
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', details: errors });
    if (value.driver_id !== null && !db.prepare('SELECT 1 FROM drivers WHERE id = ?').get(value.driver_id)) {
      return res.status(400).json({ error: 'Validation failed', details: { driver_id: 'driver does not exist' } });
    }
    try {
      let carId = id;
      if (id) {
        db.prepare('UPDATE cars SET plate=?, make=?, model=?, year=?, seats=?, status=?, driver_id=? WHERE id=?')
          .run(value.plate, value.make, value.model, value.year, value.seats, value.status, value.driver_id, id);
      } else {
        carId = Number(db.prepare('INSERT INTO cars (plate, make, model, year, seats, status, driver_id) VALUES (?,?,?,?,?,?,?)')
          .run(value.plate, value.make, value.model, value.year, value.seats, value.status, value.driver_id).lastInsertRowid);
      }
      res.status(id ? 200 : 201).json(db.prepare(`${CAR_SELECT} WHERE c.id = ?`).get(carId));
    } catch (err) {
      if (isUnique(err)) {
        const msg = /driver_id/.test(err.message) ? 'Driver is already assigned to another car' : 'Plate already registered';
        return res.status(409).json({ error: msg });
      }
      throw err;
    }
  }

  app.post('/api/cars', admin, (req, res) => saveCar(req, res, null));
  app.put('/api/cars/:id', admin, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    if (!db.prepare('SELECT 1 FROM cars WHERE id = ?').get(id)) return res.status(404).json({ error: 'Car not found' });
    saveCar(req, res, id);
  });

  app.delete('/api/cars/:id', admin, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const active = db.prepare("SELECT 1 FROM bookings WHERE car_id = ? AND status IN ('assigned','in_progress')").get(id);
    if (active) return res.status(409).json({ error: 'Car has active bookings' });
    const info = db.prepare('DELETE FROM cars WHERE id = ?').run(id);
    return info.changes ? res.status(204).end() : res.status(404).json({ error: 'Car not found' });
  });

  // ---------- bookings ----------
  const BOOKING_SELECT = `
    SELECT b.*, c.plate AS car_plate, d.full_name AS driver_name
      FROM bookings b
      LEFT JOIN cars c ON c.id = b.car_id
      LEFT JOIN drivers d ON d.id = c.driver_id`;
  const STATUSES = ['requested', 'assigned', 'in_progress', 'completed', 'cancelled'];

  app.get('/api/bookings', anyStaff, (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status filter' });
    const rows = status
      ? db.prepare(`${BOOKING_SELECT} WHERE b.status = ? ORDER BY b.id DESC`).all(status)
      : db.prepare(`${BOOKING_SELECT} ORDER BY b.id DESC`).all();
    res.json(rows);
  });

  app.get('/api/bookings/:id', anyStaff, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const row = db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id);
    return row ? res.json(row) : res.status(404).json({ error: 'Booking not found' });
  });

  app.post('/api/bookings', anyStaff, (req, res) => {
    const { value, errors } = validateBooking(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', details: errors });
    const info = db.prepare(
      `INSERT INTO bookings (customer_name, customer_phone, pickup, dropoff, distance_km, fare, scheduled_at, created_by)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(value.customer_name, value.customer_phone, value.pickup, value.dropoff, value.distance_km,
      calculateFare(value.distance_km), value.scheduled_at, req.user.id);
    res.status(201).json(db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(Number(info.lastInsertRowid)));
  });

  // Status machine: requested -> assigned -> in_progress -> completed ; cancel from requested/assigned
  const TRANSITIONS = {
    start: { from: ['assigned'], to: 'in_progress' },
    complete: { from: ['in_progress'], to: 'completed' },
    cancel: { from: ['requested', 'assigned'], to: 'cancelled' },
  };
  for (const [action, { from, to }] of Object.entries(TRANSITIONS)) {
    app.post(`/api/bookings/:id/${action}`, anyStaff, (req, res) => {
      const id = parseId(req, res); if (id === null) return;
      const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
      if (!b) return res.status(404).json({ error: 'Booking not found' });
      if (!from.includes(b.status)) return res.status(409).json({ error: `Cannot ${action} a booking that is ${b.status}` });
      db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(to, id);
      res.json(db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id));
    });
  }

  app.post('/api/bookings/:id/assign', anyStaff, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const carId = req.body && req.body.car_id;
    if (!Number.isInteger(carId) || carId < 1) {
      return res.status(400).json({ error: 'Validation failed', details: { car_id: 'must be a positive integer' } });
    }
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    if (b.status !== 'requested') return res.status(409).json({ error: `Cannot assign a booking that is ${b.status}` });
    const car = db.prepare(
      'SELECT c.*, d.status AS driver_status FROM cars c LEFT JOIN drivers d ON d.id = c.driver_id WHERE c.id = ?'
    ).get(carId);
    if (!car) return res.status(404).json({ error: 'Car not found' });
    if (car.status !== 'available') return res.status(409).json({ error: 'Car is not available' });
    if (!car.driver_id || car.driver_status !== 'active') return res.status(409).json({ error: 'Car has no active driver' });
    const busy = db.prepare("SELECT 1 FROM bookings WHERE car_id = ? AND status IN ('assigned','in_progress')").get(carId);
    if (busy) return res.status(409).json({ error: 'Car is already on another booking' });
    db.prepare("UPDATE bookings SET car_id = ?, status = 'assigned' WHERE id = ?").run(carId, id);
    res.json(db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id));
  });

  app.delete('/api/bookings/:id', admin, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const info = db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
    return info.changes ? res.status(204).end() : res.status(404).json({ error: 'Booking not found' });
  });

  // ---------- fallbacks ----------
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Generic message to the client, details only in the server log (no stack traces in responses).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    log('server.error', { path: req.path, message: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
