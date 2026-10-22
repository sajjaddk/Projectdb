'use strict';
const { hashPassword } = require('./passwords');

// Seeds demo users + sample data into an EMPTY database. Passwords must come from the environment.
async function seedDemo(db, { adminPassword, dispatcherPassword }) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;
  for (const [name, pw] of [['ADMIN_PASSWORD', adminPassword], ['DISPATCHER_PASSWORD', dispatcherPassword]]) {
    if (!pw || pw.length < 12) throw new Error(`${name} must be set (min 12 chars) when SEED_DEMO=true`);
  }
  const insUser = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)');
  insUser.run('admin', await hashPassword(adminPassword), 'admin');
  insUser.run('dispatcher', await hashPassword(dispatcherPassword), 'dispatcher');

  const insDriver = db.prepare('INSERT INTO drivers (full_name, phone, license_number, status) VALUES (?,?,?,?)');
  const d1 = Number(insDriver.run('Alex Morgan', '+1 555 0101', 'DL-100001', 'active').lastInsertRowid);
  const d2 = Number(insDriver.run('Sam Rivera', '+1 555 0102', 'DL-100002', 'active').lastInsertRowid);
  insDriver.run('Jamie Chen', '+1 555 0103', 'DL-100003', 'inactive');

  const insCar = db.prepare('INSERT INTO cars (plate, make, model, year, seats, status, driver_id) VALUES (?,?,?,?,?,?,?)');
  insCar.run('TAXI-001', 'Toyota', 'Camry', 2022, 4, 'available', d1);
  insCar.run('TAXI-002', 'Honda', 'Odyssey', 2021, 6, 'available', d2);
  insCar.run('TAXI-003', 'Skoda', 'Octavia', 2020, 4, 'maintenance', null);
  return true;
}

module.exports = { seedDemo };
