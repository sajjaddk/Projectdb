'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;

// scrypt (memory-hard KDF from Node's built-in crypto) with a unique random salt per password.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Dummy hash so unknown usernames cost the same time as wrong passwords (no user enumeration).
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(KEY_LEN)}`;

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };
