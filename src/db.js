'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','dispatcher')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL,
  phone          TEXT NOT NULL,
  license_number TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cars (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plate      TEXT NOT NULL UNIQUE,
  make       TEXT NOT NULL,
  model      TEXT NOT NULL,
  year       INTEGER NOT NULL,
  seats      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','maintenance')),
  driver_id  INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- a driver can be assigned to at most one car
CREATE UNIQUE INDEX IF NOT EXISTS idx_cars_driver ON cars(driver_id) WHERE driver_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  pickup         TEXT NOT NULL,
  dropoff        TEXT NOT NULL,
  distance_km    REAL NOT NULL,
  fare           REAL NOT NULL,
  scheduled_at   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested','assigned','in_progress','completed','cancelled')),
  car_id         INTEGER REFERENCES cars(id) ON DELETE SET NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
