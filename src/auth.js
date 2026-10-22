'use strict';
const crypto = require('node:crypto');

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = 'sid';
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = Object.create(null); // no prototype: a cookie named __proto__ is just data
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(raw);
    } catch {
      out[part.slice(0, i).trim()] = raw; // malformed %-encoding: keep raw value, it simply won't match a session
    }
  }
  return out;
}

function createAuth(db, { secureCookie }) {
  // Session ids are random 256-bit values; only their SHA-256 is stored in the database.
  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen) VALUES (?,?,?,?,?)')
      .run(sha256(token), userId, csrfToken, now, now);
    return { token, csrfToken };
  }

  function destroySession(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  function setCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      path: '/',
      maxAge: ABSOLUTE_TIMEOUT_MS,
    });
  }

  function clearCookie(res) {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: secureCookie, path: '/' });
  }

  // Loads the session from the cookie. 401 if missing, expired or unknown.
  function requireAuth(req, res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const row = db.prepare(
      `SELECT s.token_hash, s.csrf_token, s.created_at, s.last_seen, u.id AS user_id, u.username, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    ).get(sha256(token));
    const now = Date.now();
    if (!row || now - row.last_seen > IDLE_TIMEOUT_MS || now - row.created_at > ABSOLUTE_TIMEOUT_MS) {
      if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return res.status(401).json({ error: 'Authentication required' });
    }
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, row.token_hash);
    req.user = { id: row.user_id, username: row.username, role: row.role };
    req.session = { token, csrfToken: row.csrf_token };
    next();
  }

  // Double protection with SameSite=Strict: state-changing requests must echo the CSRF token.
  function requireCsrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const sent = req.get('x-csrf-token') || '';
    const a = Buffer.from(sent);
    const b = Buffer.from(req.session.csrfToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
  }

  // Role check is enforced on the server for every protected route.
  const requireRole = (...roles) => (req, res, next) =>
    roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });

  // Simple in-memory brute-force protection keyed by IP + username.
  const failures = new Map();
  const loginKey = (req, username) => `${req.ip}|${String(username).toLowerCase()}`;
  const limiter = {
    isLocked(key) {
      const f = failures.get(key);
      if (!f) return false;
      if (Date.now() - f.first > LOCKOUT_MS) { failures.delete(key); return false; }
      return f.count >= MAX_FAILED_LOGINS;
    },
    fail(key) {
      const f = failures.get(key);
      if (!f || Date.now() - f.first > LOCKOUT_MS) failures.set(key, { count: 1, first: Date.now() });
      else f.count += 1;
    },
    reset(key) { failures.delete(key); },
  };

  return { createSession, destroySession, setCookie, clearCookie, requireAuth, requireCsrf, requireRole, limiter, loginKey, COOKIE_NAME, parseCookies };
}

module.exports = { createAuth };
